import { BlockType } from "@/applications/game/blocks";
import {
  CHUNK_HEIGHT,
  CHUNK_LENGTH,
  CHUNK_WIDTH,
  GENERATION_FREQUENCY_MULTIPLIER,
} from "@/applications/game/config";

//@ts-ignore
import FastNoiseLite from "fastnoise-lite";
import { calculateOffset } from "../utils";

function getDirtHeight(
  noiseGenerator: typeof FastNoiseLite,
  x: number,
  z: number
): number {
  noiseGenerator.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
  noiseGenerator.SetFractalType(FastNoiseLite.FractalType.FBm);
  noiseGenerator.SetFrequency(0.004 * GENERATION_FREQUENCY_MULTIPLIER);
  noiseGenerator.SetFractalOctaves(1);
  noiseGenerator.SetFractalLacunarity(0);
  noiseGenerator.SetFractalGain(0);
  noiseGenerator.SetFractalWeightedStrength(0);
  const dirtHeight = 13 + noiseGenerator.GetNoise(x, 0, z) * 5;
  return dirtHeight;
}

export function getSurfaceHeight(
  noiseGenerator: typeof FastNoiseLite,
  x: number,
  z: number
): number {
  noiseGenerator.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
  noiseGenerator.SetFractalType(FastNoiseLite.FractalType.FBm);
  noiseGenerator.SetFrequency(0.0035 * GENERATION_FREQUENCY_MULTIPLIER);
  noiseGenerator.SetFractalOctaves(8);
  noiseGenerator.SetFractalLacunarity(2.24);
  noiseGenerator.SetFractalGain(0.42);
  noiseGenerator.SetFractalWeightedStrength(0);
  const noiseValue = noiseGenerator.GetNoise(x, 0, z);
  let surfaceY = 0;

  if (noiseValue >= -1 && noiseValue <= 0.3) {
    surfaceY = 38.4615 * noiseValue + 88.4615;
  } else if (noiseValue >= 0.3 && noiseValue <= 0.4) {
    surfaceY = 500 * noiseValue + -50;
  } else if (noiseValue >= 0.4 && noiseValue <= 1.0) {
    surfaceY = 20 * noiseValue - 7 + 150;
  }

  return surfaceY;
}

function getFlowerGrassNoise(
  noiseGenerator: typeof FastNoiseLite,
  x: number,
  z: number
): number {
  noiseGenerator.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
  noiseGenerator.SetFractalType("None");
  noiseGenerator.SetFrequency(0.005 * GENERATION_FREQUENCY_MULTIPLIER);
  noiseGenerator.SetFractalOctaves(1);
  noiseGenerator.SetFractalLacunarity(0);
  noiseGenerator.SetFractalGain(0);
  noiseGenerator.SetFractalWeightedStrength(0);
  const noiseValue = noiseGenerator.GetNoise(x, 0, z);
  return noiseValue;
}

function getSplochNoise(
  noiseGenerator: typeof FastNoiseLite,
  x: number,
  y: number,
  z: number
): number {
  noiseGenerator.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
  noiseGenerator.SetFractalType("None");
  noiseGenerator.SetFrequency(0.06 * GENERATION_FREQUENCY_MULTIPLIER);
  noiseGenerator.SetFractalOctaves(1);
  noiseGenerator.SetFractalLacunarity(0);
  noiseGenerator.SetFractalGain(0);
  noiseGenerator.SetFractalWeightedStrength(0);
  const noiseValue = noiseGenerator.GetNoise(x, y, z);
  return noiseValue;
}

function getTunnelCaveNoise(
  noiseGenerator: typeof FastNoiseLite,
  x: number,
  y: number,
  z: number
): number {
  noiseGenerator.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
  noiseGenerator.SetFractalType(FastNoiseLite.FractalType.PingPong);
  noiseGenerator.SetFrequency(0.01 * GENERATION_FREQUENCY_MULTIPLIER);
  noiseGenerator.SetFractalOctaves(1);
  noiseGenerator.SetFractalLacunarity(2.0);
  noiseGenerator.SetFractalGain(0.5);
  noiseGenerator.SetFractalWeightedStrength(0);
  noiseGenerator.SetFractalPingPongStrength(1.17);
  const noiseValue = noiseGenerator.GetNoise(x, y * 3, z);
  return noiseValue;
}

function getChamberCaveNoise(
  noiseGenerator: typeof FastNoiseLite,
  x: number,
  y: number,
  z: number
): number {
  noiseGenerator.SetNoiseType(FastNoiseLite.NoiseType.Cellular);
  noiseGenerator.SetFractalType(FastNoiseLite.FractalType.None);
  noiseGenerator.SetFrequency(0.03);
  noiseGenerator.SetFractalOctaves(1);
  noiseGenerator.SetFractalLacunarity(0);
  noiseGenerator.SetFractalGain(0);
  noiseGenerator.SetFractalWeightedStrength(0);
  noiseGenerator.SetCellularDistanceFunction(
    FastNoiseLite.CellularDistanceFunction.Euclidean
  );
  noiseGenerator.SetCellularReturnType(
    FastNoiseLite.CellularReturnType.Distance2Mul
  );
  const noiseValue = noiseGenerator.GetNoise(x, y * 3, z);
  return noiseValue;
}

function getPorousnessNoise(
  noiseGenerator: typeof FastNoiseLite,
  x: number,
  z: number
): number {
  noiseGenerator.SetNoiseType(FastNoiseLite.NoiseType.Perlin);
  noiseGenerator.SetFractalType(FastNoiseLite.FractalType.None);
  noiseGenerator.SetFrequency(0.009);
  const noiseValue = noiseGenerator.GetNoise(x, 0, z);
  return noiseValue;
}

function generateSploch(splochNoise: number): number {
  if (splochNoise >= 0.85) {
    const randomizer = Math.random();
    if (randomizer > 0.0 && randomizer < 0.3) {
      return BlockType.COMPACT_GRAVEL;
    } else if (randomizer > 0.3 && randomizer > 0.7) {
      return BlockType.GRAVEL;
    } else if (randomizer > 0.7 && randomizer < 0.9) {
      return BlockType.CLAY;
    }
  } else if (splochNoise <= -0.85) {
    const randomizer = Math.random();
    if (randomizer > 0.0 && randomizer < 0.7) {
      return BlockType.MARBLE;
    } else if (randomizer > 0.7 && randomizer < 0.9) {
      return BlockType.SAND;
    } else {
      return BlockType.CALCITE;
    }
  }
  return BlockType.AIR;
}

interface BlockLayer {
  type: BlockType;
  depth: number;
}

function getBlockLayerBlock(surfaceY: number, y: number): number {
  if (y > surfaceY - BLOCK_LAYERS[0].depth) {
    return BLOCK_LAYERS[0].type;
  }
  if (y > surfaceY - BLOCK_LAYERS[0].depth - BLOCK_LAYERS[1].depth) {
    return BLOCK_LAYERS[1].type;
  } else if (
    y >
    surfaceY -
      BLOCK_LAYERS[0].depth -
      BLOCK_LAYERS[1].depth -
      BLOCK_LAYERS[2].depth
  ) {
    return BLOCK_LAYERS[2].type;
  } else if (
    y >
    surfaceY -
      BLOCK_LAYERS[0].depth -
      BLOCK_LAYERS[1].depth -
      BLOCK_LAYERS[2].depth -
      BLOCK_LAYERS[3].depth
  ) {
    return BLOCK_LAYERS[3].type;
  } else if (
    y >
    surfaceY -
      BLOCK_LAYERS[0].depth -
      BLOCK_LAYERS[1].depth -
      BLOCK_LAYERS[2].depth -
      BLOCK_LAYERS[3].depth -
      BLOCK_LAYERS[4].depth
  ) {
    return BLOCK_LAYERS[4].type;
  } else if (
    y >
    surfaceY -
      BLOCK_LAYERS[0].depth -
      BLOCK_LAYERS[1].depth -
      BLOCK_LAYERS[2].depth -
      BLOCK_LAYERS[3].depth -
      BLOCK_LAYERS[4].depth -
      BLOCK_LAYERS[5].depth
  ) {
    return BLOCK_LAYERS[5].type;
  } else if (
    y >
    surfaceY -
      BLOCK_LAYERS[0].depth -
      BLOCK_LAYERS[1].depth -
      BLOCK_LAYERS[2].depth -
      BLOCK_LAYERS[3].depth -
      BLOCK_LAYERS[4].depth -
      BLOCK_LAYERS[5].depth -
      BLOCK_LAYERS[6].depth
  ) {
    return BLOCK_LAYERS[6].type;
  } else if (
    y >
    surfaceY -
      BLOCK_LAYERS[0].depth -
      BLOCK_LAYERS[1].depth -
      BLOCK_LAYERS[2].depth -
      BLOCK_LAYERS[3].depth -
      BLOCK_LAYERS[4].depth -
      BLOCK_LAYERS[5].depth -
      BLOCK_LAYERS[6].depth -
      BLOCK_LAYERS[7].depth
  ) {
    return BLOCK_LAYERS[7].type;
  }

  return BlockType.SHALE;
}

const BLOCK_LAYERS: BlockLayer[] = [
  {
    type: BlockType.DIRT,
    depth: 3,
  },
  {
    type: BlockType.HUMUS,
    depth: 3,
  },
  {
    type: BlockType.SILT,
    depth: 10,
  },
  {
    type: BlockType.CLAY,
    depth: 5,
  },
  {
    type: BlockType.COBBLESTONE,
    depth: 3,
  },
  {
    type: BlockType.STONE,
    depth: 50,
  },
  {
    type: BlockType.GRANITE,
    depth: 15,
  },
  {
    type: BlockType.PHYLLITE,
    depth: 100,
  },
];

const WATER_LEVEL = 80;

function generateBlock(
  noiseGenerator: typeof FastNoiseLite,
  x: number,
  y: number,
  z: number
): number {
  //return y < 2
  //  ? Math.abs(x % CHUNK_WIDTH) === 0 ||
  //    Math.abs(x % CHUNK_WIDTH) === CHUNK_WIDTH ||
  //    Math.abs(z % CHUNK_LENGTH) === 0 ||
  //    Math.abs(z % CHUNK_LENGTH) === CHUNK_LENGTH
  //    ? BlockType.AIR
  //    : BlockType.COBBLESTONE
  //  : BlockType.AIR;
  //const flowerGrassNoise = getFlowerGrassNoise(x, z);

  // const splochNoise = getSplochNoise(noiseGenerator, x, y, z);
  // const chamberCaveNoise = getChamberCaveNoise(noiseGenerator, x, y, z);
  // const porousnessNoise = getPorousnessNoise(noiseGenerator, x, z);

  const surfaceY = getSurfaceHeight(noiseGenerator, x, z);

  let block = BlockType.AIR;

  if (y < WATER_LEVEL) {
    if (y < surfaceY + 3) {
      block = BlockType.SAND;
    }
  }

  if (y < surfaceY) {
    if (y > surfaceY - 1) {
      if (surfaceY - 1 > WATER_LEVEL - 1) {
        block = BlockType.GRASS;
      }
    }

    if (block === BlockType.SAND || block === BlockType.AIR) {
      block = getBlockLayerBlock(surfaceY, y);
    }
  }

  if (y < WATER_LEVEL) {
    if (block === BlockType.AIR) {
      block = BlockType.WATER;
    }
  }

  if (
    y < surfaceY - 10 &&
    block !== BlockType.DIRT &&
    block !== BlockType.GRASS &&
    block !== BlockType.HUMUS &&
    block !== BlockType.SILT
  ) {
    const chamberCaveNoise = getChamberCaveNoise(noiseGenerator, x, y, z);
    const porousnessNoise = getPorousnessNoise(noiseGenerator, x, z);
    const isChamberCave = chamberCaveNoise > -0.7 + porousnessNoise * 0.2;

    if (isChamberCave) block = BlockType.AIR;
  }

  return block;
}

export function generateChunk(
  seed: number,
  chunkX: number,
  chunkY: number,
  chunkZ: number
): ArrayBuffer {
  const noiseGenerator = new FastNoiseLite();
  noiseGenerator.SetSeed(seed);

  const chunk: Uint8Array = new Uint8Array(
    CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH
  );

  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        chunk[
          calculateOffset(x % CHUNK_WIDTH, y % CHUNK_HEIGHT, z % CHUNK_LENGTH)
        ] = generateBlock(
          noiseGenerator,
          x + CHUNK_WIDTH * chunkX,
          y + CHUNK_HEIGHT * chunkY,
          z + CHUNK_LENGTH * chunkZ
        );
      }
    }
  }

  return new Uint8Array(chunk).buffer;
}

