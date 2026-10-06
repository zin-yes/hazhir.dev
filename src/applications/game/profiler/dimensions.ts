/**
 * Names of the breakdown dimensions: cost grouped by a domain key. Use these
 * constants instead of string literals so every system, report and overlay tab
 * agrees on them. Keys are plain strings (biome id, feature id, block name).
 * Compose a cross dimension key with "|" (for example `${biome}|${feature}`).
 */
export const DIMENSIONS = {
  /** Worldgen time and units per biome, summed over all stages that know the biome. */
  worldgenBiome: "worldgen.biome",
  /** Worldgen time per pipeline stage (noise, aquifer, carvers, surface, features). */
  worldgenStage: "worldgen.stage",
  /** Biome x stage matrix. Key: `${biome}|${stage}`. */
  worldgenBiomeStage: "worldgen.biomeStage",
  /** Feature placement time and placements per configured feature id. */
  worldgenFeature: "worldgen.feature",
  /** Feature placement time per feature type class (tree, ore, geode, ...). */
  worldgenFeatureType: "worldgen.featureType",
  /** Biome x feature matrix. Key: `${biome}|${feature}`. */
  worldgenBiomeFeature: "worldgen.biomeFeature",
  /** Carver time per carver id. */
  worldgenCarver: "worldgen.carver",
  /** Density function node evaluations per node type. */
  worldgenDensityNode: "worldgen.densityNode",
  /** Surface rule evaluation per rule type. */
  worldgenSurfaceRule: "worldgen.surfaceRule",
  /** Blocks produced by worldgen, per Minecraft block name (units = block count). */
  worldgenBlock: "worldgen.block",
  /** Blocks converted to game blocks, per game block type name (units = block count). */
  gameBlock: "game.block",
  /** Mesh faces emitted per game block type (units = faces). */
  meshBlockFaces: "mesh.blockFaces",
  /** Mesh time per chunk kind or mesh part. */
  meshPart: "mesh.part",
  /** Lighting time per edit kind or stage. */
  lightKind: "light.kind",
  /** Physics / simulation time per entity or system. */
  simulationSystem: "sim.system",
  /** Main-thread time per UI surface. */
  uiSurface: "ui.surface",
  // shadows, post and sky
  /** Shadow cascade draws: calls and CPU time per cascade (`cascade0`, `cascade1`, `cascade2`). */
  shadowCascade: "shadow.cascade",
  // workers, lod, worker pool, chunk geometry
  /** Cost per LOD level. Key: `L<level>`. */
  lodLevel: "lod.level",
  /** Mesh time and quads per face direction (up, down, front, back, left, right). */
  meshFaceDirection: "mesh.faceDirection",
  /** Packed vertex bytes per attribute (position, surface). Units = bytes. */
  meshVertexAttribute: "mesh.vertexAttribute",
  /** Light propagation per channel (sky, block). */
  lightChannel: "light.channel",
  /** Worker pool queue wait and task count per priority. */
  poolPriority: "pool.priority",
  /** Geometry attribute bytes per attribute name. Units = bytes. */
  geometryAttribute: "geometry.attribute",
  /** Texture array load time and bytes fetched per texture file. */
  textureFile: "texture.file",
  // world and edits
  /** Streaming planner decisions per reason (loaded, alreadyKnown, skippedAboveSurface, unloaded, ...). Units = chunks. */
  streamingDecision: "streaming.decision",
  /** Scheduler traffic per lane (generation, lighting, mesh): units = dispatched jobs, time = queue wait. */
  schedulerLane: "scheduler.lane",
  /** Chunk compression per chosen representation (uniform, palette, runs, raw): time and units = bytes in. */
  compressionKind: "compression.kind",
  /** Light flood cells per channel and wave (skyRemoved, blockRemoved, spread, ...). Units = cells. */
  lightFloodWave: "lightFlood.wave",
  /** Block edit work per brush mode (fill, erase, fillAirOnly, replaceNonAirOnly). Units = edited cells. */
  editMode: "edit.mode",
  /** Edit side effects per kind (savedEdit, savedEditOutsideLoaded, waterWake). Time and units. */
  editSideEffect: "edit.sideEffect",
  /** Voxel ray casts per outcome (hit, miss, startedInside). Units = steps walked. */
  rayOutcome: "ray.outcome",
  /** Border slab extraction per mesh face direction. Units = bytes copied. */
  borderFace: "border.face",
  /** Live chunk records per pipeline stage. Units = chunks (sampled once per second). */
  chunkStage: "chunk.stage",
} as const;

export type DimensionName = (typeof DIMENSIONS)[keyof typeof DIMENSIONS];
