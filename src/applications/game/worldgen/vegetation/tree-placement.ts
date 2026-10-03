// Decides where trees, bushes and cacti grow and stamps them into a chunk.
//
// Planting spots come from a jittered grid so growth looks scattered but is
// identical no matter which chunk asks. Density depends on the biome, groves
// and clearings, steepness, how cold the altitude is, and proximity to fresh
// water; the species mix comes from the biome. Large trees suppress their
// neighbors so trunks do not collide.

import { BlockType } from "@/applications/game/blocks";
import { CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";
import { BiomeId } from "../biomes";
import type { ColumnInfo, ColumnLookup } from "../column-grid";
import { hashToUnit, lerp, smoothstep, smoothValueNoise } from "../math";
import { MAX_TREE_FOOTPRINT_RADIUS, TREE_SPECIES } from "../trees";
import type { TreeSpeciesName } from "../trees/tree-types";
import { ChunkTreeWriter } from "./chunk-tree-writer";

const CELL_SIZE = 5;
const CELL_JITTER_MARGIN = 1;
const COLD_TOLERANCE_DEFAULT = -0.6;

const COLD_TOLERANCE: Partial<Record<TreeSpeciesName, number>> = {
  krummholz: -0.85,
  heath_mat: -0.85,
  bush_spruce: -0.8,
  spruce: -0.7,
  pine: -0.7,
  dead: -0.9,
  palm: 0.1,
  mangrove: 0.2,
  jungle: 0.15,
  jungle_giant: 0.2,
  baobab: 0.05,
  acacia: -0.1,
};

const GIANT_SPECIES = new Set<TreeSpeciesName>(["big_oak", "jungle_giant", "redwood", "baobab"]);
const DESERT_SPECIES = new Set<TreeSpeciesName>(["saguaro", "barrel_cactus"]);

export interface TreeSite {
  worldX: number;
  worldZ: number;
  species: TreeSpeciesName;
  heightScale: number;
  leafVariant?: BlockType;
  priority: number;
  groundY: number;
}

function pickSpawn(column: ColumnInfo, roll: number) {
  const { trees } = column.biome;
  let totalWeight = 0;
  for (const spawn of trees) totalWeight += spawn.weight;
  let remaining = roll * totalWeight;
  for (const spawn of trees) {
    remaining -= spawn.weight;
    if (remaining <= 0) return spawn;
  }
  return trees[trees.length - 1];
}

export function groveFactorAt(worldX: number, worldZ: number, seed: number): number {
  const groves = smoothValueNoise(worldX / 58, worldZ / 58, seed + 11);
  const clearings = smoothValueNoise(worldX / 17, worldZ / 17, seed + 12);
  return lerp(0.2, 1.75, groves) * lerp(0.6, 1.2, clearings);
}

function decideSite(cellX: number, cellZ: number, columns: ColumnLookup, seed: number): TreeSite | null {
  const spread = CELL_SIZE - CELL_JITTER_MARGIN * 2;
  const worldX = cellX * CELL_SIZE + CELL_JITTER_MARGIN + Math.floor(hashToUnit(cellX, cellZ, seed + 21) * spread);
  const worldZ = cellZ * CELL_SIZE + CELL_JITTER_MARGIN + Math.floor(hashToUnit(cellX, cellZ, seed + 22) * spread);
  const column = columns.columnAt(worldX, worldZ);
  const { biome } = column;
  if (biome.trees.length === 0) return null;

  if (column.isSubmerged) {
    const isTidalMangrove = biome.id === BiomeId.MangroveSwamp && column.waterLevel - column.groundTopY <= 3;
    if (!isTidalMangrove) return null;
  }

  const slopeFactor = 1 - smoothstep(1.0, 1.9, column.slope);
  const nearFreshWater = column.sample.riverValleyWeight > 0.1 || column.sample.lakeWeight > 0 ? 1.4 : 1;
  const density = biome.treeDensity * groveFactorAt(worldX, worldZ, seed) * slopeFactor * nearFreshWater;
  if (hashToUnit(cellX, cellZ, seed + 23) >= density) return null;

  const spawn = pickSpawn(column, hashToUnit(cellX, cellZ, seed + 24));
  const coldLimit = COLD_TOLERANCE[spawn.species] ?? COLD_TOLERANCE_DEFAULT;
  if (column.temperature < coldLimit) return null;

  const isDesertPlant = DESERT_SPECIES.has(spawn.species);
  const coldStunting = smoothstep(coldLimit, coldLimit + 0.3, column.temperature);
  const drynessStunting = isDesertPlant ? 1 : lerp(0.75, 1, smoothstep(-0.8, -0.2, column.humidity));
  const sizeVariation = lerp(0.9, 1.12, hashToUnit(cellX, cellZ, seed + 25));
  return {
    worldX,
    worldZ,
    species: spawn.species,
    heightScale: Math.max(0.35, lerp(0.45, 1, coldStunting) * drynessStunting * sizeVariation),
    leafVariant: spawn.leafVariant,
    priority: hashToUnit(cellX, cellZ, seed + 26),
    groundY: column.groundTopY,
  };
}

export function placeTrees(
  blocks: Uint8Array,
  seed: number,
  chunkX: number,
  chunkY: number,
  chunkZ: number,
  columns: ColumnLookup,
): number {
  const chunkWorldX = chunkX * CHUNK_WIDTH;
  const chunkWorldY = chunkY * 32;
  const chunkWorldZ = chunkZ * CHUNK_LENGTH;
  const reach = MAX_TREE_FOOTPRINT_RADIUS + CELL_SIZE;
  const firstCellX = Math.floor((chunkWorldX - reach) / CELL_SIZE) - 1;
  const lastCellX = Math.floor((chunkWorldX + CHUNK_WIDTH + reach) / CELL_SIZE) + 1;
  const firstCellZ = Math.floor((chunkWorldZ - reach) / CELL_SIZE) - 1;
  const lastCellZ = Math.floor((chunkWorldZ + CHUNK_LENGTH + reach) / CELL_SIZE) + 1;

  const sites = new Map<number, TreeSite | null>();
  const siteKey = (cellX: number, cellZ: number) => (cellX + 100000) * 200003 + (cellZ + 100000);
  for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
    for (let cellZ = firstCellZ; cellZ <= lastCellZ; cellZ++) {
      sites.set(siteKey(cellX, cellZ), decideSite(cellX, cellZ, columns, seed));
    }
  }

  const writer = new ChunkTreeWriter(blocks, chunkWorldX, chunkWorldY, chunkWorldZ);
  let treesPlaced = 0;
  for (let cellX = firstCellX + 1; cellX < lastCellX; cellX++) {
    for (let cellZ = firstCellZ + 1; cellZ < lastCellZ; cellZ++) {
      const site = sites.get(siteKey(cellX, cellZ));
      if (!site) continue;
      const species = TREE_SPECIES[site.species];
      const isOutOfReach =
        site.worldX + species.footprintRadius < chunkWorldX ||
        site.worldX - species.footprintRadius >= chunkWorldX + CHUNK_WIDTH ||
        site.worldZ + species.footprintRadius < chunkWorldZ ||
        site.worldZ - species.footprintRadius >= chunkWorldZ + CHUNK_LENGTH ||
        site.groundY + 1 + species.maxHeight < chunkWorldY ||
        site.groundY + 1 - 4 >= chunkWorldY + 32;
      if (isOutOfReach) continue;
      if (isCrowdedOut(site, cellX, cellZ, sites, siteKey)) continue;

      const randomSeed = Math.floor(hashToUnit(site.worldX, site.worldZ, seed + 27) * 4294967296);
      writer.setOrigin(site.worldX, site.groundY + 1, site.worldZ);
      species.build(writer, {
        random: createRandomStream(randomSeed),
        heightScale: site.heightScale,
        leafVariant: site.leafVariant,
      });
      treesPlaced++;
    }
  }
  return treesPlaced;
}

function isCrowdedOut(
  site: TreeSite,
  cellX: number,
  cellZ: number,
  sites: Map<number, TreeSite | null>,
  siteKey: (cellX: number, cellZ: number) => number,
): boolean {
  const isGiant = GIANT_SPECIES.has(site.species);
  for (let offsetX = -1; offsetX <= 1; offsetX++) {
    for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
      if (offsetX === 0 && offsetZ === 0) continue;
      const neighbor = sites.get(siteKey(cellX + offsetX, cellZ + offsetZ));
      if (!neighbor || !GIANT_SPECIES.has(neighbor.species)) continue;
      if (!isGiant || neighbor.priority > site.priority) return true;
    }
  }
  return false;
}

function createRandomStream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
