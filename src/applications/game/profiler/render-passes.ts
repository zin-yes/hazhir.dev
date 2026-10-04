export type RenderPass = "sky" | "opaque" | "transparent" | "overlay";

export const RENDER_PASS_ORDER: RenderPass[] = ["sky", "opaque", "transparent", "overlay"];

const OPAQUE_CHUNK_NAME = /^-?\d+,-?\d+,-?\d+$/;
const TRANSPARENT_SUFFIX = "_transparent";

/**
 * Buckets a scene child into the render pass whose GPU time it contributes
 * to. Chunk meshes are named "x,y,z" (opaque) and "x,y,z_transparent".
 */
export function classifyRenderObject(object: { name: string }): RenderPass {
  if (object.name === "sky") return "sky";
  if (OPAQUE_CHUNK_NAME.test(object.name)) return "opaque";
  if (object.name.endsWith(TRANSPARENT_SUFFIX)) return "transparent";
  return "overlay";
}

export interface PassRenderable {
  name: string;
  visible: boolean;
}

export interface PassRenderTarget {
  autoClear: boolean;
  info: { autoReset: boolean; reset(): void };
  render(scene: unknown, camera: unknown): void;
}

/**
 * Renders the scene once per non-empty pass by hiding every other child,
 * producing the same image as one render call (the first pass clears, later
 * passes draw on top). Visibility and clear state are always restored. The
 * caller resets renderer.info, so draws before the scene (the LOD pass) count.
 */
export function renderScenePasses(
  renderer: PassRenderTarget,
  scene: { children: PassRenderable[] },
  camera: unknown,
  beforePass: (pass: RenderPass) => void,
  afterPass: (pass: RenderPass) => void,
) {
  const children = scene.children;
  const originalVisibility = children.map((child) => child.visible);
  const childPasses = children.map((child) => classifyRenderObject(child));
  const originalAutoClear = renderer.autoClear;
  const originalAutoReset = renderer.info.autoReset;

  renderer.info.autoReset = false;
  let hasCleared = false;
  try {
    for (const pass of RENDER_PASS_ORDER) {
      if (!childPasses.includes(pass)) continue;
      for (let index = 0; index < children.length; index++) {
        children[index].visible = originalVisibility[index] && childPasses[index] === pass;
      }
      renderer.autoClear = hasCleared ? false : originalAutoClear;
      hasCleared = true;
      beforePass(pass);
      renderer.render(scene, camera);
      afterPass(pass);
    }
    if (!hasCleared) renderer.render(scene, camera);
  } finally {
    for (let index = 0; index < children.length; index++) {
      children[index].visible = originalVisibility[index];
    }
    renderer.autoClear = originalAutoClear;
    renderer.info.autoReset = originalAutoReset;
  }
}
