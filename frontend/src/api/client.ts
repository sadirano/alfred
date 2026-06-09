import { APP_NAME, STORAGE_PREFIX } from "../config";

export type ItemKind = "youtube" | "url" | "file" | "note";
export type ItemStatus = "plan" | "in-progress" | "completed" | "archived";

export interface Tag { id: number; name: string; count: number }

export interface RelatedLink { label: string; url: string }

export interface Item {
  id: number;
  kind: ItemKind;
  url: string | null;
  file_path: string | null;
  title: string;
  description: string;
  notes_md: string;
  thumbnail_url: string | null;
  channel: string;
  duration_sec: number | null;
  published_at: string | null;
  status: ItemStatus;
  progress: number;
  total: number | null;
  anilist_id: number | null;
  related_links: RelatedLink[];
  needs_enrichment: boolean;
  access_count: number;
  last_accessed_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  tags: Tag[];
}

export interface SavedFilter {
  id: number;
  space_id: number;
  name: string;
  params: Record<string, string>;
  created_at: string;
}

export interface Revision {
  id: number;
  item_id: number;
  title: string;
  notes_md: string;
  tags_json: string;
  status: string;
  created_at: string;
}

export interface ItemCreate {
  url?: string;
  file_path?: string;
  note_title?: string;
  note_body?: string;
  tags?: string[];
  status?: ItemStatus;
  notes_md?: string;
}

export interface ItemPatch {
  title?: string;
  notes_md?: string;
  status?: ItemStatus;
  tags?: string[];
  description?: string;
  thumbnail_url?: string | null;
  progress?: number;
  total?: number | null;
  url?: string | null;
  file_path?: string | null;
  anilist_id?: number | null;
  related_links?: RelatedLink[];
}

export interface Template {
  id: string;
  name: string;
  content: string;
}

export interface Space {
  id: number;
  name: string;
  namespaces: string[];
  tags: string[];
  // Per-Space display labels for the 3 active statuses; null = canonical defaults.
  labels: Record<string, string> | null;
  note_template_md: string;
  templates: Template[];
  created_at: string;
}

export interface ItemQuery {
  q?: string;
  tags?: string[];
  tag_op?: "AND" | "OR";
  exclude_tags?: string[];
  status_in?: ItemStatus[];
  sort?: "recent" | "random" | "duration" | "title";
  limit?: number;
  offset?: number;
  space_id?: number;
}

export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(`API ${status}`);
  }
}

// ---------------------------------------------------------------------------
// This is a browser-only demo: the FastAPI backend is NOT shipped. The whole
// data layer lives in localStorage under a single JSON document, and every
// method below mirrors the semantics of the original `app/` Python code so the
// pages, react-query usage, and components are unchanged. All methods return
// resolved Promises so callers can stay async.
// ---------------------------------------------------------------------------

const DB_KEY = `${STORAGE_PREFIX}:db`;

interface Db {
  seq: number;                 // id counter for items/spaces/filters
  tagSeq: number;              // id counter for derived tags
  tagIds: Record<string, number>; // stable name -> id so a tag keeps its id everywhere
  items: Item[];               // includes soft-deleted (deleted_at != null) for trash
  spaces: Space[];
  savedFilters: SavedFilter[];
}

function emptyDb(): Db {
  return { seq: 0, tagSeq: 0, tagIds: {}, items: [], spaces: [], savedFilters: [] };
}

function loadDb(): Db {
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) return emptyDb();
  try {
    const parsed = JSON.parse(raw);
    return {
      seq: parsed.seq ?? 0,
      tagSeq: parsed.tagSeq ?? 0,
      tagIds: parsed.tagIds ?? {},
      items: parsed.items ?? [],
      // Backfill Space fields added after a build was first shipped, so spaces
      // saved by an older demo don't crash components that read them unguarded.
      spaces: (parsed.spaces ?? []).map((s: any) => ({
        note_template_md: "",
        templates: [],
        ...s,
      })),
      savedFilters: parsed.savedFilters ?? [],
    };
  } catch {
    return emptyDb();
  }
}

function saveDb(db: Db): void {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function nowIso(): string {
  // Match the backend's `utcnow_iso()` (seconds precision, UTC).
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

// --- tags ------------------------------------------------------------------

// Ports crud.normalize_tag: trim, lowercase, spaces -> hyphens.
function normalizeTag(name: string): string {
  return name.trim().toLowerCase().replace(/ /g, "-");
}

function tagId(db: Db, name: string): number {
  let id = db.tagIds[name];
  if (id == null) {
    id = ++db.tagSeq;
    db.tagIds[name] = id;
  }
  return id;
}

// Resolve a list of raw names to deduped, normalized, sorted Tag objects with
// stable ids. Item-level tags always carry count: 0 (only listTags computes
// real counts), mirroring the backend's ItemOut/TagOut split.
function tagsFromNames(db: Db, names: string[]): Tag[] {
  const cleaned = Array.from(
    new Set(names.map(normalizeTag).filter((n) => n.length > 0)),
  ).sort();
  return cleaned.map((name) => ({ id: tagId(db, name), name, count: 0 }));
}

// --- url normalization / enrichment (ports of enrich.py) -------------------

function ytId(url: string): string | null {
  let p: URL;
  try {
    p = new URL(url.includes("://") ? url : "https://" + url);
  } catch {
    return null;
  }
  const host = p.hostname;
  if (host === "youtu.be") {
    const vid = p.pathname.replace(/^\//, "").split("/")[0];
    return vid || null;
  }
  if (host.endsWith("youtube.com")) {
    if (p.pathname === "/watch") return p.searchParams.get("v");
    const m = p.pathname.match(/^\/(shorts|embed|live|v)\/([^/]+)/);
    if (m) return m[2];
  }
  return null;
}

export function normalizeUrl(raw: string): string {
  const url = raw.trim();
  const yt = ytId(url);
  if (yt) return `https://www.youtube.com/watch?v=${yt}`;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    try {
      u = new URL("https://" + url);
    } catch {
      return url;
    }
  }
  const scheme = u.protocol.replace(/:$/, "").toLowerCase();
  const netloc = u.host.toLowerCase();
  const path = u.pathname || "/";
  // Mirror urlunparse: keep query, drop fragment.
  return `${scheme}://${netloc}${path}${u.search}`;
}

function isYoutube(url: string): boolean {
  let host = "";
  try { host = new URL(url).hostname; } catch { /* noop */ }
  return [
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "music.youtube.com", "youtu.be",
  ].includes(host);
}

interface Enrichment {
  kind: ItemKind;
  title: string;
  description: string;
  channel: string;
  thumbnail_url: string | null;
  duration_sec: number | null;
  published_at: string | null;
  needs_enrichment: boolean;
}

// YouTube oEmbed is CORS-open from github.io and fills title/channel/thumbnail.
// (Duration/published date needed yt-dlp and are not available client-side.)
async function enrichUrl(url: string): Promise<Enrichment> {
  if (isYoutube(url)) {
    try {
      const r = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      );
      if (r.ok) {
        const j: any = await r.json();
        return {
          kind: "youtube",
          title: j.title || "",
          description: "",
          channel: j.author_name || "",
          thumbnail_url: j.thumbnail_url || null,
          duration_sec: null,
          published_at: null,
          needs_enrichment: false,
        };
      }
    } catch {
      /* fall through to needs_enrichment */
    }
    return {
      kind: "youtube", title: "", description: "", channel: "",
      thumbnail_url: null, duration_sec: null, published_at: null,
      needs_enrichment: true,
    };
  }
  // Non-YouTube generic <meta> scraping is CORS-blocked in the browser: this is
  // a "Full version only" feature. Record the item but flag it for manual entry.
  return {
    kind: "url", title: "", description: "", channel: "",
    thumbnail_url: null, duration_sec: null, published_at: null,
    needs_enrichment: true,
  };
}

// --- item construction / lookup --------------------------------------------

function newItem(db: Db, fields: Partial<Item>): Item {
  const ts = nowIso();
  return {
    id: ++db.seq,
    kind: "note",
    url: null,
    file_path: null,
    title: "",
    description: "",
    notes_md: "",
    thumbnail_url: null,
    channel: "",
    duration_sec: null,
    published_at: null,
    status: "plan",
    progress: 0,
    total: null,
    anilist_id: null,
    related_links: [],
    needs_enrichment: false,
    access_count: 0,
    last_accessed_at: null,
    deleted_at: null,
    created_at: ts,
    updated_at: ts,
    tags: [],
    ...fields,
  };
}

function findLiveByUrl(db: Db, url: string): Item | undefined {
  return db.items.find((i) => i.url === url && i.deleted_at == null);
}

function findLiveByPath(db: Db, path: string): Item | undefined {
  return db.items.find((i) => i.file_path === path && i.deleted_at == null);
}

function duplicate(existingId: number): ApiError {
  // Shape the AddItemDialog already handles: err.body.detail.existing_id.
  return new ApiError(409, { detail: { reason: "duplicate", existing_id: existingId } });
}

// --- query engine (ports routers/items.list_items) -------------------------

function runQuery(db: Db, q: ItemQuery): Item[] {
  let items = db.items.filter((i) => i.deleted_at == null);

  if (q.space_id != null) {
    const space = db.spaces.find((s) => s.id === q.space_id);
    if (space) {
      if (space.namespaces.length) {
        items = items.filter((i) =>
          i.tags.some((t) => space.namespaces.some((ns) => t.name.startsWith(`${ns}:`))),
        );
      }
      for (const required of space.tags) {
        items = items.filter((i) => i.tags.some((t) => t.name === required));
      }
    }
  }

  if (q.status_in?.length) {
    const set = new Set(q.status_in);
    items = items.filter((i) => set.has(i.status));
  }

  if (q.q) {
    const needle = q.q.toLowerCase();
    items = items.filter((i) =>
      [i.title, i.description, i.notes_md, i.channel]
        .some((f) => (f || "").toLowerCase().includes(needle)),
    );
  }

  const tagList = (q.tags ?? []).map(normalizeTag).filter(Boolean);
  const exclList = (q.exclude_tags ?? []).map(normalizeTag).filter(Boolean);

  if (tagList.length) {
    if (q.tag_op === "OR") {
      items = items.filter((i) => i.tags.some((t) => tagList.includes(t.name)));
    } else {
      items = items.filter((i) =>
        tagList.every((name) => i.tags.some((t) => t.name === name)),
      );
    }
  }

  if (exclList.length) {
    items = items.filter((i) => !i.tags.some((t) => exclList.includes(t.name)));
  }

  const sort = q.sort ?? "recent";
  if (sort === "recent") {
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
  } else if (sort === "random") {
    for (let k = items.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [items[k], items[j]] = [items[j], items[k]];
    }
  } else if (sort === "duration") {
    // nulls last, then descending — matches the backend's order_by.
    items.sort((a, b) => {
      const an = a.duration_sec == null, bn = b.duration_sec == null;
      if (an !== bn) return an ? 1 : -1;
      return (b.duration_sec ?? 0) - (a.duration_sec ?? 0);
    });
  } else {
    items.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  }

  const offset = q.offset ?? 0;
  const limit = q.limit ?? 60;
  return items.slice(offset, offset + limit);
}

// Backend-only endpoints (AI generation, server-side file storage). The UI gates
// these behind FullVersionBadge so they're never actually invoked in the demo;
// the rejection exists only as a safety net and to satisfy the call signature.
function fullVersionOnly(feature: string): ApiError {
  return new ApiError(501, { detail: `${feature} needs the backend (full version only).` });
}

// ---------------------------------------------------------------------------

export const api = {
  listItems: (q: ItemQuery = {}) => Promise.resolve(clone(runQuery(loadDb(), q))),

  getItem: (id: number) => {
    const db = loadDb();
    const item = db.items.find((i) => i.id === id);
    if (!item) return Promise.reject(new ApiError(404, { detail: "not found" }));
    return Promise.resolve(clone(item));
  },

  createItem: async (body: ItemCreate): Promise<Item> => {
    const db = loadDb();
    if (!(body.url || body.file_path || body.note_title || body.note_body)) {
      throw new ApiError(400, { detail: "Provide one of: url, file_path, note_title/note_body" });
    }
    let item: Item;
    if (body.url) {
      const url = normalizeUrl(body.url);
      const existing = findLiveByUrl(db, url);
      if (existing) throw duplicate(existing.id);
      const enr = await enrichUrl(url);
      item = newItem(db, {
        kind: enr.kind,
        url,
        title: enr.title || url,
        description: enr.description,
        channel: enr.channel,
        thumbnail_url: enr.thumbnail_url,
        duration_sec: enr.duration_sec,
        published_at: enr.published_at,
        notes_md: body.notes_md ?? "",
        status: body.status ?? "plan",
        needs_enrichment: enr.needs_enrichment,
      });
    } else if (body.file_path) {
      const existing = findLiveByPath(db, body.file_path);
      if (existing) throw duplicate(existing.id);
      const base = body.file_path.split(/[/\\]/).pop() || body.file_path;
      item = newItem(db, {
        kind: "file",
        file_path: body.file_path,
        title: body.note_title || base,
        notes_md: body.notes_md ?? "",
        status: body.status ?? "plan",
      });
    } else {
      item = newItem(db, {
        kind: "note",
        title: body.note_title || "(untitled note)",
        notes_md: body.notes_md || body.note_body || "",
        status: body.status ?? "plan",
      });
    }
    if (body.tags?.length) item.tags = tagsFromNames(db, body.tags);
    db.items.push(item);
    saveDb(db);
    return clone(item);
  },

  patchItem: (id: number, body: ItemPatch, _opts?: { snapshot?: boolean }) => {
    const db = loadDb();
    const item = db.items.find((i) => i.id === id);
    if (!item || item.deleted_at) return Promise.reject(new ApiError(404, { detail: "not found" }));
    // Revision history is a "Full version only" feature in the demo; snapshot is a no-op.
    if (body.tags !== undefined) item.tags = tagsFromNames(db, body.tags ?? []);
    if (body.related_links !== undefined) {
      item.related_links = (body.related_links ?? []).filter((l) => (l.url || "").trim());
    }
    for (const k of ["title", "notes_md", "status", "description", "thumbnail_url", "progress", "total", "url", "file_path", "anilist_id"] as const) {
      if (body[k] !== undefined) (item as any)[k] = body[k];
    }
    item.updated_at = nowIso();
    saveDb(db);
    return Promise.resolve(clone(item));
  },

  deleteItem: (id: number) => {
    const db = loadDb();
    const item = db.items.find((i) => i.id === id);
    if (!item || item.deleted_at) return Promise.reject(new ApiError(404, { detail: "not found" }));
    item.deleted_at = nowIso();
    saveDb(db);
    return Promise.resolve();
  },

  restoreItem: (id: number) => {
    const db = loadDb();
    const item = db.items.find((i) => i.id === id);
    if (!item || !item.deleted_at) return Promise.reject(new ApiError(404, { detail: "not in trash" }));
    if (item.url) {
      const clash = findLiveByUrl(db, item.url);
      if (clash) return Promise.reject(duplicate(clash.id));
    }
    if (item.file_path) {
      const clash = findLiveByPath(db, item.file_path);
      if (clash) return Promise.reject(duplicate(clash.id));
    }
    item.deleted_at = null;
    item.updated_at = nowIso();
    saveDb(db);
    return Promise.resolve(clone(item));
  },

  purgeItem: (id: number) => {
    const db = loadDb();
    const item = db.items.find((i) => i.id === id);
    if (!item || !item.deleted_at) return Promise.reject(new ApiError(404, { detail: "not in trash" }));
    db.items = db.items.filter((i) => i.id !== id);
    saveDb(db);
    return Promise.resolve();
  },

  refreshItem: async (id: number): Promise<Item> => {
    const db = loadDb();
    const item = db.items.find((i) => i.id === id);
    if (!item || item.deleted_at) throw new ApiError(404, { detail: "not found" });
    if (!item.url) throw new ApiError(400, { detail: "item has no URL to refresh" });
    const enr = await enrichUrl(item.url);
    item.title = enr.title || item.title;
    item.description = enr.description || item.description;
    item.channel = enr.channel || item.channel;
    item.thumbnail_url = enr.thumbnail_url || item.thumbnail_url;
    item.duration_sec = enr.duration_sec ?? item.duration_sec;
    item.published_at = enr.published_at || item.published_at;
    item.needs_enrichment = enr.needs_enrichment;
    item.updated_at = nowIso();
    saveDb(db);
    return clone(item);
  },

  // Records one explicit open-the-resource click (usage metrics). Like the
  // backend, this bumps access_count/last_accessed_at WITHOUT touching
  // updated_at, so opening a link doesn't re-sort a "recent" library.
  pingAccess: (id: number) => {
    const db = loadDb();
    const item = db.items.find((i) => i.id === id && i.deleted_at == null);
    if (!item) return Promise.reject(new ApiError(404, { detail: "not found" }));
    item.access_count += 1;
    item.last_accessed_at = nowIso();
    saveDb(db);
    return Promise.resolve();
  },

  listTags: (prefix?: string) => {
    const db = loadDb();
    const counts = new Map<string, number>();
    for (const item of db.items) {
      if (item.deleted_at) continue;
      for (const t of item.tags) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
    }
    let tags: Tag[] = Array.from(counts.entries()).map(([name, count]) => ({
      id: tagId(db, name), name, count,
    }));
    if (prefix) {
      const p = prefix.toLowerCase();
      tags = tags.filter((t) => t.name.startsWith(p));
    }
    // count desc, then name asc; cap at 50 like the backend default.
    tags.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    saveDb(db); // persist any newly-assigned tag ids
    return Promise.resolve(tags.slice(0, 50));
  },

  deleteTag: (name: string) => {
    const db = loadDb();
    const norm = name.toLowerCase();
    for (const item of db.items) {
      item.tags = item.tags.filter((t) => t.name !== norm);
    }
    delete db.tagIds[norm];
    saveDb(db);
    return Promise.resolve();
  },

  listSpaceFilters: (spaceId: number) => {
    const db = loadDb();
    if (!db.spaces.find((s) => s.id === spaceId)) {
      return Promise.reject(new ApiError(404, { detail: "space not found" }));
    }
    const out = db.savedFilters
      .filter((f) => f.space_id === spaceId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return Promise.resolve(clone(out));
  },

  createSpaceFilter: (spaceId: number, name: string, params: Record<string, string>) => {
    const db = loadDb();
    if (!db.spaces.find((s) => s.id === spaceId)) {
      return Promise.reject(new ApiError(404, { detail: "space not found" }));
    }
    const trimmed = name.trim();
    if (!trimmed) return Promise.reject(new ApiError(400, { detail: "name required" }));
    const f: SavedFilter = {
      id: ++db.seq, space_id: spaceId, name: trimmed, params, created_at: nowIso(),
    };
    db.savedFilters.push(f);
    saveDb(db);
    return Promise.resolve(clone(f));
  },

  updateSpaceFilter: (id: number, data: { name?: string; params?: Record<string, string> }) => {
    const db = loadDb();
    const f = db.savedFilters.find((x) => x.id === id);
    if (!f) return Promise.reject(new ApiError(404, { detail: "not found" }));
    if (data.name !== undefined) {
      const trimmed = data.name.trim();
      if (!trimmed) return Promise.reject(new ApiError(400, { detail: "name required" }));
      f.name = trimmed;
    }
    if (data.params !== undefined) f.params = data.params;
    saveDb(db);
    return Promise.resolve(clone(f));
  },

  deleteSpaceFilter: (id: number) => {
    const db = loadDb();
    db.savedFilters = db.savedFilters.filter((f) => f.id !== id);
    saveDb(db);
    return Promise.resolve();
  },

  listTrash: () => {
    const db = loadDb();
    const out = db.items
      .filter((i) => i.deleted_at != null)
      .sort((a, b) => (b.deleted_at ?? "").localeCompare(a.deleted_at ?? ""));
    return Promise.resolve(clone(out));
  },

  // Revision history is "Full version only" in the demo: no snapshots are kept.
  listRevisions: (_itemId: number): Promise<Revision[]> => Promise.resolve([]),
  restoreRevision: (_itemId: number, _revId: number): Promise<Item> =>
    Promise.reject(new ApiError(404, { detail: "revision not found" })),

  listSpaces: () => {
    const db = loadDb();
    const out = [...db.spaces].sort((a, b) => a.created_at.localeCompare(b.created_at));
    return Promise.resolve(clone(out));
  },

  createSpace: (name: string, namespaces: string[], tags: string[], labels?: Record<string, string> | null) => {
    const db = loadDb();
    const s: Space = {
      id: ++db.seq,
      name: name.trim(),
      namespaces: [...namespaces].sort(),
      tags: [...tags].sort(),
      labels: labels && Object.keys(labels).length ? labels : null,
      note_template_md: "",
      templates: [],
      created_at: nowIso(),
    };
    db.spaces.push(s);
    saveDb(db);
    return Promise.resolve(clone(s));
  },

  updateSpace: (id: number, data: { name?: string; namespaces?: string[]; tags?: string[]; labels?: Record<string, string> | null; note_template_md?: string; templates?: Template[] }) => {
    const db = loadDb();
    const s = db.spaces.find((x) => x.id === id);
    if (!s) return Promise.reject(new ApiError(404, { detail: "not found" }));
    if (data.name != null) s.name = data.name.trim();
    if (data.namespaces != null) s.namespaces = [...data.namespaces].sort();
    if (data.tags != null) s.tags = [...data.tags].sort();
    if (data.labels !== undefined) {
      s.labels = data.labels && Object.keys(data.labels).length ? data.labels : null;
    }
    if (data.note_template_md !== undefined) s.note_template_md = data.note_template_md;
    if (data.templates !== undefined) s.templates = data.templates;
    saveDb(db);
    return Promise.resolve(clone(s));
  },

  deleteSpace: (id: number) => {
    const db = loadDb();
    const s = db.spaces.find((x) => x.id === id);
    if (!s) return Promise.reject(new ApiError(404, { detail: "not found" }));
    db.spaces = db.spaces.filter((x) => x.id !== id);
    // Cascade: drop this space's saved filters, mirroring the FK ondelete.
    db.savedFilters = db.savedFilters.filter((f) => f.space_id !== id);
    saveDb(db);
    return Promise.resolve();
  },

  // --- backend-only (gated by FullVersionBadge, never reached in the demo) ---

  // AI note generation ran server-side against Gemini in the full version.
  askAI: (_prompt: string): Promise<{ response: string }> =>
    Promise.reject(fullVersionOnly("AI notes")),

  // Server-side attachment storage. The read resolves empty so the attachments
  // panel renders cleanly; writes reject (and the UI badges them full-version).
  listAttachments: (_itemId: number): Promise<{ name: string; size: number; url: string }[]> =>
    Promise.resolve([]),
  uploadItemFile: (_itemId: number, _file: File): Promise<{ url: string }> =>
    Promise.reject(fullVersionOnly("File uploads")),
  uploadAttachment: (_itemId: number, _file: File): Promise<{ name: string; size: number; url: string }> =>
    Promise.reject(fullVersionOnly("Attachments")),
  deleteAttachment: (_itemId: number, _name: string): Promise<void> =>
    Promise.reject(fullVersionOnly("Attachments")),
};

// --- backup / restore (Phase F) --------------------------------------------

/** The entire localStorage DB document as a pretty-printed JSON string for download. */
export function exportDb(): string {
  return JSON.stringify(loadDb(), null, 2);
}

/** Replace the whole store from an exported JSON string. Throws on bad shape. */
export function importDb(json: string): void {
  const parsed = JSON.parse(json);
  if (typeof parsed !== "object" || parsed == null || !Array.isArray(parsed.items)) {
    throw new Error(`Not a valid ${APP_NAME} backup file.`);
  }
  const db: Db = {
    seq: parsed.seq ?? 0,
    tagSeq: parsed.tagSeq ?? 0,
    tagIds: parsed.tagIds ?? {},
    items: parsed.items ?? [],
    spaces: parsed.spaces ?? [],
    savedFilters: parsed.savedFilters ?? [],
  };
  saveDb(db);
}


/** The external link an item points at, or null if it has none (e.g. notes).
 *  file items become a file:/// URL; browsers may block opening these. */
export function itemLink(item: Item): string | null {
  if (item.url) return item.url;
  if (item.file_path) return encodeURI("file:///" + item.file_path.replace(/\\/g, "/"));
  return null;
}

export function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
