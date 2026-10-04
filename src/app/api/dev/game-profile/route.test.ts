import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { diffProfiles, renderDiffMarkdown } from "@/applications/game/profiler/diff";
import { simulateSnapshot, busyGameScenario, worldgenScenario } from "@/applications/game/profiler/profile-fixtures";
import { exportTrace } from "@/applications/game/profiler/trace-export";
import { buildProfileReport } from "@/applications/game/profiler/report";
import { GET, POST } from "./route";

const originalWorkingDirectory = process.cwd();
const originalEnvironment = process.env.NODE_ENV;
let temporaryDirectory: string;

function postJson(body: unknown) {
  return POST(
    new Request("http://localhost/api/dev/game-profile", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

function getBaseline(query: string) {
  return GET(new Request(`http://localhost/api/dev/game-profile${query}`));
}

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "game-profile-route-"));
  process.chdir(temporaryDirectory);
  (process.env as Record<string, string>).NODE_ENV = "development";
});

afterEach(async () => {
  process.chdir(originalWorkingDirectory);
  (process.env as Record<string, string>).NODE_ENV = originalEnvironment ?? "test";
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("POST /api/dev/game-profile", () => {
  const report = buildProfileReport(simulateSnapshot(busyGameScenario()));

  test("writes stamped and latest json and markdown files into .profiles", async () => {
    const response = await postJson({ kind: "snapshot", label: "after mesh change", report });
    expect(response.status).toBe(200);
    const { jsonPath, markdownPath } = await response.json();
    expect(jsonPath).toMatch(/^\.profiles\/snapshot-.*\.json$/);
    expect(jsonPath).not.toContain(":");

    const files = await readdir(path.join(temporaryDirectory, ".profiles"));
    expect(files).toContain("latest-snapshot.json");
    expect(files).toContain("latest-snapshot.md");
    expect(files.length).toBe(4);

    const savedMarkdown = await readFile(path.join(temporaryDirectory, markdownPath), "utf8");
    expect(savedMarkdown).toContain("# Game profile report: after mesh change");
    const savedJson = JSON.parse(await readFile(path.join(temporaryDirectory, jsonPath), "utf8"));
    expect(savedJson.targets.length).toBe(report.targets.length);
  });

  test("saves a benchmark result under its own kind", async () => {
    const benchmark = {
      schemaVersion: report.snapshot.schemaVersion,
      startedAtIso: "2026-10-03T10:00:00.000Z",
      seed: 7,
      phases: [{ name: "fly", durationSeconds: 5, report }],
      overall: report,
    };
    const response = await postJson({ kind: "benchmark", benchmark });
    expect(response.status).toBe(200);
    const files = await readdir(path.join(temporaryDirectory, ".profiles"));
    expect(files).toContain("latest-benchmark.md");
  });

  test("rejects malformed bodies without writing anything", async () => {
    expect((await postJson({ kind: "snapshot", report: { snapshot: {} } })).status).toBe(400);
    expect((await postJson({ kind: "../../etc/passwd", report })).status).toBe(400);
    const invalidJson = await POST(new Request("http://localhost/x", { method: "POST", body: "{nope" }));
    expect(invalidJson.status).toBe(400);
    expect(await readdir(temporaryDirectory)).toEqual([]);
  });

  test("is disabled in production", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect((await postJson({ kind: "snapshot", report })).status).toBe(404);
    expect(await readdir(temporaryDirectory)).toEqual([]);
  });
});

describe("POST /api/dev/game-profile trace and diff", () => {
  const tracedSnapshot = simulateSnapshot(worldgenScenario());
  const report = buildProfileReport(tracedSnapshot);

  test("writes the trace to a fixed filename and keeps it loadable", async () => {
    const traceJson = exportTrace(tracedSnapshot);
    const response = await postJson({ kind: "trace", traceJson });
    expect(response.status).toBe(200);
    expect((await response.json()).tracePath).toBe(".profiles/latest-trace.json");
    const saved = JSON.parse(await readFile(path.join(temporaryDirectory, ".profiles/latest-trace.json"), "utf8"));
    expect(saved.traceEvents.filter((event: { ph: string }) => event.ph === "X").length).toBeGreaterThan(500);
    expect(await readdir(path.join(temporaryDirectory, ".profiles"))).toEqual(["latest-trace.json"]);
  });

  test("accepts a trace larger than the 8 MB report limit", async () => {
    const filler = "x".repeat(9 * 1024 * 1024);
    const traceJson = JSON.stringify({ traceEvents: [{ name: filler, ph: "i" }] });
    expect((await postJson({ kind: "trace", traceJson })).status).toBe(200);
    expect((await postJson({ kind: "snapshot", report, label: filler })).status).toBe(413);
  });

  test("rejects a trace without events", async () => {
    expect((await postJson({ kind: "trace", traceJson: "{nope" })).status).toBe(400);
    expect((await postJson({ kind: "trace", traceJson: JSON.stringify({ traceEvents: "none" }) })).status).toBe(400);
    expect((await postJson({ kind: "trace" })).status).toBe(400);
    expect(await readdir(temporaryDirectory)).toEqual([]);
  });

  test("writes the diff markdown to latest-diff.md", async () => {
    const markdown = renderDiffMarkdown(diffProfiles(report, report));
    const response = await postJson({ kind: "diff", markdown });
    expect(response.status).toBe(200);
    expect(await readFile(path.join(temporaryDirectory, ".profiles/latest-diff.md"), "utf8")).toBe(markdown);
    expect((await postJson({ kind: "diff", markdown: 42 })).status).toBe(400);
  });
});

describe("baselines", () => {
  const report = buildProfileReport(simulateSnapshot(worldgenScenario()));

  test("saves a named baseline and reads the same data back", async () => {
    const response = await postJson({ kind: "baseline", name: "before-tree-cache", report });
    expect(response.status).toBe(200);
    expect((await response.json()).baselinePath).toBe(".profiles/baselines/before-tree-cache.json");

    const readBack = await getBaseline("?baseline=before-tree-cache");
    expect(readBack.status).toBe(200);
    const loaded = await readBack.json();
    expect(loaded.targets.length).toBe(report.targets.length);
    expect(loaded.snapshot.callTrees.length).toBe(report.snapshot.callTrees.length);
    expect(loaded.snapshot.breakdowns.length).toBeGreaterThan(0);
  });

  test("saves a benchmark result as a baseline too", async () => {
    const benchmark = {
      schemaVersion: report.snapshot.schemaVersion,
      startedAtIso: "2026-10-03T10:00:00.000Z",
      seed: 7,
      phases: [{ name: "fly", durationSeconds: 5, report }],
      overall: report,
    };
    expect((await postJson({ kind: "baseline", name: "bench-1", benchmark })).status).toBe(200);
    const loaded = await (await getBaseline("?baseline=bench-1")).json();
    expect(loaded.phases[0].name).toBe("fly");
  });

  test("lists the saved baseline names", async () => {
    await postJson({ kind: "baseline", name: "alpha", report });
    await postJson({ kind: "baseline", name: "beta-2", report });
    const listing = await (await getBaseline("")).json();
    expect(listing.baselines.sort()).toEqual(["alpha", "beta-2"]);
  });

  test("lists nothing before any baseline was saved", async () => {
    expect(await (await getBaseline("")).json()).toEqual({ baselines: [] });
  });

  test("rejects names that could leave the baselines folder or are malformed", async () => {
    for (const name of ["../../etc/passwd", "a/b", "UPPER", "with.dot", "", "a".repeat(41), "sp ace", 7]) {
      expect((await postJson({ kind: "baseline", name, report })).status).toBe(400);
    }
    for (const name of ["../latest-snapshot", "..%2Fx", "A", "a.b", "x".repeat(41)]) {
      expect((await getBaseline(`?baseline=${name}`)).status).toBe(400);
    }
    expect(await readdir(temporaryDirectory)).toEqual([]);
  });

  test("accepts the longest and shortest valid names", async () => {
    expect((await postJson({ kind: "baseline", name: "a", report })).status).toBe(200);
    expect((await postJson({ kind: "baseline", name: "z9-".repeat(13) + "z", report })).status).toBe(200);
  });

  test("rejects a baseline without a valid report and a missing baseline is a 404", async () => {
    expect((await postJson({ kind: "baseline", name: "empty", report: { snapshot: {} } })).status).toBe(400);
    expect((await getBaseline("?baseline=never-saved")).status).toBe(404);
  });

  test("is disabled in production for every kind", async () => {
    await postJson({ kind: "baseline", name: "kept", report });
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect((await postJson({ kind: "baseline", name: "other", report })).status).toBe(404);
    expect((await postJson({ kind: "trace", traceJson: JSON.stringify({ traceEvents: [] }) })).status).toBe(404);
    expect((await postJson({ kind: "diff", markdown: "x" })).status).toBe(404);
    expect((await getBaseline("?baseline=kept")).status).toBe(404);
    expect((await getBaseline("")).status).toBe(404);
    expect(await readdir(path.join(temporaryDirectory, ".profiles/baselines"))).toEqual(["kept.json"]);
  });
});
