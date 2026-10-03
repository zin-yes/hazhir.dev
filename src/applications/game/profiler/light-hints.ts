import { buildLightEditRows } from "./light-report";
import type { OptimizationHint, ProfileSnapshot } from "./types";
import { formatMilliseconds } from "./ui/format";

/** An edit that takes longer than this to show up feels laggy. */
export const LIGHT_EDIT_P95_MEDIUM_MS = 40;
export const LIGHT_EDIT_P95_HIGH_MS = 100;
const MESH_STAGE_NAMES = new Set(["queueMeshes"]);

/** Flags the block edit kind whose click-to-pixels time is the worst, with the stage that eats it. */
export function lightEditLatencyHint(
  snapshot: ProfileSnapshot,
): OptimizationHint | null {
  const slowest = buildLightEditRows(snapshot)
    .filter((row) => row.total.count >= 3)
    .sort((first, second) => second.total.p95 - first.total.p95)[0];
  if (!slowest || slowest.total.p95 < LIGHT_EDIT_P95_MEDIUM_MS) return null;

  const topStage = slowest.stages[0];
  const remeshSharePercent =
    slowest.remesh && slowest.total.mean > 0
      ? (slowest.remesh.mean / slowest.total.mean) * 100
      : 0;
  const chunksTouched = slowest.counters.find(
    (counter) => counter.name === "chunksRelit",
  )?.perEdit;
  const stageText = topStage
    ? `slowest stage ${topStage.name} at ${formatMilliseconds(topStage.timer.mean)} (${topStage.shareOfTotalPercent.toFixed(0)}% of the edit)`
    : "no stage breakdown recorded";
  const isMeshBound =
    remeshSharePercent > 60 ||
    (topStage && MESH_STAGE_NAMES.has(topStage.name));

  return {
    severity: slowest.total.p95 >= LIGHT_EDIT_P95_HIGH_MS ? "high" : "medium",
    title: "Light edits are slow to show",
    evidence: `${slowest.kind} takes ${formatMilliseconds(slowest.total.mean)} on average and ${formatMilliseconds(slowest.total.p95)} at p95 from edit to pixels over ${slowest.total.count} edits; ${stageText}${chunksTouched !== undefined ? `; ${chunksTouched.toFixed(1)} chunks relit per edit` : ""}.`,
    suggestion: isMeshBound
      ? "Most of the time is re-meshing: rebuild only the chunks whose light or blocks actually changed, and cut the mesh work per chunk."
      : "Most of the time is relighting: patch light in place around the edited block (remove what depended on it, then refill) instead of recomputing whole chunks through worker round trips.",
  };
}
