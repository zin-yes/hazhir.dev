import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { simulateSnapshot, worldgenScenario, worldgenTask } from "../src/applications/game/profiler/profile-fixtures";
import { buildProfileReport } from "../src/applications/game/profiler/report";
import { resolveProfileArgument, runProfileDiff } from "./profile-diff";

let workingDirectory: string;

beforeEach(async () => {
  workingDirectory = await mkdtemp(path.join(tmpdir(), "profile-diff-"));
  await mkdir(path.join(workingDirectory, ".profiles/baselines"), { recursive: true });
});

afterEach(async () => {
  await rm(workingDirectory, { recursive: true, force: true });
});

describe("resolveProfileArgument", () => {
  test("maps the shortcuts to files under .profiles", () => {
    expect(resolveProfileArgument("latest", "/repo")).toBe("/repo/.profiles/latest-benchmark.json");
    expect(resolveProfileArgument("baseline:before-fix", "/repo")).toBe("/repo/.profiles/baselines/before-fix.json");
    expect(resolveProfileArgument("out/run.json", "/repo")).toBe("/repo/out/run.json");
  });

  test("refuses baseline names that could leave the baselines folder", () => {
    expect(() => resolveProfileArgument("baseline:../../secrets", "/repo")).toThrow("must match");
  });
});

describe("runProfileDiff", () => {
  test("diffs a baseline against a snapshot file, prints the regression and writes latest-diff.md", async () => {
    const baseReport = buildProfileReport(simulateSnapshot(worldgenScenario()));
    const slowerTask = worldgenTask({
      nestedSections: [
        { name: "noise", selfMs: 30, children: [{ name: "density", selfMs: 4, calls: 4096, estimated: true }] },
        { name: "carve", selfMs: 3 },
      ],
      executionMs: 44,
    });
    const currentReport = buildProfileReport(simulateSnapshot(worldgenScenario({ workerTasks: [slowerTask] })));
    await writeFile(path.join(workingDirectory, ".profiles/baselines/before.json"), JSON.stringify(baseReport));
    await writeFile(path.join(workingDirectory, "after.json"), JSON.stringify(currentReport));

    const markdown = await runProfileDiff("baseline:before", "after.json", workingDirectory);

    expect(markdown).toContain("worldgen.generateChunk: noise");
    const saved = await readFile(path.join(workingDirectory, ".profiles/latest-diff.md"), "utf8");
    expect(saved).toBe(markdown);
    expect(saved).toMatch(/\| callTree \| worldgen\.generateChunk: noise \| self per call \| 6\.00ms \| 30\.0ms \| \+24\.0ms \| \+400\.0% \|/);
  });

  test("explains which file could not be read", async () => {
    await expect(runProfileDiff("missing.json", "missing.json", workingDirectory)).rejects.toThrow("Could not read a profile from");
  });
});
