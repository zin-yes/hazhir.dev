import { describe, expect, test } from "bun:test";
import {
  ARRAY_BUFFER,
  RGBA8,
  TEXTURE0,
  TEXTURE_2D_ARRAY,
  createFakeWebGl,
} from "./fake-webgl.test-helper";
import { installGlInstrumentation } from "./gl-instrumentation";
import { Profiler } from "./profiler";

function setup() {
  const fake = createFakeWebGl();
  const profiler = new Profiler();
  profiler.setEnabled(true);
  const instrumentation = installGlInstrumentation(fake.asWebGl2(), profiler);
  const gl = fake.gl as unknown as {
    bindBuffer(target: number, buffer: object): void;
    bufferData(target: number, data: ArrayBufferView | number, usage: number): void;
    deleteBuffer(buffer: object): void;
    activeTexture(unit: number): void;
    bindTexture(target: number, texture: object): void;
    texStorage3D(...args: number[]): void;
    texSubImage3D(...args: unknown[]): void;
    drawElements(mode: number, count: number, type: number, offset: number): void;
  };
  return { fake, profiler, instrumentation, gl };
}

function counter(profiler: Profiler, name: string) {
  return profiler.snapshot().counters.find((candidate) => candidate.name === name)?.total;
}

function gauge(profiler: Profiler, name: string) {
  return profiler.snapshot().gauges.find((candidate) => candidate.name === name)?.last;
}

describe("installGlInstrumentation", () => {
  test("forwards the exact arguments to the original function", () => {
    const { fake, gl } = setup();
    gl.drawElements(4, 600, 5125, 0);
    const call = fake.gl.calls.find((candidate) => candidate.name === "drawElements");
    expect(call?.args).toEqual([4, 600, 5125, 0]);
  });

  test("tracks buffer memory through upload, resize and delete", () => {
    const { profiler, instrumentation, gl } = setup();
    const buffer = {};
    gl.bindBuffer(ARRAY_BUFFER, buffer);
    gl.bufferData(ARRAY_BUFFER, new Float32Array(1000), 0x88e4);
    instrumentation.flushFrame();
    expect(gauge(profiler, "gpu.memory.bufferBytes")).toBe(4000);
    expect(gauge(profiler, "gpu.memory.bufferCount")).toBe(1);

    gl.bufferData(ARRAY_BUFFER, 1500, 0x88e4);
    gl.deleteBuffer(buffer);
    instrumentation.flushFrame();
    expect(gauge(profiler, "gpu.memory.bufferBytes")).toBe(0);
    expect(gauge(profiler, "gpu.memory.bufferCount")).toBe(0);
    expect(counter(profiler, "gpu.memory.bytesFreed")).toBe(4000 + 1500);
    expect(counter(profiler, "gl.upload.bytes")).toBe(4000 + 1500);
  });

  test("estimates an immutable texture array allocation including mip levels", () => {
    const { profiler, instrumentation, gl } = setup();
    const texture = {};
    gl.activeTexture(TEXTURE0);
    gl.bindTexture(TEXTURE_2D_ARRAY, texture);
    gl.texStorage3D(TEXTURE_2D_ARRAY, 5, RGBA8, 16, 16, 100);
    gl.texSubImage3D(TEXTURE_2D_ARRAY, 0, 0, 0, 0, 16, 16, 100, 0x1908, 0x1401, new Uint8Array(16 * 16 * 100 * 4));
    instrumentation.flushFrame();

    const expectedBytes = (16 * 16 + 8 * 8 + 4 * 4 + 2 * 2 + 1) * 100 * 4;
    expect(gauge(profiler, "gpu.memory.textureBytes")).toBe(expectedBytes);
    expect(profiler.snapshot().bytes.find((b) => b.name === "gl.upload.texture")?.max).toBe(16 * 16 * 100 * 4);
  });

  test("counts calls per function and times draws as one gl timer", () => {
    const { profiler, instrumentation, gl } = setup();
    for (let draw = 0; draw < 25; draw++) gl.drawElements(4, 6, 5125, 0);
    instrumentation.flushFrame();

    expect(counter(profiler, "gl.calls.drawElements")).toBe(25);
    const drawTimer = profiler.snapshot().timers.find((timer) => timer.name === "gl.cpu.draw");
    expect(drawTimer?.domain).toBe("gl");
    expect(drawTimer?.count).toBe(1);
  });

  test("uninstall restores the context so calls are no longer counted", () => {
    const { fake, profiler, instrumentation, gl } = setup();
    instrumentation.uninstall();
    gl.drawElements(4, 6, 5125, 0);
    instrumentation.flushFrame();

    expect(fake.gl.calls.filter((call) => call.name === "drawElements").length).toBe(1);
    expect(counter(profiler, "gl.calls.drawElements")).toBeUndefined();
  });
});
