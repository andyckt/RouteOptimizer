import { openDB } from "idb";

const DB_NAME = "kapioo-pending-completions";
const STORE_NAME = "pendingCompletions";
const DB_VERSION = 1;

export interface PendingImage {
  blob: Blob;
  name: string;
  type: string;
}

export interface PendingCompletion {
  id?: number;
  runId: string;
  stopIndex: number;
  token: string;
  images: PendingImage[];
  createdAt: number;
}

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    },
  });
}

export async function addPending(
  runId: string,
  stopIndex: number,
  token: string,
  files: File[]
): Promise<number> {
  const images: PendingImage[] = files.map((f) => ({
    blob: f,
    name: f.name,
    type: f.type,
  }));
  const db = await getDB();
  const id = await db.add(STORE_NAME, {
    runId,
    stopIndex,
    token,
    images,
    createdAt: Date.now(),
  });
  return id as number;
}

export async function getAllForRun(runId: string): Promise<PendingCompletion[]> {
  const db = await getDB();
  const all = await db.getAll(STORE_NAME);
  return all.filter((p) => p.runId === runId);
}

export async function remove(id: number): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

export async function getPendingCountForRun(runId: string): Promise<number> {
  const items = await getAllForRun(runId);
  return items.length;
}
