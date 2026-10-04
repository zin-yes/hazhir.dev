import { describe, expect, test } from "bun:test";
import { DEFAULT_RENDER_SETTINGS, normalizeRenderSettings } from "./render-settings";

describe("render settings", () => {
  test("far terrain distance stays off at 0 and is clamped into 32..512 chunks otherwise", () => {
    const startedAt = performance.now();
    expect(normalizeRenderSettings({ lodRenderDistanceChunks: 0 }).lodRenderDistanceChunks).toBe(0);
    expect(normalizeRenderSettings({ lodRenderDistanceChunks: 5 }).lodRenderDistanceChunks).toBe(32);
    expect(normalizeRenderSettings({ lodRenderDistanceChunks: 300.7 }).lodRenderDistanceChunks).toBe(300);
    expect(normalizeRenderSettings({ lodRenderDistanceChunks: 9000 }).lodRenderDistanceChunks).toBe(512);
    expect(normalizeRenderSettings({ lodRenderDistanceChunks: Number.NaN }).lodRenderDistanceChunks).toBe(
      DEFAULT_RENDER_SETTINGS.lodRenderDistanceChunks,
    );
    console.log(`render settings test: ${(performance.now() - startedAt).toFixed(2)} ms`);
  });

});
