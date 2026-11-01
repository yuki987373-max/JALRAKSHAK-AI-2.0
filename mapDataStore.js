const DB_NAME = 'jalrakshak-map-database';
const DB_VERSION = 1;
const SNAPSHOT_STORE = 'mapSnapshots';
const OFFLINE_STORE = 'offlineLayers';
const SNAPSHOT_LOCAL_PREFIX = 'jalrakshak:mapdb:snapshot:';
const OFFLINE_LOCAL_PREFIX = 'jalrakshak:mapdb:offline:';

function browserStorage(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Map database request failed.'));
  });
}

async function openDatabase() {
  if (!globalThis.indexedDB) return null;
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(OFFLINE_STORE)) db.createObjectStore(OFFLINE_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the local map database.'));
    request.onblocked = () => reject(new Error('The local map database is blocked by another open JalRakshak tab.'));
  });
}

async function idbPut(storeName, value) {
  const db = await openDatabase();
  if (!db) return false;
  try {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Map database write was aborted.'));
    });
    return true;
  } finally { db.close(); }
}

async function idbGetAll(storeName) {
  const db = await openDatabase();
  if (!db) return null;
  try {
    const transaction = db.transaction(storeName, 'readonly');
    return await requestResult(transaction.objectStore(storeName).getAll());
  } finally { db.close(); }
}

async function idbDelete(storeName, key) {
  const db = await openDatabase();
  if (!db) return false;
  try {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(key);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Map database delete was aborted.'));
    });
    return true;
  } finally { db.close(); }
}

function readLocalRecords(storage, prefix) {
  const records = [];
  if (!storage) return records;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const value = JSON.parse(storage.getItem(key) || 'null');
      if (value) records.push(value);
    }
  } catch { /* Ignore malformed or unavailable local records. */ }
  return records;
}

export async function savePersistentMapSnapshot(key, result, savedAt = Date.now(), options = {}) {
  const record = { key, result, savedAt };
  if (options.storage !== undefined) {
    options.storage?.setItem?.(`${SNAPSHOT_LOCAL_PREFIX}${key}`, JSON.stringify(record));
    return Boolean(options.storage);
  }
  try {
    if (await idbPut(SNAPSHOT_STORE, record)) return true;
  } catch { /* localStorage fallback below */ }
  const storage = browserStorage();
  try { storage?.setItem(`${SNAPSHOT_LOCAL_PREFIX}${key}`, JSON.stringify(record)); return Boolean(storage); } catch { return false; }
}

export async function loadPersistentMapSnapshots(options = {}) {
  const storage = browserStorage(options.storage);
  const localSnapshots = readLocalRecords(storage, SNAPSHOT_LOCAL_PREFIX);
  if (options.storage !== undefined) return localSnapshots;
  try {
    const indexedRecords = await idbGetAll(SNAPSHOT_STORE);
    if (indexedRecords) {
      const merged = new Map([...localSnapshots, ...indexedRecords].map(record => [record.key, record]));
      // Migrate map snapshots created by earlier releases that used only localStorage.
      if (storage) {
        try {
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (!key?.startsWith('jalrakshak:osm-cache:v1:')) continue;
            const old = JSON.parse(storage.getItem(key) || 'null');
            if (old?.result && Number.isFinite(old.savedAt)) merged.set(key, { key, result: old.result, savedAt: old.savedAt });
          }
        } catch { /* Keep the snapshots already loaded. */ }
      }
      return [...merged.values()];
    }
  } catch { /* localStorage fallback below */ }
  return localSnapshots;
}

export async function saveOfflineMapLayer(layer, options = {}) {
  if (!layer?.id || !Array.isArray(layer.features)) throw new Error('Offline map layer is missing an ID or feature list.');
  if (options.storage !== undefined) {
    options.storage?.setItem?.(`${OFFLINE_LOCAL_PREFIX}${layer.id}`, JSON.stringify(layer));
    return Boolean(options.storage);
  }
  try {
    if (await idbPut(OFFLINE_STORE, layer)) return true;
  } catch { /* localStorage fallback below */ }
  const storage = browserStorage();
  try { storage?.setItem(`${OFFLINE_LOCAL_PREFIX}${layer.id}`, JSON.stringify(layer)); return Boolean(storage); } catch { return false; }
}

export async function loadOfflineMapLayers(options = {}) {
  const storage = browserStorage(options.storage);
  const localLayers = readLocalRecords(storage, OFFLINE_LOCAL_PREFIX);
  if (options.storage !== undefined) return localLayers;
  try {
    const indexedRecords = await idbGetAll(OFFLINE_STORE);
    if (indexedRecords) {
      const merged = new Map([...localLayers, ...indexedRecords].map(layer => [layer.id, layer]));
      return [...merged.values()];
    }
  } catch { /* localStorage fallback below */ }
  return localLayers;
}

export async function removeOfflineMapLayer(id, options = {}) {
  if (options.storage !== undefined) {
    try { options.storage?.removeItem?.(`${OFFLINE_LOCAL_PREFIX}${id}`); return true; } catch { return false; }
  }
  let removed = false;
  try { removed = await idbDelete(OFFLINE_STORE, id); } catch { /* local fallback below */ }
  try { browserStorage()?.removeItem(`${OFFLINE_LOCAL_PREFIX}${id}`); removed = true; } catch { /* storage may be disabled */ }
  return removed;
}

export async function exportMapDatabase(options = {}) {
  const [snapshots, offlineLayers] = await Promise.all([
    loadPersistentMapSnapshots(options),
    loadOfflineMapLayers(options),
  ]);
  return {
    format: 'jalrakshak-map-database',
    version: 1,
    exportedAt: new Date().toISOString(),
    snapshots,
    offlineLayers,
  };
}

export const MAP_DATABASE_INFO = Object.freeze({ name: DB_NAME, version: DB_VERSION, snapshotStore: SNAPSHOT_STORE, offlineStore: OFFLINE_STORE });
