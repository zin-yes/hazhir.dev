import { RollingStat } from "./rolling-stat";
import type { HeaviestMesh, MeshAggregate, MeshGeometryStats, MeshKind } from "./types";

const HEAVIEST_MESH_COUNT = 10;
const MESH_KINDS: MeshKind[] = ["opaque", "transparent", "plants"];

interface LiveMesh {
  chunkName: string;
  stats: MeshGeometryStats;
  totalBytes: number;
}

/** Tracks the geometry currently uploaded for chunk meshes, by attribute. */
export class MeshRegistry {
  private liveMeshes = new Map<string, LiveMesh>();
  private builtTotal = 0;
  private verticesPerMesh = new RollingStat();

  record(chunkName: string, stats: MeshGeometryStats, nowMs: number) {
    const key = meshKey(chunkName, stats.kind);
    let totalBytes = 0;
    for (const bytes of Object.values(stats.bytesByAttribute)) totalBytes += bytes;
    this.liveMeshes.set(key, { chunkName, stats, totalBytes });
    this.builtTotal++;
    this.verticesPerMesh.add(stats.vertexCount, nowMs);
  }

  remove(chunkName: string) {
    for (const kind of MESH_KINDS) this.liveMeshes.delete(meshKey(chunkName, kind));
  }

  clearLive() {
    this.liveMeshes.clear();
  }

  reset() {
    this.liveMeshes.clear();
    this.builtTotal = 0;
    this.verticesPerMesh = new RollingStat();
  }

  summary(nowMs: number): MeshAggregate {
    let liveVertices = 0;
    let liveTriangles = 0;
    let liveBytes = 0;
    const bytesByAttribute: { [attribute: string]: number } = {};
    const meshes = Array.from(this.liveMeshes.values());

    for (const mesh of meshes) {
      liveVertices += mesh.stats.vertexCount;
      liveTriangles += mesh.stats.triangleCount;
      liveBytes += mesh.totalBytes;
      for (const [attribute, bytes] of Object.entries(mesh.stats.bytesByAttribute)) {
        bytesByAttribute[attribute] = (bytesByAttribute[attribute] ?? 0) + bytes;
      }
    }

    const bytesPerVertexByAttribute: { [attribute: string]: number } = {};
    for (const [attribute, bytes] of Object.entries(bytesByAttribute)) {
      bytesPerVertexByAttribute[attribute] =
        liveVertices === 0 ? 0 : bytes / liveVertices;
    }

    const heaviest: HeaviestMesh[] = meshes
      .sort((first, second) => second.totalBytes - first.totalBytes)
      .slice(0, HEAVIEST_MESH_COUNT)
      .map((mesh) => ({
        chunkName: mesh.chunkName,
        kind: mesh.stats.kind,
        vertexCount: mesh.stats.vertexCount,
        triangleCount: mesh.stats.triangleCount,
        totalBytes: mesh.totalBytes,
      }));

    return {
      liveMeshes: meshes.length,
      liveVertices,
      liveTriangles,
      liveBytes,
      builtTotal: this.builtTotal,
      bytesByAttribute,
      bytesPerVertex: liveVertices === 0 ? 0 : liveBytes / liveVertices,
      bytesPerVertexByAttribute,
      verticesPerMesh: this.verticesPerMesh.summary(nowMs),
      heaviest,
    };
  }
}

function meshKey(chunkName: string, kind: MeshKind) {
  return `${chunkName}|${kind}`;
}
