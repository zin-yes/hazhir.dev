import type * as THREE from "three";

import {
  installGlInstrumentation,
  type GlInstrumentation,
} from "./gl-instrumentation";
import { setGpuPassHost } from "./gpu-pass-registry";
import { GpuTimer, type GpuTimerContext } from "./gpu-timer";
import { profiler as defaultProfiler } from "./index";
import type { Profiler } from "./profiler";
import { renderScenePasses, type PassRenderTarget, type PassRenderable } from "./render-passes";

export { classifyRenderObject } from "./render-passes";

export interface ProfiledRender {
  /**
   * Renders the scene; `beforeScene` draws a pass first (the LOD). Its draws count in the renderer stats and its GPU
   * time is part of gpu.pass.scene, or gpu.pass.lod with the pass breakdown on.
   */
  render(beforeScene?: () => void): void;
  dispose(): void;
}

interface ActiveInstrumentation {
  gl: WebGL2RenderingContext;
  glInstrumentation: GlInstrumentation;
  gpuTimer: GpuTimer;
  reportedBreakdown: boolean;
}

/**
 * Drop-in replacement for renderer.render(scene, camera). While the profiler
 * is disabled it is exactly that call. While enabled it instruments the GL
 * context, times the render on CPU (main.frame.render) and GPU, and samples
 * three's renderer.info.
 */
export function createProfiledRender(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  activeProfiler: Profiler = defaultProfiler,
): ProfiledRender {
  let instrumentation: ActiveInstrumentation | null = null;

  const teardown = () => {
    if (!instrumentation) return;
    instrumentation.glInstrumentation.uninstall();
    setGpuPassHost(null);
    instrumentation.gpuTimer.dispose();
    instrumentation = null;
  };

  const unsubscribe = activeProfiler.onEnabledChange((enabled) => {
    if (!enabled) teardown();
  });

  const install = (): ActiveInstrumentation => {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const rendererInfo = readGpuIdentity(gl);
    const glInstrumentation = installGlInstrumentation(gl, activeProfiler);
    const gpuTimer = new GpuTimer(gl as unknown as GpuTimerContext, activeProfiler, {
      requestSyncEstimate: activeProfiler.settings.gpuPassBreakdown,
    });
    activeProfiler.setSessionInfo({
      gpuRenderer: rendererInfo.renderer,
      gpuVendor: rendererInfo.vendor,
    });
    setGpuPassHost({ gpuTimer, renderer });
    return { gl, glInstrumentation, gpuTimer, reportedBreakdown: !activeProfiler.settings.gpuPassBreakdown };
  };

  const reportSessionInfo = (active: ActiveInstrumentation) => {
    const breakdownEnabled = activeProfiler.settings.gpuPassBreakdown;
    if (active.reportedBreakdown === breakdownEnabled) return;
    active.reportedBreakdown = breakdownEnabled;
    active.gpuTimer.setSyncEstimateRequested(breakdownEnabled);
    activeProfiler.setSessionInfo({
      gpuTimerSupported: active.gpuTimer.supported,
      gpuTimerMode: active.gpuTimer.mode,
      gpuPassBreakdownEnabled: breakdownEnabled,
    });
  };

  const sampleRendererInfo = () => {
    const info = renderer.info;
    activeProfiler.sampleGauge("gpu.drawCalls", info.render.calls);
    activeProfiler.sampleGauge("gpu.triangles", info.render.triangles);
    activeProfiler.sampleGauge("gpu.geometries", info.memory.geometries);
    activeProfiler.sampleGauge("gpu.textures", info.memory.textures);
    activeProfiler.sampleGauge("gpu.programs", info.programs?.length ?? 0);
    activeProfiler.noteFrame("triangles", info.render.triangles);
  };

  const renderProfiled = (beforeScene?: () => void) => {
    instrumentation ??= install();
    const active = instrumentation;
    reportSessionInfo(active);
    const frameId = activeProfiler.currentFrameId;

    const previousAutoReset = renderer.info.autoReset;
    renderer.info.autoReset = false;
    renderer.info.reset();
    const token = activeProfiler.begin("main.frame.render");
    try {
      let startedPassTimer = false;
      if (activeProfiler.settings.gpuPassBreakdown) {
        if (beforeScene) {
          const startedLodTimer = active.gpuTimer.begin("lod", frameId);
          beforeScene();
          if (startedLodTimer) active.gpuTimer.end();
        }
        renderScenePasses(
          renderer as unknown as PassRenderTarget,
          scene as unknown as { children: PassRenderable[] },
          camera,
          (pass) => {
            startedPassTimer = active.gpuTimer.begin(pass, frameId);
          },
          () => {
            if (startedPassTimer) active.gpuTimer.end();
          },
        );
      } else {
        const startedSceneTimer = active.gpuTimer.begin("scene", frameId);
        beforeScene?.();
        renderer.render(scene, camera);
        if (startedSceneTimer) active.gpuTimer.end();
      }
    } finally {
      activeProfiler.end(token);
      renderer.info.autoReset = previousAutoReset;
    }

    active.gpuTimer.poll(frameId);
    active.glInstrumentation.flushFrame();
    sampleRendererInfo();
  };

  return {
    render(beforeScene) {
      if (!activeProfiler.enabled) {
        beforeScene?.();
        renderer.render(scene, camera);
        return;
      }
      renderProfiled(beforeScene);
    },
    dispose() {
      unsubscribe();
      teardown();
    },
  };
}

function readGpuIdentity(gl: WebGL2RenderingContext): {
  renderer: string | null;
  vendor: string | null;
} {
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  if (!debugInfo) return { renderer: null, vendor: null };
  return {
    renderer: String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)),
    vendor: String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)),
  };
}
