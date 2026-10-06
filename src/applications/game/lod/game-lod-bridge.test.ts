import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as THREE from "three";
import type { ChunkRecord } from "../world/chunk-record";
import { GameLodBridge, type LodChunkSource } from "./game-lod-bridge";
import type { LodManager, LodManagerOptions } from "./manager/lod-manager";
import { counterTotal, gaugeLast, startLodProfiling, stopLodProfiling, timerCalls } from "./testing/profiler-readout.test-helper";

interface RecordedManager {
  options: LodManagerOptions;
  calls: string[];
  disposed: boolean;
  renderDistanceChunks: number;
}

function createRecordingFactory() {
  const managers: RecordedManager[] = [];
  const createManager = (options: LodManagerOptions): LodManager => {
    const recorded: RecordedManager = { options, calls: [], disposed: false, renderDistanceChunks: options.renderDistanceChunks ?? 0 };
    managers.push(recorded);
    const record = (call: string) => () => void recorded.calls.push(call);
    return {
      scene: new THREE.Scene(),
      update: record("update"),
      render: record("render"),
      adoptBackground: record("adoptBackground"),
      setBeforeDepthClear: record("setBeforeDepthClear"),
      setFogColor: record("setFogColor"),
      captureBackgroundHaze: record("captureBackgroundHaze"),
      setRenderDistanceChunks: (chunks: number) => {
        recorded.renderDistanceChunks = chunks;
      },
      get renderDistanceChunks() {
        return recorded.renderDistanceChunks;
      },
      isCameraUnderground: false,
      onRealChunkLoaded: (chunkX: number, chunkY: number, chunkZ: number) => void recorded.calls.push(`loaded ${chunkX},${chunkY},${chunkZ}`),
      onRealChunkMeshed: (chunkX: number, chunkY: number, chunkZ: number) => void recorded.calls.push(`meshed ${chunkX},${chunkY},${chunkZ}`),
      onRealChunkUnmeshed: (chunkX: number, chunkY: number, chunkZ: number) => void recorded.calls.push(`unmeshed ${chunkX},${chunkY},${chunkZ}`),
      onRealChunkUnloaded: record("unloaded"),
      onBlocksEdited: (chunkX: number, chunkY: number, chunkZ: number) => void recorded.calls.push(`edited ${chunkX},${chunkY},${chunkZ}`),
      getStats: () => ({}) as ReturnType<LodManager["getStats"]>,
      dispose: () => {
        recorded.disposed = true;
      },
    } as LodManager;
  };
  return { managers, createManager };
}

function createFakeWorker(): Worker {
  return { postMessage() {}, terminate() {}, onmessage: null, onerror: null } as unknown as Worker;
}

function fakeRecord(chunkX: number, chunkY: number, chunkZ: number, isMeshed: boolean): ChunkRecord {
  return { chunkX, chunkY, chunkZ, blocks: new Uint8Array(32768), appliedMeshVersion: isMeshed ? 1 : -1 } as unknown as ChunkRecord;
}

function fakeChunkSource(records: ChunkRecord[]): LodChunkSource {
  return {
    forEachChunk: (visit) => records.forEach(visit),
    store: { get: (chunkX, chunkY, chunkZ) => records.find((record) => record.chunkX === chunkX && record.chunkY === chunkY && record.chunkZ === chunkZ) },
  };
}

describe("game LOD bridge", () => {
  test("turning the far terrain off disposes it, and turning it back on replays every loaded and meshed chunk", () => {
    const startedAt = performance.now();
    const { managers, createManager } = createRecordingFactory();
    const bridge = new GameLodBridge({ createWorker: createFakeWorker, workerCount: 2, background: new THREE.Object3D(), createManager });
    bridge.startWorld(42, 128);
    expect(managers).toHaveLength(1);
    expect(managers[0]!.options.seed).toBe(42);

    bridge.setRenderDistance(0, null);
    expect(managers[0]!.disposed).toBe(true);
    expect(bridge.isActive).toBe(false);

    const chunks = fakeChunkSource([fakeRecord(1, 2, 3, true), fakeRecord(4, 2, 3, false), fakeRecord(-5, 1, 7, true)]);
    bridge.setRenderDistance(256, chunks);
    expect(managers).toHaveLength(2);
    expect(managers[1]!.options.renderDistanceChunks).toBe(256);
    expect(managers[1]!.calls.filter((call) => call.startsWith("loaded"))).toEqual(["loaded 1,2,3", "loaded 4,2,3", "loaded -5,1,7"]);
    expect(managers[1]!.calls.filter((call) => call.startsWith("meshed"))).toEqual(["meshed 1,2,3", "meshed -5,1,7"]);

    bridge.setRenderDistance(64, chunks);
    expect(managers).toHaveLength(2);
    expect(managers[1]!.renderDistanceChunks).toBe(64);
    bridge.dispose();
    console.log(`bridge toggle test: ${(performance.now() - startedAt).toFixed(1)} ms`);
  });

  test("an edit re-summarizes each chunk whose blocks changed once, on a later frame, not chunks that only changed light", () => {
    const { managers, createManager } = createRecordingFactory();
    const bridge = new GameLodBridge({ createWorker: createFakeWorker, workerCount: 1, background: new THREE.Object3D(), createManager });
    bridge.startWorld(7, 128);
    const chunks = fakeChunkSource([fakeRecord(0, 3, 0, true), fakeRecord(-1, 3, 0, true), fakeRecord(0, 4, 0, true)]);
    const changes = { count: 3, x: Int32Array.from([5, 6, -1]), y: Int32Array.from([100, 100, 101]), z: Int32Array.from([5, 5, 31]) };
    bridge.onBlocksEdited({ changes, changedChunks: [{ x: 0, y: 4, z: 0 }] } as never, chunks);
    expect(managers[0]!.calls.filter((call) => call.startsWith("edited"))).toEqual([]);
    bridge.flushEditedChunks(1000);
    expect(managers[0]!.calls.filter((call) => call.startsWith("edited")).sort()).toEqual(["edited -1,3,0", "edited 0,3,0"]);
    bridge.dispose();
  });
});

describe("game LOD bridge profiling", () => {
  beforeEach(startLodProfiling);
  afterEach(stopLodProfiling);

  test("counts edit changes, chunks queued once per run, chunks flushed and replayed chunks", () => {
    const { createManager } = createRecordingFactory();
    const bridge = new GameLodBridge({ createWorker: createFakeWorker, workerCount: 1, background: new THREE.Object3D(), createManager });
    bridge.startWorld(7, 128);
    const chunks = fakeChunkSource([fakeRecord(0, 3, 0, true), fakeRecord(-1, 3, 0, true), fakeRecord(0, 4, 0, false)]);
    const changes = { count: 3, x: Int32Array.from([5, 6, -1]), y: Int32Array.from([100, 100, 101]), z: Int32Array.from([5, 5, 31]) };
    bridge.onBlocksEdited({ changes, changedChunks: [] } as never, chunks);
    bridge.onBlocksEdited({ changes: { count: 1, x: Int32Array.from([7]), y: Int32Array.from([100]), z: Int32Array.from([9]) }, changedChunks: [] } as never, chunks);

    expect(counterTotal("game.lod.edit.batches")).toBe(2);
    expect(counterTotal("game.lod.edit.changesScanned")).toBe(4);
    expect(counterTotal("game.lod.edit.changesInSameChunkRun")).toBe(1);
    expect(counterTotal("game.lod.edit.chunksAlreadyQueued")).toBe(1);
    expect(gaugeLast("queue.lod.pendingEditedChunks")).toBe(2);

    bridge.flushEditedChunks(1000);
    expect(counterTotal("game.lod.edit.chunksFlushed")).toBe(2);
    expect(gaugeLast("queue.lod.pendingEditedChunks")).toBe(0);

    bridge.setRenderDistance(0, null);
    bridge.setRenderDistance(128, chunks);
    expect(counterTotal("game.lod.bridge.replayedChunks")).toBe(3);
    expect(counterTotal("game.lod.bridge.replayedMeshedChunks")).toBe(2);
    expect(timerCalls("main.lod.bridge.replayChunks")).toBe(1);
    bridge.dispose();
  });
});
