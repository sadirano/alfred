import { useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { parseTagQuery } from "../lib/tagQuery";
import { STATUSES, statusLabel } from "../lib/status";
import type { SavedFilter, Space, Tag } from "../api/client";
import AiInput from "./AiInput";

const SORTS = ["recent", "random", "duration", "title"] as const;

// Query params that describe a saved filter. Everything else in the URL
// (space, filter, limit, offset) is positional context, not part of the filter.
const FILTER_PARAM_KEYS = ["q", "tagExpr", "tags", "exclude_tags", "tag_op", "status_in", "sort"];

function useCollapsed(id: string, defaultOpen = true) {
  const key = `sidebar-section-${id}`;
  const [open, setOpen] = useState(() => {
    const v = localStorage.getItem(key);
    return v === null ? defaultOpen : v === "1";
  });
  useEffect(() => { localStorage.setItem(key, open ? "1" : "0"); }, [key, open]);
  return [open, setOpen] as const;
}

function Section({ id, title, defaultOpen = true, children }: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useCollapsed(id, defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-xs uppercase text-zinc-500 hover:text-zinc-300 transition"
      >
        <span>{title}</span>
        <span className="text-[10px] text-zinc-600">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

export default function FilterSidebar({ open = false, onClose, width }: { open?: boolean; onClose?: () => void; width?: number }) {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [tagExpr, setTagExpr] = useState(sp.get("tagExpr") ?? "");
  const statuses = (sp.get("status_in") ?? "").split(",").filter(Boolean);
  const sort = sp.get("sort") ?? "recent";

  useEffect(() => { setQ(sp.get("q") ?? ""); }, [sp]);

  // Always points at the latest committed params. The debounced commits below
  // run from a timer whose closure (and react-router's functional-updater
  // `prev`) can be a stale pre-click snapshot; reading the ref instead means a
  // concurrently-set key like `filter`/`sort` isn't clobbered by the rebuild.
  const spRef = useRef(sp);
  spRef.current = sp;

  function commit(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(spRef.current);
    mutate(next);
    for (const k of Array.from(next.keys())) if (!next.get(k)) next.delete(k);
    setSp(next, { replace: true });
  }

  function applyText(value: string) {
    commit(next => {
      if (value) next.set("q", value); else next.delete("q");
    });
  }

  function applyTagExpr(value: string) {
    const parsed = parseTagQuery(value);
    commit(next => {
      next.set("tagExpr", value);
      if (parsed.tags.length) next.set("tags", parsed.tags.join(",")); else next.delete("tags");
      if (parsed.exclude_tags.length) next.set("exclude_tags", parsed.exclude_tags.join(",")); else next.delete("exclude_tags");
      next.set("tag_op", parsed.tag_op);
    });
  }

  useEffect(() => {
    const t = setTimeout(() => applyText(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const t = setTimeout(() => applyTagExpr(tagExpr), 300);
    return () => clearTimeout(t);
  }, [tagExpr]);

  function toggleStatus(s: string) {
    const cur = new Set(statuses);
    if (cur.has(s)) cur.delete(s); else cur.add(s);
    commit(next => {
      if (cur.size) next.set("status_in", Array.from(cur).join(",")); else next.delete("status_in");
    });
  }

  function setSort(s: string) {
    commit(next => next.set("sort", s));
  }

  function clearAll() {
    setQ("");
    setTagExpr("");
    const next = new URLSearchParams();
    if (spaceId != null) next.set("space", String(spaceId));
    setSp(next, { replace: true });
  }

  const parsed = useMemo(() => parseTagQuery(tagExpr), [tagExpr]);

  const spaceId = sp.get("space") ? Number(sp.get("space")) : null;

  const { data: allSpaces = [] } = useQuery({
    queryKey: ["spaces"],
    queryFn: api.listSpaces,
    staleTime: 60_000,
  });

  const activeSpace: Space | undefined = allSpaces.find(s => s.id === spaceId);

  const { data: allTags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api.listTags(),
    staleTime: 30_000,
  });

  const grouped = useMemo(() => {
    const map: Record<string, Tag[]> = {};
    const spaceNs = activeSpace?.namespaces ?? null;
    for (const t of allTags) {
      const colon = t.name.indexOf(":");
      const ns = colon > 0 ? t.name.slice(0, colon) : "";
      if (spaceNs !== null && ns !== "" && !spaceNs.includes(ns)) continue;
      if (spaceNs !== null && ns === "") continue;
      (map[ns] ??= []).push(t);
    }
    for (const ns in map) {
      map[ns].sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
    }
    return Object.entries(map).sort(([a], [b]) => {
      if (a === "" && b !== "") return 1;
      if (b === "" && a !== "") return -1;
      return a < b ? -1 : 1;
    });
  }, [allTags, activeSpace]);

  function toggleTag(name: string) {
    const active = new Set(parsed.tags);
    if (active.has(name)) {
      const next = [...parsed.tags.filter(t => t !== name), ...parsed.exclude_tags.map(t => `-${t}`)];
      setTagExpr(next.join(parsed.tag_op === "OR" ? " OR " : " AND "));
    } else {
      setTagExpr(prev => prev.trim() ? `${prev.trim()} AND ${name}` : name);
    }
  }

  // ---- Saved filters (Space-scoped) ----------------------------------------
  const qc = useQueryClient();
  const activeFilterId = sp.get("filter") ? Number(sp.get("filter")) : null;
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  // Two-step delete: first click on a filter's ✕ arms it (shows "remove?"),
  // second click removes. Auto-disarms so a stray first click is harmless.
  const [armedDelete, setArmedDelete] = useState<number | null>(null);
  const disarmTimer = useRef<number | undefined>(undefined);
  function armDelete(id: number) {
    setArmedDelete(id);
    window.clearTimeout(disarmTimer.current);
    disarmTimer.current = window.setTimeout(() => setArmedDelete(null), 3000);
  }

  const { data: savedFilters = [] } = useQuery({
    queryKey: ["space-filters", spaceId],
    queryFn: () => api.listSpaceFilters(spaceId!),
    enabled: spaceId != null,
    staleTime: 30_000,
  });

  const createFilter = useMutation({
    mutationFn: ({ name, params }: { name: string; params: Record<string, string> }) =>
      api.createSpaceFilter(spaceId!, name, params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["space-filters", spaceId] });
      setSaving(false);
      setNewName("");
    },
  });

  const deleteFilter = useMutation({
    mutationFn: (id: number) => api.deleteSpaceFilter(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["space-filters", spaceId] }),
  });

  // The current filter state as a plain param map, minus positional context.
  function currentParams(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of sp.entries()) {
      if (!FILTER_PARAM_KEYS.includes(k) || !v) continue;
      out[k] = v;
    }
    return out;
  }

  // Replace the whole filter state with a saved one, keeping the active space.
  function applyFilter(f: SavedFilter) {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(f.params)) if (v) next.set(k, v);
    if (spaceId != null) next.set("space", String(spaceId));
    next.set("filter", String(f.id));
    setSp(next, { replace: true });
    setQ(f.params.q ?? "");
    setTagExpr(f.params.tagExpr ?? "");
  }

  function saveCurrent() {
    const name = newName.trim();
    if (!name) return;
    createFilter.mutate({ name, params: currentParams() });
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={onClose} />
      )}
    <aside 
      style={{ width: width ?? 256 }}
      className={[
        "shrink-0 border-l border-zinc-800 p-3 space-y-4 text-sm overflow-y-auto bg-zinc-950",
        "fixed inset-y-0 right-0 z-50 transition-transform duration-200",
        open ? "translate-x-0" : "translate-x-full",
        "md:static md:inset-auto md:translate-x-0 md:transition-none",
        !open ? "md:hidden" : ""
      ].filter(Boolean).join(" ")}>
      <div className="flex items-center justify-between md:hidden -mt-1 mb-2">
        <span className="text-xs uppercase tracking-wide text-zinc-500">Filters</span>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 p-1 -mr-1">✕</button>
      </div>
      {spaceId != null && (
        <Section id="saved-filters" title="Saved filters">
          {savedFilters.length === 0 && !saving && (
            <p className="text-[10px] text-zinc-600">None yet — refine below, then save.</p>
          )}
          <div className="space-y-1">
            {savedFilters.map(f => {
              const active = f.id === activeFilterId;
              return (
                <div key={f.id} className="group/sf flex items-center gap-1">
                  <button
                    onClick={() => applyFilter(f)}
                    className={`flex-1 text-left px-2 py-1 rounded text-xs truncate transition ${
                      active ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    }`}
                    title={f.name}
                  >
                    {f.name}
                  </button>
                  {armedDelete === f.id ? (
                    <button
                      onClick={() => { deleteFilter.mutate(f.id); setArmedDelete(null); }}
                      className="px-1 text-red-400 hover:text-red-300 text-[10px] whitespace-nowrap"
                      title="Click again to remove"
                    >
                      remove?
                    </button>
                  ) : (
                    <button
                      onClick={() => armDelete(f.id)}
                      className="px-1 text-zinc-600 hover:text-red-400 opacity-0 group-hover/sf:opacity-100 transition-opacity text-xs"
                      title="Delete saved filter"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {saving ? (
            <div className="mt-1.5 flex items-center gap-1">
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") saveCurrent();
                  if (e.key === "Escape") { setSaving(false); setNewName(""); }
                }}
                placeholder="filter name"
                className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs"
              />
              <button onClick={saveCurrent} className="px-1.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs">save</button>
              <button onClick={() => { setSaving(false); setNewName(""); }} className="px-1 text-zinc-500 hover:text-zinc-300 text-xs">✕</button>
            </div>
          ) : (
            <button
              onClick={() => setSaving(true)}
              className="mt-1.5 text-xs text-zinc-400 hover:text-zinc-100"
            >
              + save current
            </button>
          )}
        </Section>
      )}

      <Section id="search" title="Search">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="full-text in titles & notes"
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5"
        />
      </Section>

      <Section id="tag-expr" title="Tag expression">
        <input
          value={tagExpr}
          onChange={e => setTagExpr(e.target.value)}
          placeholder="genre:romance AND source:manga"
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 font-mono text-xs"
        />
        <p className="text-[10px] text-zinc-500 mt-1">AND / OR / NOT · -tag excludes · namespace:value</p>
      </Section>

      {grouped.length > 0 && (
        <Section id="tags" title="Tags">
          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-0.5">
            {grouped.map(([ns, tags]) => (
              <div key={ns || "__other__"}>
                {ns && (
                  <div className="text-[10px] text-zinc-500 mb-1 uppercase tracking-wide">{ns}</div>
                )}
                <div className="flex flex-wrap gap-1">
                  {tags.map(({ name, count }) => {
                    const val = ns ? name.slice(ns.length + 1) : name;
                    const active = parsed.tags.includes(name);
                    return (
                      <button
                        key={name}
                        onClick={() => toggleTag(name)}
                        className={`px-2 py-0.5 rounded text-xs transition ${
                          active
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
                        }`}
                      >
                        {val}
                        <span className="ml-1 text-[10px] opacity-60">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section id="status" title="Status">
        <div className="flex flex-wrap gap-1">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={`px-2 py-1 rounded text-xs ${statuses.includes(s) ? "bg-blue-600" : "bg-zinc-800 text-zinc-400"}`}
            >
              {statusLabel(s, activeSpace)}
            </button>
          ))}
        </div>
      </Section>

      <Section id="sort" title="Sort">
        <select
          value={sort}
          onChange={e => setSort(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5"
        >
          {SORTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </Section>

      <button onClick={clearAll} className="text-xs text-zinc-400 hover:text-zinc-100 underline">
        clear filters
      </button>
    </aside>
    </>
  );
}
