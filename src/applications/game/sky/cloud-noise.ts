// The tileable 3D noise the clouds are shaped from. The CPU builds it once and uploads it as a texture; the CPU also
// samples it (same trilinear wrap as the GPU) so the cloud density the viewer sits in is known without a read back.
// Red holds big billowy shapes, green holds fine erosion detail.

import { profiler } from "../profiler";

export const CLOUD_NOISE_SIZE = 48;
const CHANNELS = 2;

function pcg(x: number, y: number, z: number): number {
  let a = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  let b = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  let c = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  a = (a + Math.imul(b, c)) >>> 0;
  b = (b + Math.imul(c, a)) >>> 0;
  c = (c + Math.imul(a, b)) >>> 0;
  a = (a ^ (a >>> 16)) >>> 0;
  b = (b ^ (b >>> 16)) >>> 0;
  c = (c ^ (c >>> 16)) >>> 0;
  a = (a + Math.imul(b, c)) >>> 0;
  return a / 4294967296;
}

function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/** Smooth value noise that repeats every `period` lattice cells; `unit` is the position in 0..1 across one tile. */
function periodicNoise(unitX: number, unitY: number, unitZ: number, period: number, salt: number): number {
  const x = unitX * period;
  const y = unitY * period;
  const z = unitZ * period;
  const baseX = Math.floor(x);
  const baseY = Math.floor(y);
  const baseZ = Math.floor(z);
  const easedX = (x - baseX) * (x - baseX) * (3 - 2 * (x - baseX));
  const easedY = (y - baseY) * (y - baseY) * (3 - 2 * (y - baseY));
  const easedZ = (z - baseZ) * (z - baseZ) * (3 - 2 * (z - baseZ));
  const corner = (offsetX: number, offsetY: number, offsetZ: number) =>
    pcg(wrap(baseX + offsetX, period) + salt, wrap(baseY + offsetY, period) + salt, wrap(baseZ + offsetZ, period) + salt);
  const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
  return mix(
    mix(mix(corner(0, 0, 0), corner(1, 0, 0), easedX), mix(corner(0, 1, 0), corner(1, 1, 0), easedX), easedY),
    mix(mix(corner(0, 0, 1), corner(1, 0, 1), easedX), mix(corner(0, 1, 1), corner(1, 1, 1), easedX), easedY),
    easedZ,
  );
}

function toByte(unit: number): number {
  return Math.round(Math.min(1, Math.max(0, unit)) * 255);
}

/** Interleaved red/green bytes, x fastest then y then z. */
export function generateCloudNoise(size: number = CLOUD_NOISE_SIZE): Uint8Array {
  const scopeToken = profiler.begin("main.sky.cloudNoise.generate");
  try {
    return fillCloudNoise(size);
  } finally {
    profiler.end(scopeToken);
  }
}

function fillCloudNoise(size: number): Uint8Array {
  const data = new Uint8Array(size * size * size * CHANNELS);
  let index = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const unitX = (x + 0.5) / size;
        const unitY = (y + 0.5) / size;
        const unitZ = (z + 0.5) / size;
        const shape =
          0.55 * periodicNoise(unitX, unitY, unitZ, 4, 0) +
          0.3 * periodicNoise(unitX, unitY, unitZ, 8, 100) +
          0.15 * periodicNoise(unitX, unitY, unitZ, 16, 200);
        const detail =
          0.5 * periodicNoise(unitX, unitY, unitZ, 12, 300) +
          0.3 * periodicNoise(unitX, unitY, unitZ, 24, 400) +
          0.2 * periodicNoise(unitX, unitY, unitZ, 48, 500);
        data[index++] = toByte((shape - 0.5) * 1.7 + 0.5);
        data[index++] = toByte((detail - 0.5) * 1.7 + 0.5);
      }
    }
  }
  profiler.addCounter("game.sky.cloudNoise.voxelsGenerated", size * size * size);
  profiler.recordBytes("bytes.sky.cloudNoise", data.byteLength);
  return data;
}

/** Trilinear sample with wrap, matching a GPU texture with linear filtering and repeat wrapping. channel 0 red, 1 green. */
export function sampleCloudNoise(data: Uint8Array, unitX: number, unitY: number, unitZ: number, channel: number, size: number = CLOUD_NOISE_SIZE): number {
  const x = unitX * size - 0.5;
  const y = unitY * size - 0.5;
  const z = unitZ * size - 0.5;
  const baseX = Math.floor(x);
  const baseY = Math.floor(y);
  const baseZ = Math.floor(z);
  const fractionX = x - baseX;
  const fractionY = y - baseY;
  const fractionZ = z - baseZ;
  const texel = (offsetX: number, offsetY: number, offsetZ: number) => {
    const texelX = wrap(baseX + offsetX, size);
    const texelY = wrap(baseY + offsetY, size);
    const texelZ = wrap(baseZ + offsetZ, size);
    return data[((texelZ * size + texelY) * size + texelX) * CHANNELS + channel]! / 255;
  };
  const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
  return mix(
    mix(mix(texel(0, 0, 0), texel(1, 0, 0), fractionX), mix(texel(0, 1, 0), texel(1, 1, 0), fractionX), fractionY),
    mix(mix(texel(0, 0, 1), texel(1, 0, 1), fractionX), mix(texel(0, 1, 1), texel(1, 1, 1), fractionX), fractionY),
    fractionZ,
  );
}
