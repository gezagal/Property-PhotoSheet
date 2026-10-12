import { normalizeCustomLabels } from './labels';

export interface StoredPhoto {
  id: string;
  dataUrl: string;
  caption: string;
}

export interface SessionData {
  version: 2;
  address: string;
  hrsz: string;
  photos: StoredPhoto[];
  customLabels: string[];
  updatedAt: number;
}

const DB = 'property-photosheet';
const STORE = 'sessions';
const SESSION_KEY = 'current';
const LABELS_KEY = 'property-photosheet.custom-labels';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('A helyi adatbázis nem nyitható meg.'));
  });
}

export async function saveLocal(data: SessionData): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(data, SESSION_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('A helyi mentés nem sikerült.'));
  });
  db.close();
}

export async function loadLocal(): Promise<unknown | null> {
  const db = await openDb();
  const value = await new Promise<unknown>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(SESSION_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('A helyi mentés nem olvasható.'));
  });
  db.close();
  return value ?? null;
}

export function loadCustomLabels(): string[] {
  const raw = localStorage.getItem(LABELS_KEY);
  if (!raw) return [];

  try {
    return normalizeCustomLabels(JSON.parse(raw));
  } catch {
    throw new Error('A helyi feliratlista sérült.');
  }
}

export function saveCustomLabels(labels: string[]): void {
  localStorage.setItem(LABELS_KEY, JSON.stringify(normalizeCustomLabels(labels)));
}
