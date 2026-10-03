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
): Promise<Result> {
  const database = await openDatabase();
  return new Promise<Result>((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE_NAME, mode);
    const request = operation(transaction.objectStore(OBJECT_STORE_NAME));
    transaction.oncomplete = () => {
      database.close();
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
    id: crypto.randomUUID(),
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
  return runTransaction("readwrite", (store) => store.put(world));
}

export function deleteWorldRecord(worldId: string): Promise<undefined> {
  return runTransaction("readwrite", (store) => store.delete(worldId));
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
    const legacySave = JSON.parse(legacySaveText);
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
  const worlds = await runTransaction<StoredWorld[]>("readonly", (store) =>
    store.getAll(),
  );
  return worlds.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
}
