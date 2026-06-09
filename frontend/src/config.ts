// ---------------------------------------------------------------------------
// Single source of truth for everything that distinguishes this demo build from
// upstream yumi: its name, its localStorage namespace, and its GitHub Pages base
// path. Components, the localStorage client, and vite.config all read from here,
// so a rebrand (e.g. alfad -> alfred) is a one-file change and the rest of the
// source stays byte-identical to yumi for cheap future syncs.
//
// Keep this file dependency-free (no React, no imports) — vite.config imports it.
// ---------------------------------------------------------------------------

/** Display name shown in the header, backup filenames, and demo copy. */
export const APP_NAME = "alfad";

/** localStorage key namespace. Keys are built as `${STORAGE_PREFIX}:<name>`. */
export const STORAGE_PREFIX = APP_NAME;

/** GitHub Pages base path the app is published under (must start and end with /). */
export const BASE_PATH = "/alfad/";
