import { describe, expect, test } from "bun:test";
import { renderBenchmarkMarkdown, renderMarkdownReport } from "./markdown-report";
import { busyGameScenario, simulateSnapshot } from "./profile-fixtures";
import { buildProfileReport } from "./report";
import { PROFILE_SCHEMA_VERSION, type BenchmarkResult } from "./types";

const report = buildProfileReport(simulateSnapshot(busyGameScenario()));

describe("renderMarkdownReport", () => {
  const markdown = renderMarkdownReport(report);

  test("has the sections an agent navigates by", () => {
    for (const heading of [
      "# Game profile report: simulated",
      "## Session",
      "## Frame time",
      "## Hints",
      "## Top targets",
      "### Main thread (self time, blocks frames)",
      "### Workers (background CPU)",
      "## Appendix",
      "### Worst frames",
    ]) {
      expect(markdown).toContain(heading);
    }
  });

  test("names the spike scope in the worst-frames table with its self time", () => {
    const worstSection = markdown.slice(markdown.indexOf("### Worst frames"));
    expect(worstSection).toContain("main.chunks.addChunkMesh 45.0ms");
  });

  test("lists the top main-thread target as the first ranked row", () => {
    const mainSection = markdown.slice(
      markdown.indexOf("### Main thread (self time, blocks frames)"),
    );
    const firstRow = mainSection.split("\n").find((line) => line.startsWith("| 1 |"));
    expect(firstRow).toContain("main.frame.render");
  });

  test("contains no em or en dashes", () => {
    expect(markdown).not.toMatch(/[\u2013\u2014]/);
  });

  test("includes cost per unit of worker work in the appendix", () => {
    expect(markdown).toContain("facesEmitted");
    expect(markdown).toMatch(/5\.\d\dus/);
  });
});

describe("renderBenchmarkMarkdown", () => {
  test("renders every phase followed by the overall report", () => {
    const result: BenchmarkResult = {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      startedAtIso: "2026-10-03T10:00:00.000Z",
      seed: 1337,
      phases: [
        { name: "fly", durationSeconds: 12, report },
        { name: "hover", durationSeconds: 12, report },
      ],
      overall: report,
    };
    const markdown = renderBenchmarkMarkdown(result);
    expect(markdown).toContain("Seed: 1337");
    expect(markdown).toContain("## Phase: fly (12.0s)");
    expect(markdown).toContain("## Phase: hover (12.0s)");
    expect(markdown.indexOf("## Overall")).toBeGreaterThan(markdown.indexOf("## Phase: hover"));
    expect(markdown).toContain("### Worst frames");
  });
});
