import { useSyncExternalStore } from "react";
import { APP_NAME, STORAGE_PREFIX } from "../config";

// ---------------------------------------------------------------------------
// This is a frozen browser-only preview of a larger private tool. Features that
// need the backend (a server, yt-dlp, local file access, FTS, revision history,
// AI note generation) can't run client-side. Rather than hide them, we keep them
// VISIBLE but badged "Full version only" so a visitor glimpses the full app —
// with a one-click toggle to hide them for a cleaner demo.
// ---------------------------------------------------------------------------

// The single capability switch this demo flips: backend-only UI keys off this so
// components stay identical to upstream yumi (which would set it true) instead of
// being forked per-feature.
export const BACKEND_AVAILABLE = false;

export const FULL_VERSION_NOTE =
  `Available in the full version. ${APP_NAME} is a browser-only preview, so this needs the backend.`;

const HIDE_KEY = `${STORAGE_PREFIX}:hide-unsupported`;

// A tiny localStorage-backed store so the "Hide unsupported features" toggle
// updates every badge live, without a full page reload.
const listeners = new Set<() => void>();

export function getHideUnsupported(): boolean {
  return localStorage.getItem(HIDE_KEY) === "1";
}

export function setHideUnsupported(hide: boolean): void {
  localStorage.setItem(HIDE_KEY, hide ? "1" : "0");
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive read of the "hide unsupported features" preference. */
export function useHideUnsupported(): boolean {
  return useSyncExternalStore(subscribe, getHideUnsupported, () => false);
}
