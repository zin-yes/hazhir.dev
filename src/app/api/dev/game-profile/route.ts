/**
 * Dev-only tooling endpoint (deliberately not tRPC): the in-game profiler posts
 * its report here so it lands in `<repo>/.profiles/` where an agent can read it.
 * Disabled outside development. The client never chooses a path; filenames are
 * generated here from the request kind and the current time, and the only
 * client-supplied name (a baseline) must match BASELINE_NAME_PATTERN.
 *
 * POST kinds: snapshot, benchmark, trace (latest-trace.json), diff
 * (latest-diff.md), baseline (baselines/<name>.json). GET reads a baseline back.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderBenchmarkMarkdown, renderMarkdownReport } from "@/applications/game/profiler/markdown-report";
import type { BenchmarkResult, ProfileReport } from "@/applications/game/profiler/types";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_TRACE_BODY_BYTES = 64 * 1024 * 1024;
const MAX_DIFF_MARKDOWN_LENGTH = 2 * 1024 * 1024;
const PROFILE_DIRECTORY_NAME = ".profiles";
const BASELINE_DIRECTORY_NAME = "baselines";
const MAX_LABEL_LENGTH = 100;
const BASELINE_NAME_PATTERN = /^[a-z0-9-]{1,40}$/;

type SaveKind = "snapshot" | "benchmark" | "trace" | "diff" | "baseline";

interface SaveRequestBody {
  kind: SaveKind;
  label?: string;
  report?: ProfileReport;
  benchmark?: BenchmarkResult;
  /** Chrome trace event JSON, already serialized by the client. */
  traceJson?: string;
  markdown?: string;
  name?: string;
}

function jsonResponse(body: object, status: number) {
  return Response.json(body, { status });
}

function isProduction() {
  return process.env.NODE_ENV === "production";
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

function isValidTraceJson(traceJson: unknown): traceJson is string {
  if (typeof traceJson !== "string") return false;
  try {
    return Array.isArray((JSON.parse(traceJson) as { traceEvents?: unknown }).traceEvents);
  } catch {
    return false;
  }
}

function profileDirectory() {
  return path.join(process.cwd(), PROFILE_DIRECTORY_NAME);
}

function baselineDirectory() {
  return path.join(profileDirectory(), BASELINE_DIRECTORY_NAME);
}

async function readBodyText(request: Request): Promise<string | null> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_TRACE_BODY_BYTES) return null;
  const rawBody = await request.text();
  return rawBody.length > MAX_TRACE_BODY_BYTES ? null : rawBody;
}

export async function POST(request: Request) {
  if (isProduction()) return jsonResponse({ error: "Not found" }, 404);

  const rawBody = await readBodyText(request);
  if (rawBody === null) return jsonResponse({ error: "Body is larger than 64 MB" }, 413);

  let body: SaveRequestBody;
  try {
    body = JSON.parse(rawBody) as SaveRequestBody;
  } catch {
    return jsonResponse({ error: "Body is not valid JSON" }, 400);
  }
  if (body.kind !== "trace" && rawBody.length > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Profile is larger than 8 MB" }, 413);
  }

  switch (body.kind) {
    case "snapshot":
    case "benchmark":
      return saveReport(body);
    case "trace":
      return saveTrace(body);
    case "diff":
      return saveDiff(body);
    case "baseline":
      return saveBaseline(body);
    default:
      return jsonResponse({ error: "Expected a snapshot, benchmark, trace, diff or baseline" }, 400);
  }
}

async function saveReport(body: SaveRequestBody) {
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
  const directory = profileDirectory();
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

async function saveTrace(body: SaveRequestBody) {
  if (!isValidTraceJson(body.traceJson)) {
    return jsonResponse({ error: "Expected traceJson with a traceEvents array" }, 400);
  }
  await mkdir(profileDirectory(), { recursive: true });
  await writeFile(path.join(profileDirectory(), "latest-trace.json"), body.traceJson);
  return jsonResponse({ tracePath: `${PROFILE_DIRECTORY_NAME}/latest-trace.json` }, 200);
}

async function saveDiff(body: SaveRequestBody) {
  if (typeof body.markdown !== "string" || body.markdown.length > MAX_DIFF_MARKDOWN_LENGTH) {
    return jsonResponse({ error: "Expected diff markdown under 2 MB" }, 400);
  }
  await mkdir(profileDirectory(), { recursive: true });
  await writeFile(path.join(profileDirectory(), "latest-diff.md"), body.markdown);
  return jsonResponse({ diffPath: `${PROFILE_DIRECTORY_NAME}/latest-diff.md` }, 200);
}

async function saveBaseline(body: SaveRequestBody) {
  if (typeof body.name !== "string" || !BASELINE_NAME_PATTERN.test(body.name)) {
    return jsonResponse({ error: "Baseline name must match [a-z0-9-]{1,40}" }, 400);
  }
  const content = isValidBenchmark(body.benchmark)
    ? body.benchmark
    : isValidReport(body.report)
      ? body.report
      : null;
  if (!content) return jsonResponse({ error: "Expected a snapshot report or a benchmark result" }, 400);

  await mkdir(baselineDirectory(), { recursive: true });
  await writeFile(path.join(baselineDirectory(), `${body.name}.json`), JSON.stringify(content, null, 2));
  return jsonResponse(
    { baselinePath: `${PROFILE_DIRECTORY_NAME}/${BASELINE_DIRECTORY_NAME}/${body.name}.json` },
    200,
  );
}

/** `?baseline=<name>` returns that baseline's JSON; without it, lists the saved baseline names. */
export async function GET(request: Request) {
  if (isProduction()) return jsonResponse({ error: "Not found" }, 404);

  const name = new URL(request.url).searchParams.get("baseline");
  if (name === null) {
    const files = await readdir(baselineDirectory()).catch(() => [] as string[]);
    const baselines = files.filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -".json".length));
    return jsonResponse({ baselines }, 200);
  }
  if (!BASELINE_NAME_PATTERN.test(name)) {
    return jsonResponse({ error: "Baseline name must match [a-z0-9-]{1,40}" }, 400);
  }
  try {
    const content = await readFile(path.join(baselineDirectory(), `${name}.json`), "utf8");
    return new Response(content, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch {
    return jsonResponse({ error: `No baseline named ${name}` }, 404);
  }
}
