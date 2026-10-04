// Counters the LOD manager exposes (overlay, profiler gauges, benchmark).

export interface LevelBuildStatistics {
  tiles: number;
  totalSampleMilliseconds: number;
  totalMeshMilliseconds: number;
  totalVertices: number;
  totalGeometryBytes: number;
  totalPackedSurfaceBytes: number;
}

export interface LodStats {
  selectedTiles: number;
  drawnTiles: number;
  missingTiles: number;
  queuedBuilds: number;
  buildsInFlight: number;
  builtTiles: number;
  failedBuilds: number;
  cachedTiles: number;
  cacheBytes: number;
  cacheBudgetBytes: number;
  evictedTiles: number;
  realDataNodes: number;
  realDataBytes: number;
  coveredColumns: number;
  pendingRealColumns: number;
  /** Milliseconds from creation until the whole radius first had something drawn (undefined until then). */
  firstHorizonMilliseconds: number | undefined;
  /** Milliseconds from creation until every selected tile was first drawn at its own level. */
  fullDetailMilliseconds: number | undefined;
  nearPlane: number;
  farPlane: number;
  buildsByLevel: Record<number, LevelBuildStatistics>;
}

export function createEmptyLevelStatistics(): LevelBuildStatistics {
  return { tiles: 0, totalSampleMilliseconds: 0, totalMeshMilliseconds: 0, totalVertices: 0, totalGeometryBytes: 0, totalPackedSurfaceBytes: 0 };
}
