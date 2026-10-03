// Chamber caves: a cellular noise carves rounded rooms, and a slow
// porousness field decides how packed with rooms each region is.

// @ts-ignore
import FastNoiseLite from "fastnoise-lite";

export interface CaveField {
  porousnessAt(worldX: number, worldZ: number): number;
  isCave(worldX: number, worldY: number, worldZ: number, porousness: number): boolean;
}

export function createCaveField(seed: number): CaveField {
  const chamberNoise = new FastNoiseLite(seed);
  chamberNoise.SetNoiseType(FastNoiseLite.NoiseType.Cellular);
  chamberNoise.SetFractalType(FastNoiseLite.FractalType.None);
  chamberNoise.SetFrequency(0.03);
  chamberNoise.SetCellularDistanceFunction(FastNoiseLite.CellularDistanceFunction.Euclidean);
  chamberNoise.SetCellularReturnType(FastNoiseLite.CellularReturnType.Distance2Mul);

  const porousnessNoise = new FastNoiseLite(seed);
  porousnessNoise.SetNoiseType(FastNoiseLite.NoiseType.Perlin);
  porousnessNoise.SetFractalType(FastNoiseLite.FractalType.None);
  porousnessNoise.SetFrequency(0.009);

  return {
    porousnessAt: (worldX, worldZ) => porousnessNoise.GetNoise(worldX, worldZ) as number,
    isCave: (worldX, worldY, worldZ, porousness) =>
      chamberNoise.GetNoise(worldX, worldY * 3, worldZ) > -0.7 + porousness * 0.2,
  };
}
