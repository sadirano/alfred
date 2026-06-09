import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  browsable?: boolean;
  allowedNamespaces?: string[];
}

function TagPill({ name, onRemove }: { name: string; onRemove?: () => void }) {
  const colon = name.indexOf(":");
  const ns = colon > 0 ? name.slice(0, colon + 1) : null;
  const val = colon > 0 ? name.slice(colon + 1) : name;
  return (
    <span className="inline-flex items-center gap-0.5 bg-zinc-800 text-zinc-200 rounded px-2 py-0.5 text-xs">
      {ns && <span className="text-zinc-500">{ns}</span>}
      {val}
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-0.5 text-zinc-500 hover:text-zinc-200">×</button>
      )}
    </span>
  );
}

export function renderTagName(name: string) {
  const colon = name.indexOf(":");
  if (colon <= 0) return <>{name}</>;
  return <><span className="text-zinc-500">{name.slice(0, colon + 1)}</span>{name.slice(colon + 1)}</>;
}

function tagNamespace(name: string): string {
  const colon = name.indexOf(":");
  return colon > 0 ? name.slice(0, colon) : "";
}

export default function TagInput({ value, onChange, placeholder, browsable = true, allowedNamespaces }: Props) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseFilter, setBrowseFilter] = useState("");
  const [copied, setCopied] = useState(false);
  // Set when a commit is dropped because every part lacked a namespace, so we
  // can tell the user why nothing was added instead of failing silently.
  const [needsNamespace, setNeedsNamespace] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Tracks latest input value for the blur handler's setTimeout closure, so a
  // suggestion mousedown that clears the input is visible when the timer fires.
  const pendingInput = useRef(input);
  pendingInput.current = input;

  // All tags, grouped by namespace (AniList-style browse panel). Shares the
  // ["tags"] query cache with FilterSidebar so we don't refetch.
  const { data: allTags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api.listTags(),
    staleTime: 30_000,
    enabled: browsable && browseOpen,
  });

  const grouped = useMemo(() => {
    const needle = browseFilter.trim().toLowerCase();
    const map: Record<string, typeof allTags> = {};
    for (const t of allTags) {
      if (needle && !t.name.toLowerCase().includes(needle)) continue;
      const ns = tagNamespace(t.name);
      if (allowedNamespaces?.length && !allowedNamespaces.includes(ns)) continue;
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
  }, [allTags, browseFilter]);

  function toggle(name: string) {
    if (value.includes(name)) onChange(value.filter(v => v !== name));
    else onChange([...value, name]);
  }

  useEffect(() => {
    let cancel = false;
    if (!input.trim()) { setSuggestions([]); setActiveIdx(-1); return; }
    const t = setTimeout(async () => {
      const tags = await api.listTags(input.trim());
      if (!cancel) {
        setSuggestions(
          tags.map(t => t.name)
            .filter(n => !value.includes(n))
            .filter(n => !allowedNamespaces?.length || allowedNamespaces.includes(tagNamespace(n)))
            .slice(0, 8)
        );
        setActiveIdx(-1);
      }
    }, 100);
    return () => { cancel = true; clearTimeout(t); };
  }, [input, value]);

  // Accepts a single tag or a comma-separated list (e.g. a pasted
  // "music:loop, score:nice, year:2026"). Each part is normalized and added,
  // skipping duplicates — so a paste no longer collapses into one mega-tag.
  function commit(raw: string) {
    const parts = raw
      .split(",")
      .map(s => s.trim().toLowerCase().replace(/\s+/g, "-"))
      .filter(Boolean);
    // Every tag must be namespaced (e.g. "genre:romance") with a non-empty
    // namespace and value — ":x" and "genre:" are rejected. Drop invalid parts;
    // if that leaves nothing, keep the typed input and surface a hint instead of
    // silently clearing it.
    const valid = parts.filter(p => {
      const colon = p.indexOf(":");
      return colon > 0 && colon < p.length - 1;
    });
    if (!valid.length) {
      setNeedsNamespace(parts.length > 0);
      return;
    }
    setNeedsNamespace(false);
    const next = [...value];
    for (const p of valid) if (!next.includes(p)) next.push(p);
    if (next.length !== value.length) onChange(next);
    setInput("");
    setSuggestions([]);
    setActiveIdx(-1);
  }

  function remove(name: string) {
    onChange(value.filter(v => v !== name));
  }

  // Copy the current tags as a comma-separated list — the same shape the input
  // accepts back, so a copied set can be pasted into another item.
  function copyAll() {
    if (!value.length) return;
    navigator.clipboard.writeText(value.join(", ")).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => {},
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const open = focused && suggestions.length > 0;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (open) setActiveIdx(i => (i + 1) % suggestions.length);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (open) setActiveIdx(i => (i <= 0 ? suggestions.length - 1 : i - 1));
      return;
    }

    if (e.key === "Tab") {
      if (open) {
        e.preventDefault();
        commit(activeIdx >= 0 ? suggestions[activeIdx] : suggestions[0]);
      }
      return;
    }

    if (e.key === "Escape") {
      setSuggestions([]);
      setActiveIdx(-1);
      return;
    }

    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (open && activeIdx >= 0) {
        commit(suggestions[activeIdx]);
      } else {
        commit(input);
      }
      return;
    }

    // Only act on a deliberate, discrete press. Ignoring auto-repeat (e.repeat)
    // means holding Backspace removes at most one tag instead of chain-deleting
    // the whole list when the key is held a moment too long.
    if (e.key === "Backspace" && !input && value.length && !e.repeat) {
      remove(value[value.length - 1]);
    }
  }

  // Scroll the highlighted item into view
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const item = listRef.current.children[activeIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const showDropdown = focused && suggestions.length > 0;

  return (
    <div ref={wrapRef} className="relative">
      {/* Chips live outside the field so the box is purely for typing. Kept above
          the input so the suggestions dropdown still anchors directly below it. */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {value.map(t => (
            <TagPill key={t} name={t} onRemove={() => remove(t)} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 p-2 bg-zinc-900 border border-zinc-800 rounded">
        <input
          className="flex-1 min-w-32 bg-transparent outline-none text-sm"
          value={input}
          placeholder={placeholder ?? "add tag… (namespace:value)"}
          onChange={e => { setInput(e.target.value); if (needsNamespace) setNeedsNamespace(false); }}
          aria-describedby={needsNamespace ? "tags-namespace-hint" : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => { setFocused(false); commit(pendingInput.current); }, 150)}
          onKeyDown={handleKeyDown}
          onPaste={e => {
            const text = e.clipboardData.getData("text");
            if (text.includes(",")) { e.preventDefault(); commit(text); }
          }}
        />
        {value.length > 0 && (
          <button
            type="button"
            onClick={copyAll}
            title="Copy all tags"
            className={`shrink-0 px-1.5 rounded text-xs border ${
              copied
                ? "bg-emerald-700 border-emerald-600 text-white"
                : "border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            {copied ? "✓" : "⧉"}
          </button>
        )}
        {browsable && (
          <button
            type="button"
            onClick={() => setBrowseOpen(o => !o)}
            title="Browse all tags"
            className={`shrink-0 px-1.5 rounded text-xs border ${
              browseOpen
                ? "bg-zinc-700 border-zinc-600 text-zinc-100"
                : "border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            ⊞
          </button>
        )}
      </div>

      {needsNamespace && (
        <div id="tags-namespace-hint" className="mt-1 text-xs text-amber-400/80">
          Tags need a namespace, e.g. <span className="font-mono">genre:value</span>
        </div>
      )}

      {browsable && browseOpen && (
        <div className="mt-1.5 bg-zinc-900 border border-zinc-800 rounded p-2">
          <input
            value={browseFilter}
            onChange={e => setBrowseFilter(e.target.value)}
            placeholder="filter tags…"
            className="w-full mb-2 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs outline-none"
          />
          <div className="max-h-72 overflow-y-auto pr-0.5 space-y-2.5">
            {grouped.length === 0 && (
              <div className="text-xs text-zinc-500">No tags found.</div>
            )}
            {grouped.map(([ns, tags]) => (
              <div key={ns || "__other__"}>
                <div className="text-[10px] text-zinc-500 mb-1 uppercase tracking-wide">
                  {ns || "other"}
                </div>
                <div className="flex flex-wrap gap-1">
                  {tags.map(({ name, count }) => {
                    const val = ns ? name.slice(ns.length + 1) : name;
                    const active = value.includes(name);
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => toggle(name)}
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
        </div>
      )}
      {showDropdown && (
        <ul ref={listRef} className="absolute z-10 mt-1 w-full bg-zinc-900 border border-zinc-800 rounded shadow-lg">
          {suggestions.map((s, i) => (
            <li
              key={s}
              className={`px-2 py-1 text-sm cursor-pointer ${i === activeIdx ? "bg-zinc-700 text-white" : "hover:bg-zinc-800"}`}
              onMouseDown={() => commit(s)}
              onMouseEnter={() => setActiveIdx(i)}
            >
              {renderTagName(s)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
