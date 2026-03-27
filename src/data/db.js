/**
 * Simple IndexedDB wrapper for large site datasets
 */
import { currentUserId } from '../auth/auth-gate.js';

const DB_NAME = 'TowerIntelDB_v4';
const DB_VERSION = 4;

function getUserScopedDbName() {
    const uid = currentUserId();
    // In auth-enabled flows, uid is available after initAuthGate() grants app access.
    // Fallback keeps legacy behavior for local dev / pre-auth calls.
    return uid ? `${DB_NAME}__user_${uid}` : DB_NAME;
}

function openDbByName(name) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, DB_VERSION);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            const stores = ['towers', 'mnoSites', 'datasets', 'layers'];
            stores.forEach(s => {
                if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
            });
        };

        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

export function openDB() {
    return openDbByName(getUserScopedDbName());
}

/**
 * Save data associated with a specific key (e.g. filename)
 */
export async function saveToDB(storeName, data, key = 'current_dataset') {
    console.log(`[DB] Saving to ${storeName} key=${key}...`);
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        store.put(data, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Load data for a specific key
 */
export async function loadFromDB(storeName, key = 'current_dataset') {
    const db = await openDB();
    const userVal = await new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = (e) => resolve(e.target.result || null);
        request.onerror = (e) => reject(e.target.error);
    });
    if (userVal != null) return userVal;

    const scoped = getUserScopedDbName();
    if (scoped === DB_NAME) return null;
    try {
        const legacy = await openDbByName(DB_NAME);
        return await new Promise((resolve, reject) => {
            const transaction = legacy.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = (e) => resolve(e.target.result || null);
            request.onerror = (e) => reject(e.target.error);
        });
    } catch {
        return null;
    }
}

/**
 * List all keys in a store (to find available databases/folders)
 */
export async function listDBKeys(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAllKeys();
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

export async function deleteFromDB(storeName, key) {
    const deleteInDb = async (dbName) => {
        const db = await openDbByName(dbName);
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            store.delete(key);
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e) => reject(e.target.error);
        });
    };
    const scoped = getUserScopedDbName();
    await deleteInDb(scoped);
    if (scoped !== DB_NAME) {
        try { await deleteInDb(DB_NAME); } catch { /* ignore */ }
    }
}

export async function clearDB() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const stores = ['towers', 'mnoSites', 'datasets', 'layers'];
        const transaction = db.transaction(stores, 'readwrite');
        stores.forEach(s => transaction.objectStore(s).clear());
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
    });
}
