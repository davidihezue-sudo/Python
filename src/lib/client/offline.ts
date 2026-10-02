"use client";
// Offline draft queue. Mutations that can be safely replayed (they carry idempotency keys or are naturally idempotent)
// are stored in IndexedDB when the device is offline and synchronised when connectivity returns.
import { ApiError, api, NetworkError } from "./api";

export interface QueuedRequest {
  id: string;
  method: "POST" | "PATCH";
  url: string;
  body: any;
  label: string;
  createdAt: number;
  status: "pending" | "failed";
  error?: string;
}

const DB_NAME = "autovault-offline";
const STORE = "outbox";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const offlineCapabilities = () => ({
  serviceWorker: typeof navigator !== "undefined" && "serviceWorker" in navigator,
  indexedDB: typeof indexedDB !== "undefined",
  backgroundSync: typeof window !== "undefined" && "SyncManager" in window,
  push: typeof window !== "undefined" && "PushManager" in window && "Notification" in window,
  standalone: typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true),
});

export async function listQueue(): Promise<QueuedRequest[]> {
  try {
    return ((await tx("readonly", (s) => s.getAll())) as QueuedRequest[]).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}
export async function enqueue(r: Omit<QueuedRequest, "id" | "createdAt" | "status">) {
  const item: QueuedRequest = { ...r, id: crypto.randomUUID(), createdAt: Date.now(), status: "pending" };
  await tx("readwrite", (s) => s.put(item));
  notify();
  // Ask for a background sync where supported; otherwise we flush on the next 'online' event / app open.
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg && "sync" in reg) await (reg as any).sync.register("autovault-flush");
  } catch {
    /* unsupported */
  }
  return item;
}
export async function removeQueued(id: string) {
  await tx("readwrite", (s) => s.delete(id));
  notify();
}
async function update(item: QueuedRequest) {
  await tx("readwrite", (s) => s.put(item));
}
const notify = () => typeof window !== "undefined" && window.dispatchEvent(new CustomEvent("av:queue-changed"));

let flushing = false;
/** Replays queued requests in order. Stops at the first network failure; permanent (4xx) errors are kept as 'failed' for the user to review. */
export async function flushQueue(): Promise<{ synced: number; failed: number }> {
  if (flushing || typeof navigator === "undefined" || !navigator.onLine) return { synced: 0, failed: 0 };
  flushing = true;
  let synced = 0;
  let failed = 0;
  try {
    for (const item of await listQueue()) {
      if (item.status === "failed") continue;
      try {
        await api(item.url, { method: item.method, body: item.body });
        await removeQueued(item.id);
        synced++;
      } catch (e) {
        if (e instanceof NetworkError) break;
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429 && e.status !== 401) {
          // Duplicate / idempotent replays count as success
          if (e.code === "DUPLICATE_RECORD" || e.code === "CONFLICT") {
            await removeQueued(item.id);
            synced++;
            continue;
          }
          await update({ ...item, status: "failed", error: e.message });
          failed++;
          notify();
        } else break;
      }
    }
  } finally {
    flushing = false;
  }
  if (synced) window.dispatchEvent(new CustomEvent("av:synced", { detail: { synced } }));
  return { synced, failed };
}

/** Submits a mutation; when offline (and `queueable`) stores it as a draft and resolves with { queued: true }. */
export async function submitOrQueue<T = any>(url: string, method: "POST" | "PATCH", body: any, opts: { label: string; queueable: boolean }): Promise<T | { queued: true }> {
  if (opts.queueable && typeof navigator !== "undefined" && !navigator.onLine) {
    await enqueue({ method, url, body, label: opts.label });
    return { queued: true };
  }
  try {
    return await api<T>(url, { method, body });
  } catch (e) {
    if (e instanceof NetworkError && opts.queueable) {
      await enqueue({ method, url, body, label: opts.label });
      return { queued: true };
    }
    throw e;
  }
}
export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
