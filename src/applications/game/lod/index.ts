// Public surface of the LOD engine (see README.md for the integration steps).

export { createLodManager, MAXIMUM_RENDER_DISTANCE_CHUNKS, maximumLevelForRadius, type LodManager, type LodManagerOptions } from "./manager/lod-manager";
export type { LevelBuildStatistics, LodStats } from "./manager/lod-stats";
export { createInProcessExecutor, createWorkerPoolExecutor, LOD_WORKER_POOL_NAME, type TileBuildExecutor } from "./manager/tile-build-executor";
