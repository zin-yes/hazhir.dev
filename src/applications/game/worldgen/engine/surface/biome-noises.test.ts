import { describe, expect, test } from "bun:test";
import { PerlinSimplexNoise } from "../noise";
import { LegacyRandomSource } from "../random";

// Expected values come from running Minecraft 1.20.6's own PerlinSimplexNoise (the three Biome noises).
const POINTS: Array<{ x: number; z: number; temperature: number; frozen: number; info: number }> = [
  { x: 17, z: -33, temperature: -0.5641992225716033, frozen: -0.4436549797759914, info: 0.42906637509467277 },
  { x: 1000, z: 2500, temperature: 0.4476707614911797, frozen: 0.40498930868847205, info: -0.42132621365479034 },
  { x: -4096, z: 777, temperature: 0.774867867030945, frozen: -0.21477070050717018, info: 0.09987530100487624 },
  { x: 123456, z: -98765, temperature: 0.5723454641303211, frozen: -0.22520186005304502, info: 0.35920274877991565 },
  { x: 5, z: 5, temperature: 0.20099691916280776, frozen: 0.3216691851927679, info: 0.4648274367622214 },
];

describe("Biome temperature noises against Minecraft", () => {
  const startedAt = performance.now();
  const temperatureNoise = new PerlinSimplexNoise(new LegacyRandomSource(BigInt(1234)), [0]);
  const frozenNoise = new PerlinSimplexNoise(new LegacyRandomSource(BigInt(3456)), [-2, -1, 0]);
  const infoNoise = new PerlinSimplexNoise(new LegacyRandomSource(BigInt(2345)), [0]);

  test("height temperature noise (seed 1234, octave 0)", () => {
    for (const point of POINTS) {
      expect(temperatureNoise.getValue(point.x / 8, point.z / 8, false)).toBeCloseTo(point.temperature, 12);
    }
  });

  test("frozen temperature noise (seed 3456, octaves -2..0)", () => {
    for (const point of POINTS) {
      expect(frozenNoise.getValue(point.x * 0.05, point.z * 0.05, false)).toBeCloseTo(point.frozen, 12);
    }
  });

  test("biome info noise (seed 2345, octave 0)", () => {
    for (const point of POINTS) {
      expect(infoNoise.getValue(point.x * 0.2, point.z * 0.2, false)).toBeCloseTo(point.info, 12);
    }
  });

  test("reports duration", () => {
    console.log(`biome-noises.test.ts: ${(performance.now() - startedAt).toFixed(1)} ms`);
  });
});
