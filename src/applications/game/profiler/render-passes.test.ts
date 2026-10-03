import { describe, expect, test } from "bun:test";
import { classifyRenderObject, renderScenePasses, type PassRenderable } from "./render-passes";

describe("classifyRenderObject", () => {
  test("buckets chunk meshes, sky and everything else", () => {
    expect(classifyRenderObject({ name: "sky" })).toBe("sky");
    expect(classifyRenderObject({ name: "0,-1,2" })).toBe("opaque");
    expect(classifyRenderObject({ name: "-3,0,-12" })).toBe("opaque");
    expect(classifyRenderObject({ name: "-3,0,-12_transparent" })).toBe("transparent");
    expect(classifyRenderObject({ name: "indicator" })).toBe("overlay");
    expect(classifyRenderObject({ name: "" })).toBe("overlay");
  });
});

function createFakeRenderer() {
  const renderedVisibleNames: string[][] = [];
  const autoClearPerRender: boolean[] = [];
  let scene: { children: PassRenderable[] } | null = null;
  const renderer = {
    autoClear: true,
    info: { autoReset: true, reset() {} },
    render(renderedScene: unknown) {
      scene = renderedScene as { children: PassRenderable[] };
      autoClearPerRender.push(renderer.autoClear);
      renderedVisibleNames.push(scene.children.filter((child) => child.visible).map((child) => child.name));
    },
  };
  return { renderer, renderedVisibleNames, autoClearPerRender };
}

function createScene() {
  return {
    children: [
      { name: "indicator", visible: true },
      { name: "0,0,0_transparent", visible: true },
      { name: "sky", visible: true },
      { name: "0,0,0", visible: true },
      { name: "1,0,0", visible: false },
    ],
  };
}

describe("renderScenePasses", () => {
  test("draws each pass separately in sky, opaque, transparent, overlay order and clears only once", () => {
    const { renderer, renderedVisibleNames, autoClearPerRender } = createFakeRenderer();
    const passes: string[] = [];
    renderScenePasses(renderer, createScene(), {}, (pass) => passes.push(pass), () => {});

    expect(passes).toEqual(["sky", "opaque", "transparent", "overlay"]);
    expect(renderedVisibleNames).toEqual([["sky"], ["0,0,0"], ["0,0,0_transparent"], ["indicator"]]);
    expect(autoClearPerRender).toEqual([true, false, false, false]);
  });

  test("restores visibility, autoClear and autoReset even when a render throws", () => {
    const { renderer } = createFakeRenderer();
    let renders = 0;
    const originalRender = renderer.render;
    renderer.render = (scene: unknown) => {
      if (++renders === 2) throw new Error("gpu lost");
      originalRender(scene);
    };
    const scene = createScene();

    expect(() => renderScenePasses(renderer, scene, {}, () => {}, () => {})).toThrow("gpu lost");
    expect(scene.children.map((child) => child.visible)).toEqual([true, true, true, true, false]);
    expect(renderer.autoClear).toBe(true);
    expect(renderer.info.autoReset).toBe(true);
  });

  test("still renders once when the scene has nothing to classify", () => {
    const { renderer, renderedVisibleNames } = createFakeRenderer();
    renderScenePasses(renderer, { children: [] }, {}, () => {}, () => {});
    expect(renderedVisibleNames.length).toBe(1);
  });
});
