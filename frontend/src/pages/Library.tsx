import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, Item, ItemQuery, ItemStatus } from "../api/client";
import { NEXT_STATUS } from "../lib/status";
import FilterSidebar from "../components/FilterSidebar";
import ItemCard, { Layout } from "../components/ItemCard";
import { STORAGE_PREFIX } from "../config";

function LayoutBtn({ active, title, onClick, children }: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`p-1.5 rounded transition ${active ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"}`}
    >
      {children}
    </button>
  );
}

const DEFAULT_RIGHT_W = 256;
const MIN_SIDE_W = 180;
const HANDLE_W = 6;

export default function Library() {
  const [sp] = useSearchParams();
  const qc = useQueryClient();
  
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}:librarySidebarOpen`);
    return saved === "false" ? false : true;
  });
  
  const [rightW, setRightW] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}:libraryRightW`);
    return saved ? Number(saved) : DEFAULT_RIGHT_W;
  });
  
  const dragging = useRef<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => { localStorage.setItem(`${STORAGE_PREFIX}:librarySidebarOpen`, String(sidebarOpen)); }, [sidebarOpen]);
  useEffect(() => { localStorage.setItem(`${STORAGE_PREFIX}:libraryRightW`, String(rightW)); }, [rightW]);
  
  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newW = Math.max(MIN_SIDE_W, Math.min(rect.right - e.clientX, rect.width - MIN_SIDE_W - HANDLE_W));
      setRightW(newW);
    }
    function onUp() {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);
  const [layout, setLayout] = useState<Layout>(() =>
    (localStorage.getItem("library-layout") as Layout) || "normal"
  );

  function changeLayout(l: Layout) {
    setLayout(l);
    localStorage.setItem("library-layout", l);
  }

  const query: ItemQuery = useMemo(() => {
    const q: ItemQuery = {};
    const s = sp.get("q"); if (s) q.q = s;
    const t = sp.get("tags"); if (t) q.tags = t.split(",");
    const e = sp.get("exclude_tags"); if (e) q.exclude_tags = e.split(",");
    const op = sp.get("tag_op"); if (op === "OR" || op === "AND") q.tag_op = op;
    const stat = sp.get("status_in"); if (stat) q.status_in = stat.split(",") as ItemStatus[];
    const sort = sp.get("sort") as ItemQuery["sort"] | null;
    if (sort) q.sort = sort;
    const spaceParam = sp.get("space"); if (spaceParam) q.space_id = Number(spaceParam);
    q.limit = 120;
    return q;
  }, [sp]);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["items", query],
    queryFn: () => api.listItems(query),
  });

  // Spaces supply the per-Space status labels shown on cards; resolve the active
  // one from the URL. Unscoped Library => no space => canonical default labels.
  const { data: spaces = [] } = useQuery({
    queryKey: ["spaces"],
    queryFn: api.listSpaces,
    staleTime: 60_000,
  });
  const activeSpace = query.space_id != null ? spaces.find(s => s.id === query.space_id) ?? null : null;

  const toggleWatched = useMutation({
    mutationFn: (it: Item) => api.patchItem(it.id, { status: NEXT_STATUS[it.status] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items"] }),
  });

  // Inline tag edits are "lightweight": skip revision history so quick triage
  // doesn't spam each item's history.
  const editTags = useMutation({
    mutationFn: ({ id, tags }: { id: number; tags: string[] }) =>
      api.patchItem(id, { tags }, { snapshot: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });

  // Grid +1 is triage too: snapshot:false so bumping an episode count doesn't
  // spam history (deliberate edits in the detail view do snapshot).
  const setProgress = useMutation({
    mutationFn: ({ id, progress }: { id: number; progress: number }) =>
      api.patchItem(id, { progress }, { snapshot: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items"] }),
  });

  const gridClass = {
    normal: "grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]",
    big: "grid gap-4 grid-cols-[repeat(auto-fill,minmax(340px,1fr))]",
    detailed: "flex flex-col gap-2",
  }[layout];

  return (
    <div ref={containerRef} className="flex h-full overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="sticky top-0 bg-zinc-950/95 backdrop-blur z-10 px-4 py-2 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center">
            <span className="text-sm text-zinc-400 font-medium">{items.length} item{items.length === 1 ? "" : "s"}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-0.5">
            <LayoutBtn active={layout === "normal"} title="Normal grid" onClick={() => changeLayout("normal")}>
              {/* 3x3 small grid */}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="1" width="4" height="4" rx="0.5"/>
                <rect x="6" y="1" width="4" height="4" rx="0.5"/>
                <rect x="11" y="1" width="4" height="4" rx="0.5"/>
                <rect x="1" y="6" width="4" height="4" rx="0.5"/>
                <rect x="6" y="6" width="4" height="4" rx="0.5"/>
                <rect x="11" y="6" width="4" height="4" rx="0.5"/>
                <rect x="1" y="11" width="4" height="4" rx="0.5"/>
                <rect x="6" y="11" width="4" height="4" rx="0.5"/>
                <rect x="11" y="11" width="4" height="4" rx="0.5"/>
              </svg>
            </LayoutBtn>
            <LayoutBtn active={layout === "big"} title="Big thumbnails" onClick={() => changeLayout("big")}>
              {/* 2x2 large grid */}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="1" width="6.5" height="6.5" rx="0.5"/>
                <rect x="8.5" y="1" width="6.5" height="6.5" rx="0.5"/>
                <rect x="1" y="8.5" width="6.5" height="6.5" rx="0.5"/>
                <rect x="8.5" y="8.5" width="6.5" height="6.5" rx="0.5"/>
              </svg>
            </LayoutBtn>
            <LayoutBtn active={layout === "detailed"} title="Detailed list" onClick={() => changeLayout("detailed")}>
              {/* list rows with thumbnail */}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="1.5" width="3.5" height="3.5" rx="0.5"/>
                <rect x="5.5" y="2" width="9.5" height="1.2" rx="0.6"/>
                <rect x="5.5" y="4" width="6.5" height="1" rx="0.5"/>
                <rect x="1" y="6.5" width="3.5" height="3.5" rx="0.5"/>
                <rect x="5.5" y="7" width="9.5" height="1.2" rx="0.6"/>
                <rect x="5.5" y="9" width="6.5" height="1" rx="0.5"/>
                <rect x="1" y="11.5" width="3.5" height="3.5" rx="0.5"/>
                <rect x="5.5" y="12" width="9.5" height="1.2" rx="0.6"/>
                <rect x="5.5" y="14" width="6.5" height="1" rx="0.5"/>
              </svg>
            </LayoutBtn>
            </div>
            <div className="w-px h-4 bg-zinc-800" />
            <button
              className={`p-1.5 rounded transition-colors ${sidebarOpen ? "text-zinc-100 bg-zinc-800" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"}`}
              onClick={() => setSidebarOpen(o => !o)}
              title="Toggle Filters"
              aria-label="Toggle filters"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M1 3.5h14M4 8h8M6.5 12.5h3"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="p-4">
          {isLoading ? (
            <div className="text-zinc-500">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-zinc-500">Nothing here yet. Click <b>+ Add</b>.</div>
          ) : (
            <div className={gridClass}>
              {items.map(it => (
                <ItemCard
                  key={it.id}
                  item={it}
                  layout={layout}
                  space={activeSpace}
                  onToggleWatched={(it) => toggleWatched.mutate(it)}
                  onEditTags={(it, tags) => editTags.mutate({ id: it.id, tags })}
                  onSetProgress={(it, progress) => setProgress.mutate({ id: it.id, progress })}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {sidebarOpen && (
        <div
          className="hidden md:flex shrink-0 cursor-col-resize items-center justify-center hover:bg-zinc-700/40 active:bg-zinc-600/40 transition-colors"
          style={{ width: HANDLE_W }}
          onPointerDown={(e) => {
            e.preventDefault();
            dragging.current = true;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
        >
          <div className="w-px h-8 bg-zinc-700 rounded-full" />
        </div>
      )}

      <FilterSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} width={rightW} />
    </div>
  );
}
