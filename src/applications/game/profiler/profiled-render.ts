import type * as THREE from "three";

import {
  installGlInstrumentation,
  type GlInstrumentation,
} from "./gl-instrumentation";
import { GpuTimer, type GpuTimerContext } from "./gpu-timer";
import { profiler as defaultProfiler } from "./index";
import type { Profiler } from "./profiler";
import { renderScenePasses, type PassRenderTarget, type PassRenderable } from "./render-passes";

export { classifyRenderObject } from "./render-passes";

export interface ProfiledRender {
  render(): void;
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

  const renderProfiled = () => {
    instrumentation ??= install();
    const active = instrumentation;
    reportSessionInfo(active);
    const frameId = activeProfiler.currentFrameId;

    const token = activeProfiler.begin("main.frame.render");
    try {
      if (activeProfiler.settings.gpuPassBreakdown) {
        renderScenePasses(
          renderer as unknown as PassRenderTarget,
          scene as unknown as { children: PassRenderable[] },
          camera,
          (pass) => active.gpuTimer.begin(pass, frameId),
          () => active.gpuTimer.end(),
        );
      } else {
        active.gpuTimer.begin("frame", frameId);
        renderer.render(scene, camera);
        active.gpuTimer.end();
      }
    } finally {
      activeProfiler.end(token);
    }

    active.gpuTimer.poll();
    active.glInstrumentation.flushFrame();
    sampleRendererInfo();
  };

  return {
    render() {
      if (!activeProfiler.enabled) {
        renderer.render(scene, camera);
        return;
      }
      renderProfiled();
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
