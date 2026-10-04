// Fake worker backends for chunk pipeline tests. Generation builds a small deterministic terrain, lighting runs the
// real region lighting (so light values are real), meshing records what it was asked. Every call waits until the
// test releases it, so tests decide the order in which workers finish.

import { BlockType } from "../blocks";
import { CELLS_PER_CHUNK } from "../edits/chunk-cluster";
import type { ChunkMeshResult } from "../workers/mesh-types";
import { lightRegionFromSlabs } from "../workers/region-surroundings";
import type { RegionLightResult } from "../workers/region-lighting";
import { packChunkKey, packColumnKey } from "./chunk-key";
import type {
  ChunkMeshRequest,
  ColumnGenerationRequest,
  GeneratedColumn,
  GenerationBackend,
  LightingBackend,
  MeshBackend,
  RegionLightingRequest,
} from "./pipeline-backends";
import { uniformByteValue } from "./uniform-bytes";

/** Flat ground: stone below this world y, air from it up, so chunk y 1 is the only mixed layer. */
export const GROUND_LEVEL = 48;

export const cellIndexOf = (x: number, y: number, z: number) => ((x & 31) << 10) | ((y & 31) << 5) | (z & 31);

export interface PendingCall<Request, Result> {
  request: Request;
  release(): void;
  fail(error: unknown): void;
  result: () => Result;
}

class ControlledCalls<Request, Result> {
  readonly pending: PendingCall<Request, Result>[] = [];
  readonly history: Request[] = [];

  constructor(private readonly compute: (request: Request) => Result) {}

  start(request: Request): Promise<Result> {
    this.history.push(request);
    return new Promise<Result>((resolve, reject) => {
      const call: PendingCall<Request, Result> = {
        request,
        result: () => this.compute(request),
        release: () => {
          this.pending.splice(this.pending.indexOf(call), 1);
          resolve(this.compute(request));
        },
        fail: (error) => {
          this.pending.splice(this.pending.indexOf(call), 1);
          reject(error);
        },
      };
      this.pending.push(call);
    });
  }

  releaseAll(): number {
    const calls = this.pending.slice();
    for (const call of calls) call.release();
    return calls.length;
  }
}

export type BlockOverride = (worldX: number, worldY: number, worldZ: number) => number | undefined;

export class FakeGeneration implements GenerationBackend {
  readonly calls: ControlledCalls<ColumnGenerationRequest, GeneratedColumn>;
  blockOverride: BlockOverride = () => undefined;

  constructor(readonly workerCount: number) {
    this.calls = new ControlledCalls((request) => this.generate(request));
  }

  generateColumn(request: ColumnGenerationRequest): Promise<GeneratedColumn> {
    return this.calls.start(request);
  }

  terrainBlocks(chunkX: number, chunkY: number, chunkZ: number): Uint8Array {
    const blocks = new Uint8Array(CELLS_PER_CHUNK);
    for (let x = 0; x < 32; x++) {
      for (let y = 0; y < 32; y++) {
        for (let z = 0; z < 32; z++) {
          const worldX = chunkX * 32 + x;
          const worldY = chunkY * 32 + y;
          const worldZ = chunkZ * 32 + z;
          const override = this.blockOverride(worldX, worldY, worldZ);
          blocks[cellIndexOf(x, y, z)] = override ?? (worldY < GROUND_LEVEL ? BlockType.STONE : BlockType.AIR);
        }
      }
    }
    return blocks;
  }

  private generate({ chunkX, chunkZ, chunkYs }: ColumnGenerationRequest): GeneratedColumn {
    const chunks = chunkYs.map((chunkY) => {
      const blocks = this.terrainBlocks(chunkX, chunkY, chunkZ);
      const uniformBlock = uniformByteValue(blocks);
      return { chunkY, blocks: uniformBlock >= 0 ? null : (blocks.buffer as ArrayBuffer), uniformBlock };
    });
    return { chunks, surfaceChunkY: Math.floor((GROUND_LEVEL - 1) / 32) };
  }
}

export class FakeLighting implements LightingBackend {
  readonly calls: ControlledCalls<RegionLightingRequest, RegionLightResult>;
  readonly inFlightColumnsAtEachStart: number[][] = [];

  constructor(readonly workerCount: number) {
    this.calls = new ControlledCalls((request) => lightRegionFromSlabs(request.regionChunks, request.slabs));
  }

  lightRegion(request: RegionLightingRequest): Promise<RegionLightResult> {
    const promise = this.calls.start(request);
    this.inFlightColumnsAtEachStart.push(
      this.calls.pending.map(({ request: pending }) =>
        packColumnKey(pending.regionChunks[0]!.chunkX, pending.regionChunks[0]!.chunkZ),
      ),
    );
    return promise;
  }
}

export const EMPTY_MESH: ChunkMeshResult = { opaque: new ArrayBuffer(0), transparent: new ArrayBuffer(0), plants: [] };

export class FakeMeshing implements MeshBackend {
  readonly calls = new ControlledCalls<ChunkMeshRequest, ChunkMeshResult>(() => EMPTY_MESH);

  constructor(readonly workerCount: number) {}

  buildMesh(request: ChunkMeshRequest): Promise<ChunkMeshResult> {
    return this.calls.start(request);
  }

  buildsOf(chunkX: number, chunkY: number, chunkZ: number): ChunkMeshRequest[] {
    return this.calls.history.filter(
      (request) => request.chunkX === chunkX && request.chunkY === chunkY && request.chunkZ === chunkZ,
    );
  }

  buildCountByKey(): Map<number, number> {
    const counts = new Map<number, number>();
    for (const request of this.calls.history) {
      const key = packChunkKey(request.chunkX, request.chunkY, request.chunkZ);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }
}

export const flushPromises = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Releases every worker call, again and again, until nothing is pending. */
export async function settle(
  generation: FakeGeneration,
  lighting: FakeLighting,
  meshing: FakeMeshing,
  maximumRounds = 10_000,
): Promise<void> {
  for (let round = 0; round < maximumRounds; round++) {
    await flushPromises();
    const released = generation.calls.releaseAll() + lighting.calls.releaseAll() + meshing.calls.releaseAll();
    if (released === 0) {
      await flushPromises();
      if (generation.calls.pending.length + lighting.calls.pending.length + meshing.calls.pending.length === 0) return;
    }
  }
  throw new Error("the pipeline never settled");
}
