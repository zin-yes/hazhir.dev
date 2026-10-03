import { createGlCallObservers, type UploadSink } from "./gl-call-observers";
import { GlMemoryTracker } from "./gl-memory-tracker";
import type { Profiler } from "./profiler";

const UPLOAD = 0;
const DRAW = 1;
const PROGRAM_COMPILE = 2;
const SYNC = 3;
const CATEGORY_TIMER_NAMES = [
  "gl.cpu.upload",
  "gl.cpu.draw",
  "gl.cpu.programCompile",
  "gl.cpu.sync",
];

const TIMED_CATEGORY_BY_FUNCTION: { [functionName: string]: number } = {
  bufferData: UPLOAD,
  bufferSubData: UPLOAD,
  texImage2D: UPLOAD,
  texImage3D: UPLOAD,
  texSubImage2D: UPLOAD,
  texSubImage3D: UPLOAD,
  texStorage2D: UPLOAD,
  texStorage3D: UPLOAD,
  compressedTexImage2D: UPLOAD,
  compressedTexImage3D: UPLOAD,
  compressedTexSubImage2D: UPLOAD,
  compressedTexSubImage3D: UPLOAD,
  generateMipmap: UPLOAD,
  drawElements: DRAW,
  drawArrays: DRAW,
  drawElementsInstanced: DRAW,
  drawArraysInstanced: DRAW,
  drawRangeElements: DRAW,
  compileShader: PROGRAM_COMPILE,
  linkProgram: PROGRAM_COMPILE,
  getProgramParameter: PROGRAM_COMPILE,
  getShaderParameter: PROGRAM_COMPILE,
  readPixels: SYNC,
  finish: SYNC,
  getError: SYNC,
  getSyncParameter: SYNC,
  clientWaitSync: SYNC,
  getBufferSubData: SYNC,
};

type AnyFunction = (...args: unknown[]) => unknown;

export interface GlInstrumentation {
  /** Publishes the calls, timers, upload sizes and memory gauges gathered since the last flush. */
  flushFrame(): void;
  uninstall(): void;
  readonly memory: GlMemoryTracker;
}

/**
 * Wraps every method of a WebGL context instance with a call counter, times
 * the uploads, draws, shader compiles and blocking calls, and tracks GPU
 * memory. The prototype is untouched; uninstall() restores the instance.
 */
export function installGlInstrumentation(
  gl: WebGL2RenderingContext,
  profiler: Profiler,
): GlInstrumentation {
  const memory = new GlMemoryTracker();
  const categoryMilliseconds = new Float64Array(4);
  const categoryCalls = new Int32Array(4);
  const uploadBytes = { buffer: 0, texture: 0 };

  const uploads: UploadSink = {
    addBufferUpload(bytes) {
      uploadBytes.buffer += bytes;
      profiler.recordBytes("gl.upload.buffer", bytes);
    },
    addTextureUpload(bytes) {
      uploadBytes.texture += bytes;
      profiler.recordBytes("gl.upload.texture", bytes);
    },
  };
  const observers = createGlCallObservers(memory, uploads);

  const functionNames: string[] = [];
  const counterNames: string[] = [];
  const callCounts: number[] = [];
  const restorers: (() => void)[] = [];
  const context = gl as unknown as { [key: string]: unknown };

  for (const key in gl) {
    let original: unknown;
    try {
      original = context[key];
    } catch {
      continue;
    }
    if (typeof original !== "function") continue;

    const functionIndex = functionNames.length;
    functionNames.push(key);
    counterNames.push(`gl.calls.${key}`);
    callCounts.push(0);

    const originalFunction = original as AnyFunction;
    const category = TIMED_CATEGORY_BY_FUNCTION[key] ?? -1;
    const observer = observers[key];

    const wrapper = function (this: unknown) {
      callCounts[functionIndex]++;
      if (category < 0) {
        const result = originalFunction.apply(gl, arguments as unknown as unknown[]);
        if (observer) observer(arguments);
        return result;
      }
      const startedAtMs = performance.now();
      const result = originalFunction.apply(gl, arguments as unknown as unknown[]);
      categoryMilliseconds[category] += performance.now() - startedAtMs;
      categoryCalls[category]++;
      if (observer) observer(arguments);
      return result;
    };

    const hadOwnProperty = Object.prototype.hasOwnProperty.call(gl, key);
    context[key] = wrapper;
    restorers.push(() => {
      if (hadOwnProperty) context[key] = original;
      else delete context[key];
    });
  }

  const flushFrame = () => {
    let totalCalls = 0;
    for (let index = 0; index < functionNames.length; index++) {
      const count = callCounts[index];
      if (count === 0) continue;
      profiler.addCounter(counterNames[index], count);
      totalCalls += count;
      callCounts[index] = 0;
    }

    for (let category = 0; category < CATEGORY_TIMER_NAMES.length; category++) {
      if (categoryCalls[category] > 0) {
        profiler.recordTimer(CATEGORY_TIMER_NAMES[category], categoryMilliseconds[category], "gl");
      }
    }

    const uploadedBytesThisFrame = uploadBytes.buffer + uploadBytes.texture;
    profiler.noteFrame("glCalls", totalCalls);
    profiler.noteFrame("drawCalls", categoryCalls[DRAW]);
    profiler.noteFrame("uploadBytes", uploadedBytesThisFrame);
    profiler.noteFrame("uploadMs", categoryMilliseconds[UPLOAD]);
    if (uploadedBytesThisFrame > 0) {
      profiler.addCounter("gl.upload.bytes", uploadedBytesThisFrame, "bytes");
    }

    const { allocatedBytes, freedBytes } = memory.takeAllocationDeltas();
    if (allocatedBytes > 0) profiler.addCounter("gpu.memory.bytesAllocated", allocatedBytes, "bytes");
    if (freedBytes > 0) profiler.addCounter("gpu.memory.bytesFreed", freedBytes, "bytes");
    profiler.sampleGauge("gpu.memory.bufferBytes", memory.bufferBytes, "bytes");
    profiler.sampleGauge("gpu.memory.textureBytes", memory.textureBytes, "bytes");
    profiler.sampleGauge("gpu.memory.bufferCount", memory.bufferCount);

    categoryMilliseconds.fill(0);
    categoryCalls.fill(0);
    uploadBytes.buffer = 0;
    uploadBytes.texture = 0;
  };

  return {
    flushFrame,
    uninstall: () => restorers.forEach((restore) => restore()),
    memory,
  };
}

/** Installs the instrumentation and returns only the uninstall function. */
export function instrumentWebGl(gl: WebGL2RenderingContext, profiler: Profiler): () => void {
  return installGlInstrumentation(gl, profiler).uninstall;
}
