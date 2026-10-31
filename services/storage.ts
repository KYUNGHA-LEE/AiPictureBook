import { Project, Settings } from '../types';

// 이미지가 커서 localStorage(약 5MB)로는 부족해요. 작업물은 IndexedDB에 자동 저장합니다.
const DB = 'ai-tale-maker';
const STORE = 'kv';
const PROJECT_KEY = 'project';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProject(p: Project): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(p, PROJECT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('자동 저장 실패', e);
  }
}

export async function loadProject(): Promise<Project | null> {
  try {
    const db = await open();
    const result = await new Promise<Project | null>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(PROJECT_KEY);
      req.onsuccess = () => resolve((req.result as Project) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function clearProject(): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(PROJECT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* 무시 */ }
}

const SETTINGS_KEY = 'tale_settings';
export const DEFAULT_SETTINGS: Settings = {
  imageQuality: 'standard',
  imageSize: '1K',
  keepStyle: true,
  keepContinuity: true,
  autoEnhance: true,
  autoAssets: true,
  voice: 'Kore'
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* 무시 */ }
}
