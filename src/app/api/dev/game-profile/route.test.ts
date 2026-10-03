import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { busyGameScenario, simulateSnapshot } from "@/applications/game/profiler/profile-fixtures";
import { buildProfileReport } from "@/applications/game/profiler/report";
import { POST } from "./route";

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
