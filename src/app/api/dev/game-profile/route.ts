/**
 * Dev-only tooling endpoint (deliberately not tRPC): the in-game profiler posts
 * its report here so it lands in `<repo>/.profiles/` where an agent can read it.
 * Disabled outside development. The client never chooses a path; filenames are
 * generated here from the report kind and the current time.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderBenchmarkMarkdown, renderMarkdownReport } from "@/applications/game/profiler/markdown-report";
import type { BenchmarkResult, ProfileReport } from "@/applications/game/profiler/types";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const PROFILE_DIRECTORY_NAME = ".profiles";
const MAX_LABEL_LENGTH = 100;

type SaveKind = "snapshot" | "benchmark";

interface SaveRequestBody {
  kind: SaveKind;
  label?: string;
  report?: ProfileReport;
  benchmark?: BenchmarkResult;
}

function jsonResponse(body: object, status: number) {
  return Response.json(body, { status });
}

function isValidReport(report: unknown): report is ProfileReport {
  const candidate = report as Partial<ProfileReport> | undefined;
  return (
    !!candidate &&
    typeof candidate.snapshot?.schemaVersion === "number" &&
    Array.isArray(candidate.snapshot.timers) &&
    Array.isArray(candidate.targets) &&
    Array.isArray(candidate.hints)
  );
}

function isValidBenchmark(benchmark: unknown): benchmark is BenchmarkResult {
  const candidate = benchmark as Partial<BenchmarkResult> | undefined;
  return (
    !!candidate &&
    typeof candidate.schemaVersion === "number" &&
    Array.isArray(candidate.phases) &&
    candidate.phases.every((phase) => isValidReport(phase.report)) &&
    isValidReport(candidate.overall)
  );
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return jsonResponse({ error: "Not found" }, 404);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Profile is larger than 8 MB" }, 413);
  }
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Profile is larger than 8 MB" }, 413);
  }

  let body: SaveRequestBody;
  try {
    body = JSON.parse(rawBody) as SaveRequestBody;
  } catch {
    return jsonResponse({ error: "Body is not valid JSON" }, 400);
  }

  const label = typeof body.label === "string" ? body.label.slice(0, MAX_LABEL_LENGTH) : undefined;
  let jsonContent: string;
  let markdownContent: string;

  if (body.kind === "snapshot" && isValidReport(body.report)) {
    const report = label
      ? { ...body.report, snapshot: { ...body.report.snapshot, label } }
      : body.report;
    jsonContent = JSON.stringify(report, null, 2);
    markdownContent = renderMarkdownReport(report);
  } else if (body.kind === "benchmark" && isValidBenchmark(body.benchmark)) {
    jsonContent = JSON.stringify(body.benchmark, null, 2);
    markdownContent = renderBenchmarkMarkdown(body.benchmark);
  } else {
    return jsonResponse({ error: "Expected a snapshot report or a benchmark result" }, 400);
  }

  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const directory = path.join(process.cwd(), PROFILE_DIRECTORY_NAME);
  await mkdir(directory, { recursive: true });

  const stampedBaseName = `${body.kind}-${timestamp}`;
  const latestBaseName = `latest-${body.kind}`;
  await Promise.all([
    writeFile(path.join(directory, `${stampedBaseName}.json`), jsonContent),
    writeFile(path.join(directory, `${stampedBaseName}.md`), markdownContent),
    writeFile(path.join(directory, `${latestBaseName}.json`), jsonContent),
    writeFile(path.join(directory, `${latestBaseName}.md`), markdownContent),
  ]);

  return jsonResponse(
    {
      jsonPath: `${PROFILE_DIRECTORY_NAME}/${stampedBaseName}.json`,
      markdownPath: `${PROFILE_DIRECTORY_NAME}/${stampedBaseName}.md`,
    },
    200,
  );
}
