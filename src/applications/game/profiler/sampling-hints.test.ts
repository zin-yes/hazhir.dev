import { describe, expect, test } from "bun:test";
import { isThirdPartyResource, samplingHints } from "./sampling-hints";
import type { SamplingSummary } from "./types";

const PAGE_ORIGIN = "https://hazhir.dev";
const GAME_CHUNK = "https://hazhir.dev/_next/static/chunks/game.js?v=1";
const THREE_CHUNK = "https://hazhir.dev/_next/static/chunks/node_modules_three_build_three.js";

function buildSummary(
  topSelf: { functionName: string; resource: string; line: number; samples: number }[],
  totalSamples = 1000,
): SamplingSummary {
  return {
    sampleIntervalMs: 2,
    totalSamples,
    durationMs: totalSamples * 2,
    topSelf: topSelf.map((entry) => ({ ...entry, selfMs: entry.samples * 2 })),
    topStacks: [],
  };
}

describe("isThirdPartyResource", () => {
  test("classifies dependency chunks, cross-origin scripts and first-party code", () => {
    expect(isThirdPartyResource(THREE_CHUNK, PAGE_ORIGIN)).toBe(true);
    expect(isThirdPartyResource("https://cdn.example.com/lib.js", PAGE_ORIGIN)).toBe(true);
    expect(isThirdPartyResource(GAME_CHUNK, PAGE_ORIGIN)).toBe(false);
    expect(isThirdPartyResource("", PAGE_ORIGIN)).toBe(false);
  });

  test("an origin that merely shares a prefix is still cross-origin", () => {
    expect(isThirdPartyResource("https://hazhir.dev.evil.com/a.js", PAGE_ORIGIN)).toBe(true);
  });
});

describe("samplingHints", () => {
  test("flags a single function over 15% of samples", () => {
    const hints = samplingHints(
      buildSummary([
        { functionName: "buildGeometry", resource: GAME_CHUNK, line: 120, samples: 220 },
        { functionName: "tick", resource: GAME_CHUNK, line: 5, samples: 140 },
        { functionName: "other", resource: GAME_CHUNK, line: 9, samples: 60 },
      ]),
      undefined,
      PAGE_ORIGIN,
    );
    expect(hints.map((hint) => hint.title)).toEqual(["buildGeometry is a CPU hot spot"]);
    expect(hints[0]!.severity).toBe("medium");
    expect(hints[0]!.evidence).toContain("22%");
    expect(hints[0]!.evidence).toContain("game.js:120");
  });

  test("raises severity when one function holds a third of the samples", () => {
    const hints = samplingHints(
      buildSummary([{ functionName: "buildGeometry", resource: GAME_CHUNK, line: 120, samples: 400 }]),
      undefined,
      PAGE_ORIGIN,
    );
    expect(hints[0]!.severity).toBe("high");
  });

  test("stays quiet when no function is over the threshold or samples are too few", () => {
    const flatSummary = buildSummary(
      Array.from({ length: 10 }, (_, index) => ({
        functionName: `fn${index}`,
        resource: GAME_CHUNK,
        line: index,
        samples: 100,
      })),
    );
    expect(samplingHints(flatSummary, undefined, PAGE_ORIGIN)).toEqual([]);

    const tooFewSamples = buildSummary(
      [{ functionName: "buildGeometry", resource: GAME_CHUNK, line: 1, samples: 20 }],
      20,
    );
    expect(samplingHints(tooFewSamples, undefined, PAGE_ORIGIN)).toEqual([]);
    expect(samplingHints(null, undefined, PAGE_ORIGIN)).toEqual([]);
  });

  test("sums a third-party resource across its functions", () => {
    const hints = samplingHints(
      buildSummary([
        { functionName: "render", resource: THREE_CHUNK, line: 800, samples: 120 },
        { functionName: "projectObject", resource: THREE_CHUNK, line: 300, samples: 130 },
        { functionName: "gameLogic", resource: GAME_CHUNK, line: 10, samples: 100 },
      ]),
      undefined,
      PAGE_ORIGIN,
    );
    expect(hints).toHaveLength(1);
    expect(hints[0]!.title).toContain("node_modules_three_build_three.js");
    expect(hints[0]!.evidence).toContain("25%");
    expect(hints[0]!.evidence).toContain("projectObject");
  });

  test("reports an uninstrumented dominant function once, as unattributed", () => {
    const summary = buildSummary([
      { functionName: "decorateChunk", resource: GAME_CHUNK, line: 40, samples: 300 },
      { functionName: "tick", resource: GAME_CHUNK, line: 5, samples: 50 },
    ]);
    const hints = samplingHints(summary, { tick: 90 }, PAGE_ORIGIN);
    expect(hints).toHaveLength(1);
    expect(hints[0]!.title).toContain("decorateChunk");
    expect(hints[0]!.title).toContain("not instrumented");
    expect(hints[0]!.severity).toBe("high");
  });

  test("a dominant function that instrumentation already accounts for is a plain hot spot", () => {
    const summary = buildSummary([
      { functionName: "decorateChunk", resource: GAME_CHUNK, line: 40, samples: 300 },
    ]);
    const hints = samplingHints(summary, { decorateChunk: 560 }, PAGE_ORIGIN);
    expect(hints.map((hint) => hint.title)).toEqual(["decorateChunk is a CPU hot spot"]);
  });
});
