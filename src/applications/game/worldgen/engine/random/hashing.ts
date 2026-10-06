// Pure TypeScript MD5 and SHA-256 (Web Workers have no synchronous crypto digest), plus Java String.hashCode.
// MD5 seeds `XoroshiroPositionalRandomFactory.fromHashOf`; SHA-256 seeds `BiomeManager.obfuscateSeed`.

import { defineHotCounter, noteHot } from "../profiling/hot-counters";

const MD5_HASHES = defineHotCounter("random.md5Hashes");
const SHA256_HASHES = defineHotCounter("random.sha256Hashes");
const JAVA_STRING_HASHES = defineHotCounter("random.javaStringHashes");

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
];

const MD5_CONSTANTS = new Int32Array(64);
for (let index = 0; index < 64; index++) {
  MD5_CONSTANTS[index] = Math.floor(Math.abs(Math.sin(index + 1)) * 4294967296) | 0;
}

/** Appends the 0x80 terminator, zero padding and the 64-bit message bit length (little or big endian). */
function padMessage(bytes: Uint8Array, lengthBigEndian: boolean): Uint8Array {
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLengthLow = (bytes.length << 3) >>> 0;
  const bitLengthHigh = Math.floor(bytes.length / 536870912) >>> 0;
  const view = new DataView(padded.buffer);
  if (lengthBigEndian) {
    view.setUint32(paddedLength - 8, bitLengthHigh, false);
    view.setUint32(paddedLength - 4, bitLengthLow, false);
  } else {
    view.setUint32(paddedLength - 8, bitLengthLow, true);
    view.setUint32(paddedLength - 4, bitLengthHigh, true);
  }
  return padded;
}

function rotateLeft32(value: number, count: number): number {
  return (value << count) | (value >>> (32 - count));
}

export function md5(bytes: Uint8Array): Uint8Array {
  noteHot(MD5_HASHES);
  const padded = padMessage(bytes, false);
  const view = new DataView(padded.buffer);
  let stateA = 0x67452301;
  let stateB = 0xefcdab89 | 0;
  let stateC = 0x98badcfe | 0;
  let stateD = 0x10325476;
  const words = new Int32Array(16);
  for (let blockOffset = 0; blockOffset < padded.length; blockOffset += 64) {
    for (let wordIndex = 0; wordIndex < 16; wordIndex++) words[wordIndex] = view.getInt32(blockOffset + wordIndex * 4, true);
    let roundA = stateA;
    let roundB = stateB;
    let roundC = stateC;
    let roundD = stateD;
    for (let step = 0; step < 64; step++) {
      let mixed: number;
      let wordIndex: number;
      if (step < 16) {
        mixed = (roundB & roundC) | (~roundB & roundD);
        wordIndex = step;
      } else if (step < 32) {
        mixed = (roundD & roundB) | (~roundD & roundC);
        wordIndex = (5 * step + 1) & 15;
      } else if (step < 48) {
        mixed = roundB ^ roundC ^ roundD;
        wordIndex = (3 * step + 5) & 15;
      } else {
        mixed = roundC ^ (roundB | ~roundD);
        wordIndex = (7 * step) & 15;
      }
      const sum = (mixed + roundA + MD5_CONSTANTS[step] + words[wordIndex]) | 0;
      roundA = roundD;
      roundD = roundC;
      roundC = roundB;
      roundB = (roundB + rotateLeft32(sum, MD5_SHIFTS[step])) | 0;
    }
    stateA = (stateA + roundA) | 0;
    stateB = (stateB + roundB) | 0;
    stateC = (stateC + roundC) | 0;
    stateD = (stateD + roundD) | 0;
  }
  const digest = new Uint8Array(16);
  const digestView = new DataView(digest.buffer);
  digestView.setInt32(0, stateA, true);
  digestView.setInt32(4, stateB, true);
  digestView.setInt32(8, stateC, true);
  digestView.setInt32(12, stateD, true);
  return digest;
}

const SHA256_ROUND_CONSTANTS = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

function rotateRight32(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

export function sha256(bytes: Uint8Array): Uint8Array {
  noteHot(SHA256_HASHES);
  const padded = padMessage(bytes, true);
  const view = new DataView(padded.buffer);
  const state = new Int32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const schedule = new Int32Array(64);
  for (let blockOffset = 0; blockOffset < padded.length; blockOffset += 64) {
    for (let index = 0; index < 16; index++) schedule[index] = view.getInt32(blockOffset + index * 4, false);
    for (let index = 16; index < 64; index++) {
      const previous15 = schedule[index - 15];
      const previous2 = schedule[index - 2];
      const sigma0 = rotateRight32(previous15, 7) ^ rotateRight32(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight32(previous2, 17) ^ rotateRight32(previous2, 19) ^ (previous2 >>> 10);
      schedule[index] = (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) | 0;
    }
    let workA = state[0];
    let workB = state[1];
    let workC = state[2];
    let workD = state[3];
    let workE = state[4];
    let workF = state[5];
    let workG = state[6];
    let workH = state[7];
    for (let index = 0; index < 64; index++) {
      const sum1 = rotateRight32(workE, 6) ^ rotateRight32(workE, 11) ^ rotateRight32(workE, 25);
      const choice = (workE & workF) ^ (~workE & workG);
      const temporary1 = (workH + sum1 + choice + SHA256_ROUND_CONSTANTS[index] + schedule[index]) | 0;
      const sum0 = rotateRight32(workA, 2) ^ rotateRight32(workA, 13) ^ rotateRight32(workA, 22);
      const majority = (workA & workB) ^ (workA & workC) ^ (workB & workC);
      const temporary2 = (sum0 + majority) | 0;
      workH = workG;
      workG = workF;
      workF = workE;
      workE = (workD + temporary1) | 0;
      workD = workC;
      workC = workB;
      workB = workA;
      workA = (temporary1 + temporary2) | 0;
    }
    state[0] = (state[0] + workA) | 0;
    state[1] = (state[1] + workB) | 0;
    state[2] = (state[2] + workC) | 0;
    state[3] = (state[3] + workD) | 0;
    state[4] = (state[4] + workE) | 0;
    state[5] = (state[5] + workF) | 0;
    state[6] = (state[6] + workG) | 0;
    state[7] = (state[7] + workH) | 0;
  }
  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let index = 0; index < 8; index++) digestView.setInt32(index * 4, state[index], false);
  return digest;
}

const BIG_8 = BigInt(8);
const BIG_BYTE_MASK = BigInt(0xff);

/**
 * Mirrors Guava `Hashing.sha256().hashLong(value).asLong()` as used by `BiomeManager.obfuscateSeed`:
 * hashes the 8 little-endian bytes of the long and reads the first 8 digest bytes back as a little-endian long.
 */
export function sha256HashLong(value: bigint): bigint {
  const input = new Uint8Array(8);
  let remaining = BigInt.asUintN(64, value);
  for (let index = 0; index < 8; index++) {
    input[index] = Number(remaining & BIG_BYTE_MASK);
    remaining >>= BIG_8;
  }
  const digest = sha256(input);
  let result = BigInt(0);
  for (let index = 7; index >= 0; index--) result = (result << BIG_8) | BigInt(digest[index]);
  return BigInt.asIntN(64, result);
}

/** Java `String.hashCode()` over UTF-16 code units. */
export function javaStringHashCode(text: string): number {
  noteHot(JAVA_STRING_HASHES);
  let hash = 0;
  for (let index = 0; index < text.length; index++) hash = (Math.imul(31, hash) + text.charCodeAt(index)) | 0;
  return hash;
}

const utf8Encoder = new TextEncoder();

export function encodeUtf8(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}
