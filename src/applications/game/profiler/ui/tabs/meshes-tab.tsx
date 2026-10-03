import type { HeaviestMesh, ProfileReport } from "../../types";
import { formatBytes, formatCount } from "../format";
import { DataTable, SectionTitle, type Column } from "../table";

const COLUMNS: Column<HeaviestMesh>[] = [
  { header: "chunk", render: (mesh) => mesh.chunkName, className: "text-zinc-100" },
  { header: "kind", render: (mesh) => mesh.kind },
  { header: "vertices", align: "right", render: (mesh) => formatCount(mesh.vertexCount) },
  { header: "triangles", align: "right", render: (mesh) => formatCount(mesh.triangleCount) },
  { header: "size", align: "right", render: (mesh) => formatBytes(mesh.totalBytes) },
];

export function MeshesTab({ report }: { report: ProfileReport }) {
  const { meshes } = report.snapshot;
  const vertices = meshes.verticesPerMesh;
  return (
    <div>
      <SectionTitle>Live chunk geometry</SectionTitle>
      <div className="space-y-0.5 px-1 text-zinc-300">
        <div>{meshes.liveMeshes} meshes live, {meshes.builtTotal} built this session</div>
        <div>{formatCount(meshes.liveVertices)} vertices, {formatCount(meshes.liveTriangles)} triangles, {formatBytes(meshes.liveBytes)}</div>
        <div>
          vertices per mesh: mean {formatCount(vertices.mean)}, p50 {formatCount(vertices.p50)}, p95 {formatCount(vertices.p95)}, max {formatCount(vertices.max)}
        </div>
      </div>
      <SectionTitle>Heaviest meshes</SectionTitle>
      <DataTable columns={COLUMNS} rows={meshes.heaviest} getKey={(mesh) => `${mesh.chunkName}|${mesh.kind}`} />
    </div>
  );
}
