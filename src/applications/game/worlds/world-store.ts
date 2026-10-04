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

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(DATABASE_NAME, 1);
    openRequest.onupgradeneeded = () => {
      openRequest.result.createObjectStore(OBJECT_STORE_NAME, {
        keyPath: "id",
      });
    };
    openRequest.onsuccess = () => resolve(openRequest.result);
    openRequest.onerror = () => reject(openRequest.error);
  });
}

async function runTransaction<Result>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<Result>,
  operationName: string,
): Promise<Result> {
  const startedAtMs = profiler.now();
  const database = await openDatabase();
  profiler.recordTimer(
    `main.worldStore.${operationName}.open`,
    profiler.now() - startedAtMs,
    "latency",
  );
  const transactionStartedAtMs = profiler.now();
  return new Promise<Result>((resolve, reject) => {
    const requestToken = profiler.enabled
      ? profiler.begin(
          "main.worldStore.issueRequest",
          DIMENSIONS.simulationSystem,
          `worldStore.${operationName}`,
        )
      : 0;
    const transaction = database.transaction(OBJECT_STORE_NAME, mode);
    const request = operation(transaction.objectStore(OBJECT_STORE_NAME));
    profiler.end(requestToken);
    transaction.oncomplete = () => {
      database.close();
      profiler.recordTimer(
        `main.worldStore.${operationName}.transaction`,
        profiler.now() - transactionStartedAtMs,
        "latency",
      );
      profiler.recordTimer(
        `main.worldStore.${operationName}`,
        profiler.now() - startedAtMs,
        "latency",
      );
      resolve(request.result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });
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
    profiler.recordBytes("bytes.worldStore.put", estimateTransferBytes(world));
    profiler.addCounter("game.worldStore.modifiedChunksSaved", world.modifiedChunks.length);
  }
  return runTransaction("readwrite", (store) => store.put(world), "put");
}

export function deleteWorldRecord(worldId: string): Promise<undefined> {
  profiler.addCounter("game.worldStore.deletes");
  return runTransaction("readwrite", (store) => store.delete(worldId), "delete");
}

async function importLegacySaveIfPresent(): Promise<void> {
  let legacySaveText: string | null = null;
  try {
    legacySaveText = localStorage.getItem(LEGACY_SAVE_STORAGE_KEY);
  } catch {
    return;
  }
  if (!legacySaveText) return;

  try {
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
  await importLegacySaveIfPresent();
  const worlds = await runTransaction<StoredWorld[]>(
    "readonly",
    (store) => store.getAll(),
    "getAll",
  );
  if (profiler.enabled) {
    profiler.recordBytes("bytes.worldStore.getAll", estimateTransferBytes(worlds));
  }
  profiler.addCounter("game.worldStore.worldsListed", worlds.length);
  return profiler.measure("main.worldStore.sortWorlds", () =>
    worlds.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt),
  );
}
