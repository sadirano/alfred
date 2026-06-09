import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, fmtDuration, Item, itemLink, Space } from "../api/client";
import { isSerialized } from "../lib/serialized";
import { STATUS_BADGE, STATUS_ICON, statusLabel } from "../lib/status";
import TagInput, { renderTagName } from "./TagInput";

export type Layout = "normal" | "big" | "detailed";

interface Props {
  item: Item;
  layout?: Layout;
  // The active Space (if any) supplies custom status labels. Deletion is
  // deliberately not a card action — it lives on the detail page only.
  space?: Space | null;
  onToggleWatched?: (item: Item) => void;
  onEditTags?: (item: Item, tags: string[]) => void;
  onSetProgress?: (item: Item, progress: number) => void;
}

// "Finished" is derived, never stored: a bounded series whose progress caught up.
const isFinished = (i: Item) => i.total != null && i.progress >= i.total;

// Rendered only for serialized items (decided by tags, see isSerialized). An
// ongoing series with no known total reads "40 / ?"; bounded ones get a bar.
function ProgressBadge({ item }: { item: Item }) {
  const finished = isFinished(item);
  const label = item.total != null ? `${item.progress} / ${item.total}` : `${item.progress} / ?`;
  const pct = item.total ? Math.min(100, Math.round((item.progress / item.total) * 100)) : 0;
  return (
    <div className="mt-1">
      <div className={`text-xs ${finished ? "text-emerald-400" : "text-zinc-300"}`}>
        {finished ? "✓ " : ""}{label}
      </div>
      {item.total != null && (
        <div className="mt-0.5 h-1 rounded bg-zinc-800 overflow-hidden">
          <div
            className={`h-full ${finished ? "bg-emerald-500" : "bg-blue-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Popover for editing an item's tags inline from the grid. Keeps edits local
 *  and commits once (on Done or click-outside) so we don't spam PATCH calls. */
function TagEditorPopover({ item, onSave, onClose, className }: {
  item: Item;
  onSave: (tags: string[]) => void;
  onClose: () => void;
  className?: string;
}) {
  const [tags, setTags] = useState<string[]>(() => item.tags.map(t => t.name));
  const ref = useRef<HTMLDivElement>(null);

  function commit() {
    const orig = JSON.stringify(item.tags.map(t => t.name).sort());
    const next = JSON.stringify([...tags].sort());
    if (orig !== next) onSave(tags);
    onClose();
  }

  // Save & close on outside click. Re-bound on every `tags` change so the
  // handler closes over the latest selection.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) commit();
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  });

  return (
    <div
      ref={ref}
      className={`absolute z-30 w-72 max-w-[calc(100vw-1rem)] bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-2 ${className ?? ""}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-zinc-400">Edit tags</span>
        <button type="button" onClick={commit} className="text-xs px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white">
          Done
        </button>
      </div>
      <TagInput value={tags} onChange={setTags} />
    </div>
  );
}

export default function ItemCard({ item, layout = "normal", space, onToggleWatched, onEditTags, onSetProgress }: Props) {
  const [editingTags, setEditingTags] = useState(false);
  const location = useLocation();
  const link = itemLink(item);
  // A counter only makes sense for serialized content (anime/manga …), decided
  // by the item's tags. Plain videos/notes show no badge and no +1.
  const serialized = isSerialized(item.tags.map(t => t.name));

  function btnBase(variant: "overlay" | "panel") {
    const bg = variant === "overlay" ? "bg-black/80" : "bg-zinc-800";
    return `text-sm w-8 h-8 flex items-center justify-center rounded ${bg}`;
  }

  // Always-visible "open the resource" button — the whole point is reaching the
  // destination with zero friction, so it never hides behind hover. The click is
  // also what we count as an access (usage metrics); fire-and-forget.
  function OpenLink({ variant }: { variant: "overlay" | "panel" }) {
    if (!link) return null;
    return (
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        onClick={() => { api.pingAccess(item.id).catch(() => {}); }}
        className={`${btnBase(variant)} hover:bg-blue-700 text-center`}
        title="Open link"
      >
        ↗
      </a>
    );
  }

  // Secondary, hover-only cluster. Destructive actions are intentionally absent
  // (delete lives on the detail page).
  function ActionButtons({ variant }: { variant: "overlay" | "panel" }) {
    const base = btnBase(variant);
    return (
      <>
        {onEditTags && (
          <button
            type="button"
            // Open-only + stopPropagation so the popover's click-outside handler
            // doesn't fight this button (toggling would close-then-reopen). Close
            // via Done or by clicking elsewhere — both save.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setEditingTags(true)}
            className={`${base} ${editingTags ? "bg-blue-700" : "hover:bg-blue-700"}`}
            title="Edit tags"
          >
            🏷
          </button>
        )}
        {onToggleWatched && item.kind !== "note" && (
          <button
            type="button"
            onClick={() => onToggleWatched(item)}
            className={`${base} hover:bg-emerald-700`}
            title="Advance status"
          >
            {STATUS_ICON[item.status] ?? "✓"}
          </button>
        )}
        {onSetProgress && serialized && (
          <button
            type="button"
            disabled={isFinished(item)}
            // Stop at total: once finished the cap makes +1 a no-op, shown disabled.
            onClick={() => {
              const next = item.total != null
                ? Math.min(item.progress + 1, item.total)
                : item.progress + 1;
              if (next !== item.progress) onSetProgress(item, next);
            }}
            className={`${base} ${isFinished(item) ? "opacity-40 cursor-not-allowed" : "hover:bg-blue-700"}`}
            title={isFinished(item) ? "Complete" : "Add one (episode / chapter)"}
          >
            +
          </button>
        )}
      </>
    );
  }

  const tagEditor = editingTags && onEditTags && (
    <TagEditorPopover
      item={item}
      onSave={(tags) => onEditTags(item, tags)}
      onClose={() => setEditingTags(false)}
      className="top-full right-1 mt-1"
    />
  );

  if (layout === "detailed") {
    return (
      <div className="group relative">
        <div className="bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-600 transition flex">
          <Link to={`/items/${item.id}`} state={{ from: location.search }} className="flex flex-1 min-w-0">
            <div className="relative w-44 flex-shrink-0 bg-zinc-800 self-stretch">
              {item.thumbnail_url ? (
                <img src={item.thumbnail_url} alt="" loading="lazy" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs uppercase min-h-[6rem]">
                  {item.kind}
                </div>
              )}
              {item.duration_sec ? (
                <span className="absolute bottom-1 right-1 px-1.5 py-0.5 text-xs bg-black/80 rounded">
                  {fmtDuration(item.duration_sec)}
                </span>
              ) : null}
            </div>
            <div className="flex-1 min-w-0 p-3 flex flex-col gap-1.5">
              <div className="flex items-start gap-2 flex-wrap">
                {item.kind !== "note" && (
                  <span className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] uppercase rounded ${STATUS_BADGE[item.status]}`}>
                    {statusLabel(item.status, space)}
                  </span>
                )}
                <span className="text-sm font-medium line-clamp-2 group-hover:text-white">{item.title || "(untitled)"}</span>
              </div>
              {item.channel && <div className="text-xs text-zinc-400 line-clamp-1">{item.channel}</div>}
              {item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {item.tags.map(t => (
                    <span key={t.id} className="text-[10px] bg-zinc-800 text-zinc-300 rounded px-1.5 py-0.5">{renderTagName(t.name)}</span>
                  ))}
                </div>
              )}
              {serialized && <ProgressBadge item={item} />}
            </div>
          </Link>
          <div className="flex-shrink-0 px-2 flex flex-col gap-1 justify-center">
            <OpenLink variant="panel" />
            <div className="flex flex-col gap-1 transition md:opacity-0 md:group-hover:opacity-100">
              <ActionButtons variant="panel" />
            </div>
          </div>
        </div>
        {tagEditor}
      </div>
    );
  }

  const tags = item.tags.slice(0, 3);
  const more = item.tags.length - tags.length;

  return (
    <div className="group relative">
      <div className="bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-600 transition">
        <Link to={`/items/${item.id}`} state={{ from: location.search }} className="block">
          <div className="relative aspect-video bg-zinc-800">
            {item.thumbnail_url ? (
              <img src={item.thumbnail_url} alt="" loading="lazy" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs uppercase">
                {item.kind}
              </div>
            )}
            {item.duration_sec ? (
              <span className="absolute bottom-1 right-1 px-1.5 py-0.5 text-xs bg-black/80 rounded">
                {fmtDuration(item.duration_sec)}
              </span>
            ) : null}
            {item.kind !== "note" && (
              <span className={`absolute top-1 left-1 px-1.5 py-0.5 text-[10px] uppercase rounded ${STATUS_BADGE[item.status]}`}>
                {statusLabel(item.status, space)}
              </span>
            )}
            <div className="absolute bottom-1 left-1 flex flex-wrap gap-1 max-w-[80%]">
              {tags.map(t => (
                <span key={t.id} className="text-[10px] bg-black/70 text-zinc-100 rounded px-1.5 py-0.5">{renderTagName(t.name)}</span>
              ))}
              {more > 0 && <span className="text-[10px] bg-black/70 text-zinc-300 rounded px-1.5 py-0.5">+{more}</span>}
            </div>
          </div>
          <div className="p-2">
            <div className="text-sm font-medium line-clamp-2 group-hover:text-white">{item.title || "(untitled)"}</div>
            {item.channel && <div className="text-xs text-zinc-400 mt-1 line-clamp-1">{item.channel}</div>}
            {serialized && <ProgressBadge item={item} />}
          </div>
        </Link>
      </div>
      <div className="absolute top-1 right-1 flex flex-col gap-1 items-end">
        <OpenLink variant="overlay" />
        <div className="flex flex-col gap-1 items-end md:hidden md:group-hover:flex">
          <ActionButtons variant="overlay" />
        </div>
      </div>
      {tagEditor}
    </div>
  );
}
