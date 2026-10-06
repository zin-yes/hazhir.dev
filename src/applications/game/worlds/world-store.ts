import { estimateTransferBytes, profiler } from "../profiler";
import { v4 } from "uuid";
import { DIMENSIONS } from "../profiler/dimensions";

const DATABASE_NAME = "hazhir-dev-voxel-worlds";
const OBJECT_STORE_NAME = "worlds";
const LEGACY_SAVE_STORAGE_KEY = "hazhir-dev-save";

export interface Vector3Snapshot {
  x: number;
  y: number;
  z: number;
}

export type SerializedModifiedChunks = [string, [number, number][]][];

export interface StoredWorld {
  id: string;
  name: string;
  seed: number;
  createdAt: number;
  lastPlayedAt: number;
  modifiedChunks: SerializedModifiedChunks;
  position: Vector3Snapshot | null;
  rotation: Vector3Snapshot | null;
  hotbarSlots: number[] | null;
}

type WorldStoreOperation = "put" | "delete" | "getAll";

function operationMetricNames(operationName: WorldStoreOperation) {
  return {
    transactions: `game.worldStore.transactions.${operationName}`,
    failures: `game.worldStore.transactionFailures.${operationName}`,
    open: `main.worldStore.${operationName}.open`,
    transaction: `main.worldStore.${operationName}.transaction`,
    total: `main.worldStore.${operationName}`,
    requestToSuccess: `latency.worldStore.${operationName}.requestToSuccess`,
    successToCommit: `latency.worldStore.${operationName}.successToCommit`,
    issueRequest: `worldStore.${operationName}`,
  };
}

const OPERATION_METRIC_NAMES: {
  [operation in WorldStoreOperation]: ReturnType<typeof operationMetricNames>;
} = {
  put: operationMetricNames("put"),
  delete: operationMetricNames("delete"),
  getAll: operationMetricNames("getAll"),
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    profiler.addCounter("game.worldStore.databaseOpens");
    const openRequest = indexedDB.open(DATABASE_NAME, 1);
    openRequest.onupgradeneeded = () => {
      profiler.addCounter("game.worldStore.databaseUpgrades");
      openRequest.result.createObjectStore(OBJECT_STORE_NAME, {
        keyPath: "id",
      });
    };
    openRequest.onsuccess = () => resolve(openRequest.result);
    openRequest.onerror = () => {
      profiler.addCounter("game.worldStore.databaseOpenFailures");
      reject(openRequest.error);
    };
  });
}

async function runTransaction<Result>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<Result>,
  operationName: WorldStoreOperation,
): Promise<Result> {
  const metricNames = OPERATION_METRIC_NAMES[operationName];
  profiler.addCounter(metricNames.transactions);
  const startedAtMs = profiler.now();
  const database = await openDatabase();
  profiler.recordTimer(metricNames.open, profiler.now() - startedAtMs, "latency");
  const transactionStartedAtMs = profiler.now();
  return new Promise<Result>((resolve, reject) => {
    const requestToken = profiler.enabled
      ? profiler.begin(
          "main.worldStore.issueRequest",
          DIMENSIONS.simulationSystem,
          metricNames.issueRequest,
        )
      : 0;
    const transaction = database.transaction(OBJECT_STORE_NAME, mode);
    const request = operation(transaction.objectStore(OBJECT_STORE_NAME));
    profiler.end(requestToken);
    let requestSucceededAtMs = 0;
    request.addEventListener("success", () => {
      requestSucceededAtMs = profiler.now();
      profiler.recordTimer(
        metricNames.requestToSuccess,
        requestSucceededAtMs - transactionStartedAtMs,
        "latency",
      );
    });
    transaction.oncomplete = () => {
      database.close();
      const completedAtMs = profiler.now();
      profiler.recordTimer(
        metricNames.transaction,
        completedAtMs - transactionStartedAtMs,
        "latency",
      );
      profiler.recordTimer(metricNames.total, completedAtMs - startedAtMs, "latency");
      if (requestSucceededAtMs > 0) {
        profiler.recordTimer(
          metricNames.successToCommit,
          completedAtMs - requestSucceededAtMs,
          "latency",
        );
      }
      profiler.recordBreakdown(DIMENSIONS.worldStoreOperation, operationName, {
        calls: 1,
        totalMs: completedAtMs - startedAtMs,
      });
      resolve(request.result);
    };
    transaction.onerror = () => {
      profiler.addCounter(metricNames.failures);
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      profiler.addCounter(metricNames.failures);
      database.close();
      reject(transaction.error);
    };
  });
}

function countEditedBlocks(modifiedChunks: SerializedModifiedChunks): number {
  let editedBlocks = 0;
  for (const [, edits] of modifiedChunks) editedBlocks += edits.length;
  return editedBlocks;
}

type PayloadDirection = "put" | "getAll";

function payloadMetricNames(direction: PayloadDirection) {
  return {
    bytes: `bytes.worldStore.${direction}`,
    bytesPerModifiedChunk: `bytes.worldStore.${direction}.perModifiedChunk`,
    worlds: `game.worldStore.${direction}.worlds`,
    modifiedChunks: `game.worldStore.${direction}.modifiedChunks`,
    editedBlocks: `game.worldStore.${direction}.editedBlocks`,
    modifiedChunksPerCall: `game.worldStore.${direction}.modifiedChunksPerCall`,
  };
}

const PAYLOAD_METRIC_NAMES = {
  put: payloadMetricNames("put"),
  getAll: payloadMetricNames("getAll"),
};

/** Sizes one world payload crossing the IndexedDB boundary (structured clone happens inside the engine, so bytes are an estimate). */
function recordWorldPayload(direction: PayloadDirection, payload: StoredWorld | StoredWorld[]) {
  const metricNames = PAYLOAD_METRIC_NAMES[direction];
  const worlds = Array.isArray(payload) ? payload : [payload];
  const payloadBytes = profiler.measure("main.worldStore.estimateBytes", () =>
    estimateTransferBytes(payload),
  );
  profiler.recordBytes(metricNames.bytes, payloadBytes);
  let modifiedChunkCount = 0;
  let editedBlockCount = 0;
  for (const world of worlds) {
    modifiedChunkCount += world.modifiedChunks.length;
    editedBlockCount += countEditedBlocks(world.modifiedChunks);
  }
  profiler.addCounter(metricNames.worlds, worlds.length);
  profiler.addCounter(metricNames.modifiedChunks, modifiedChunkCount);
  profiler.addCounter(metricNames.editedBlocks, editedBlockCount);
  profiler.sampleGauge(metricNames.modifiedChunksPerCall, modifiedChunkCount);
  if (modifiedChunkCount > 0) {
    profiler.recordBytes(metricNames.bytesPerModifiedChunk, payloadBytes / modifiedChunkCount);
  }
}

export function generateRandomSeed(): number {
  return Math.floor(Math.random() * 100000000);
}

export function hashTextToSeed(text: string): number {
  let hash = 0;
  for (const character of text) {
    hash = (hash * 31 + character.charCodeAt(0)) % 1000000000;
  }
  return hash;
}

export function createWorldRecord(name: string, seed: number): StoredWorld {
  const now = Date.now();
  return {
    id: v4(),
    name,
    seed,
    createdAt: now,
    lastPlayedAt: now,
    modifiedChunks: [],
    position: null,
    rotation: null,
    hotbarSlots: null,
  };
}

export function saveWorldRecord(world: StoredWorld): Promise<IDBValidKey> {
  if (profiler.enabled) {
    profiler.addCounter("game.worldStore.puts");
    profiler.addCounter("game.worldStore.modifiedChunksSaved", world.modifiedChunks.length);
    recordWorldPayload("put", world);
  }
  return runTransaction("readwrite", (store) => store.put(world), "put");
}

export function deleteWorldRecord(worldId: string): Promise<undefined> {
  profiler.addCounter("game.worldStore.deletes");
  return runTransaction("readwrite", (store) => store.delete(worldId), "delete");
}

async function importLegacySaveIfPresent(): Promise<void> {
  let legacySaveText: string | null = null;
  const legacyCheckToken = profiler.begin("main.worldStore.legacyCheck");
  try {
    legacySaveText = localStorage.getItem(LEGACY_SAVE_STORAGE_KEY);
  } catch {
    return;
  } finally {
    profiler.end(legacyCheckToken);
  }
  if (!legacySaveText) {
    profiler.addCounter("game.worldStore.legacyChecksEmpty");
    return;
  }

  try {
    profiler.addCounter("game.worldStore.legacyImports");
    profiler.recordBytes("bytes.worldStore.legacyImport", legacySaveText.length);
    const legacySave = profiler.measure("main.worldStore.legacyParse", () =>
      JSON.parse(legacySaveText as string),
    );
    const importedWorld: StoredWorld = {
      ...createWorldRecord("Old World", legacySave.seed),
      modifiedChunks: legacySave.modifiedChunks ?? [],
      position: legacySave.position ?? null,
      rotation: legacySave.rotation ?? null,
      hotbarSlots: legacySave.hotbarSlots ?? null,
    };
    await saveWorldRecord(importedWorld);
    localStorage.removeItem(LEGACY_SAVE_STORAGE_KEY);
  } catch (error) {
    console.error("Failed to import legacy save:", error);
  }
}

export async function listWorldRecords(): Promise<StoredWorld[]> {
  const listStartedAtMs = profiler.now();
  await importLegacySaveIfPresent();
  const worlds = await runTransaction<StoredWorld[]>(
    "readonly",
    (store) => store.getAll(),
    "getAll",
  );
  if (profiler.enabled) recordWorldPayload("getAll", worlds);
  profiler.addCounter("game.worldStore.worldsListed", worlds.length);
  const sortedWorlds = profiler.measure("main.worldStore.sortWorlds", () =>
    worlds.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt),
  );
  profiler.recordTimer("main.worldStore.list", profiler.now() - listStartedAtMs, "latency");
  return sortedWorlds;
}
