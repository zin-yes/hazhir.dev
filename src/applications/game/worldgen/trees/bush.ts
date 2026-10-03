/**
 * Bushes: leaf-only shrubs with no logs. bush_oak (honours leafVariant), bush_spruce (stacked conifer
 * shrub), bush_autumn (leafVariant if given, else a random autumn colour) and heath_mat
 * (flat one block high mat, leafVariant if given, else oak leaves).
 */
import { BlockType } from "@/applications/game/blocks";
import {
  canopyScaleFor,
  createLeafPaint,
  createSolidLeafPaint,
  fillLeafEllipsoid,
  placeLeafDisc,
  randomBetween,
  randomIntegerInclusive,
} from "./tree-geometry";
import type { LeafPaint } from "./tree-geometry";
import type { TreeBlockWriter, TreeBuildOptions, TreeSpecies } from "./tree-types";

const AUTUMN_LEAVES = [BlockType.LEAVES_AUTUMN_RED, BlockType.LEAVES_AUTUMN_ORANGE, BlockType.LEAVES_AUTUMN_YELLOW];

function buildLeafBlobBush(writer: TreeBlockWriter, options: TreeBuildOptions, paint: LeafPaint): void {
  const { random } = options;
  const canopyScale = canopyScaleFor(options.heightScale);
  fillLeafEllipsoid(writer, paint, 0, 0.4, 0, randomBetween(random, 1.4, 1.9) * canopyScale, randomBetween(random, 1.1, 1.35), randomBetween(random, 1.4, 1.9) * canopyScale, random, 0.2);
  const sideBlobCount = randomIntegerInclusive(random, 1, 2);
  for (let blobIndex = 0; blobIndex < sideBlobCount; blobIndex++) {
    const offsetX = randomIntegerInclusive(random, -1, 1);
    const offsetZ = randomIntegerInclusive(random, -1, 1);
    fillLeafEllipsoid(writer, paint, offsetX, 0.3, offsetZ, 1.3 * canopyScale, 1.1, 1.3 * canopyScale, random, 0.25);
  }
}

function buildBushOak(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  buildLeafBlobBush(writer, options, createLeafPaint(BlockType.LEAVES, options));
}

function buildBushAutumn(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const autumnLeaf = options.leafVariant ?? AUTUMN_LEAVES[randomIntegerInclusive(options.random, 0, 2)];
  buildLeafBlobBush(writer, options, createSolidLeafPaint(autumnLeaf));
}

function buildBushSpruce(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const canopyScale = canopyScaleFor(options.heightScale);
  const paint = createSolidLeafPaint(BlockType.LEAVES_SPRUCE);
  const baseRadius = randomBetween(random, 1.6, 2.1) * canopyScale;
  placeLeafDisc(writer, paint, 0, 0, 0, baseRadius, baseRadius * randomBetween(random, 0.85, 1), random, 0.25);
  placeLeafDisc(writer, paint, 0, 1, 0, baseRadius * 0.65, baseRadius * 0.6, random, 0.2);
  if (random() < 0.5) placeLeafDisc(writer, paint, 0, 2, 0, 0.6, 0.6, random, 0);
}

function buildHeathMat(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const canopyScale = canopyScaleFor(options.heightScale);
  const paint = createLeafPaint(BlockType.LEAVES, options);
  const matRadiusX = randomBetween(random, 1.6, 2.4) * canopyScale;
  const matRadiusZ = randomBetween(random, 1.4, 2.2) * canopyScale;
  placeLeafDisc(writer, paint, 0, 0, 0, matRadiusX, matRadiusZ, random, 0.35);
}

export const BUSH_OAK_SPECIES: TreeSpecies = { name: "bush_oak", footprintRadius: 3, maxHeight: 3, build: buildBushOak };
export const BUSH_SPRUCE_SPECIES: TreeSpecies = { name: "bush_spruce", footprintRadius: 3, maxHeight: 4, build: buildBushSpruce };
export const BUSH_AUTUMN_SPECIES: TreeSpecies = { name: "bush_autumn", footprintRadius: 3, maxHeight: 3, build: buildBushAutumn };
export const HEATH_MAT_SPECIES: TreeSpecies = { name: "heath_mat", footprintRadius: 3, maxHeight: 2, build: buildHeathMat };
