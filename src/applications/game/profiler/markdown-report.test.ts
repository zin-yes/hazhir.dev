import { describe, expect, test } from "bun:test";
import { renderBenchmarkMarkdown, renderMarkdownReport } from "./markdown-report";
import { busyGameScenario, simulateSnapshot, worldgenScenario, worldgenTask } from "./profile-fixtures";
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

describe("renderMarkdownReport detail sections", () => {
  const markdown = renderMarkdownReport(buildProfileReport(simulateSnapshot(worldgenScenario())));
  const sectionAfter = (heading: string) => {
    const start = markdown.indexOf(heading);
    expect(start).toBeGreaterThan(-1);
    return markdown.slice(start);
  };
  const rowStarting = (section: string, prefix: string) =>
    section.split("\n").find((line) => line.startsWith(prefix));

  test("indents the call tree by nesting with inclusive and self time per node", () => {
    const section = sectionAfter("### worldgen.generateChunk (worker");
    expect(rowStarting(section, "| `features` |")).toContain("| 60 | 1200ms | 240ms | 61% |");
    expect(rowStarting(section, "| `  placeTree` |")).toContain("| 360 | 840ms | 840ms | 42% | 2.33ms |");
  });

  test("marks sampled nodes as estimated", () => {
    const section = sectionAfter("### worldgen.generateChunk (worker");
    expect(rowStarting(section, "| `  density ~` |")).toContain("~240ms");
  });

  test("names the hottest leaf first in the top self-time table", () => {
    const section = sectionAfter("#### worldgen.generateChunk: top self-time paths");
    expect(rowStarting(section, "| 1 |")).toContain("features > placeTree");
  });

  test("flags the worker time that no section covers", () => {
    const section = sectionAfter("### worldgen.generateChunk (worker");
    expect(section).toContain("**Unattributed gap:** 60 tasks ran 2640ms");
    expect(section).toContain("660ms (25%)");
  });

  test("ranks breakdown keys by self time with share, per call and per unit cost", () => {
    const section = sectionAfter("### worldgen.biome (worker");
    expect(rowStarting(section, "| 1 | forest |")).toBe("| 1 | forest | 71% | 1200ms | 60 | 245.8k | 20000.0 | 4.88us |");
    expect(rowStarting(section, "|  | **total** |")).toContain("| 100% | 1680ms |");
  });

  test("ranks dimensions without timing by units", () => {
    const section = sectionAfter("### worldgen.block (worker");
    expect(rowStarting(section, "| 1 |")).toContain("| stone | 80% |");
  });

  test("renders pipe separated keys as a matrix with empty cells where a pair never ran", () => {
    const section = sectionAfter("#### worldgen.biomeStage matrix");
    expect(rowStarting(section, "| forest |")).toBe("| forest | 900.0 | 240.0 | - |");
    expect(rowStarting(section, "| desert |")).toBe("| desert | 180.0 | 120.0 | 60.0 |");
  });

  test("includes the sampling profile when the snapshot has one", () => {
    const section = sectionAfter("## Sampling profile (main thread)");
    expect(rowStarting(section, "| 1 |")).toContain("packVertices");
    expect(section).toContain("tick > updateChunks > packVertices");
  });

  test("omits detail sections for sessions that recorded none", () => {
    const plain = renderMarkdownReport(
      buildProfileReport(simulateSnapshot({ seconds: 2, frameIntervalMs: 20, scopes: [] })),
    );
    expect(plain).not.toContain("## Call trees");
    expect(plain).not.toContain("## Breakdowns");
    expect(plain).not.toContain("## Sampling profile");
  });

  test("limits very wide trees and says what was left out", () => {
    const sections = Array.from({ length: 150 }, (_, index) => ({ name: `step${index}`, selfMs: 1 + (index % 5) }));
    const wide = renderMarkdownReport(
      buildProfileReport(
        simulateSnapshot(worldgenScenario({ seconds: 1, workerTasks: [worldgenTask({ nestedSections: sections, executionMs: 600 })] })),
      ),
    );
    const treeSection = wide.slice(wide.indexOf("### worldgen.generateChunk (worker"), wide.indexOf("worldgen.generateChunk: top self-time paths"));
    const treeRows = treeSection.split("\n").filter((line) => line.startsWith("| `step"));
    expect(treeRows.length).toBe(60);
    expect(treeSection).toContain("90 lighter or deeper nodes not shown");
  });

  test("contains no em or en dashes", () => {
    expect(markdown).not.toMatch(/[\u2013\u2014]/);
  });
});
