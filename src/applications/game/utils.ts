// @ts-ignore
import FastNoiseLite from "fastnoise-lite";
import { CHUNK_HEIGHT, CHUNK_WIDTH } from "./config";
import { getSurfaceHeight } from "@/applications/game/workers/generation";

export function getSurfaceHeightFromSeed(
  seed: number,
  x: number,
  z: number
): number {
  const noiseGenerator = new FastNoiseLite(seed);

  return getSurfaceHeight(noiseGenerator, x, z);
}

export function calculateOffset(x: number, y: number, z: number) {
  return (
    Math.abs(x) * CHUNK_WIDTH * CHUNK_HEIGHT +
    Math.abs(y) * CHUNK_HEIGHT +
    Math.abs(z)
  );
}
