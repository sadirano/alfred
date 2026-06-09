import { useState, useEffect, useRef } from "react";
import { Link, NavLink, Route, Routes, useSearchParams, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Library from "./pages/Library";
import ItemDetail from "./pages/ItemDetail";
import Trash from "./pages/Trash";
import AddItemDialog from "./components/AddItemDialog";
import SpaceDialog from "./components/SpaceDialog";
import SettingsDialog from "./components/SettingsDialog";
import { api, Space, Template } from "./api/client";
import { getSerializedTags, setSerializedTags } from "./lib/serialized";
import { APP_NAME, STORAGE_PREFIX } from "./config";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `block px-3 py-2 rounded text-sm ${isActive ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"}`;

// The wordmark + a small "demo" pill. This is a browser-only preview, so we tell
// the visitor their data stays local. Shown wherever the app name appears.
function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <span className="font-semibold text-zinc-100">{APP_NAME}</span>
      <span
        className="text-[10px] uppercase tracking-wide text-zinc-500 border border-zinc-700 rounded px-1 py-0.5"
        title="Browser-only preview — your data stays in this browser"
      >
        demo
      </span>
    </span>
  );
}

// Edits the tags that mark content as serialized (gets an episode/chapter
// counter). Persists locally; reloads so every card/detail re-reads the rule.
function CounterTagsDialog({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState(() => getSerializedTags().join(", "));
  function save() {
    setSerializedTags(value.split(","));
    onClose();
    window.location.reload();
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 w-96" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-medium mb-1">Counter tags</h2>
        <p className="text-xs text-zinc-500 mb-3">
          Items carrying any of these tags get an episode/chapter counter. Comma-separated.
        </p>
        <input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }}
          placeholder="source:anime, source:manga"
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm font-mono outline-none focus:border-zinc-500"
        />
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">Cancel</button>
          <button onClick={save} className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500">Save</button>
        </div>
      </div>
    </div>
  );
}

// OverflowMenu removed since desktop sidebar has room for all items

// A space whose name contains a colon (e.g. "Work: Alpha") is collapsed into a
// dropdown menu named by the part before the first colon ("Work"); the part
// after becomes its label inside the menu. Spaces with no colon stay top-level.
type NavEntry =
  | { kind: "space"; space: Space }
  | { kind: "group"; prefix: string; spaces: Space[] };

function buildNavEntries(spaces: Space[]): NavEntry[] {
  const entries: NavEntry[] = [];
  const groupIndex = new Map<string, number>();
  for (const space of spaces) {
    const colon = space.name.indexOf(":");
    if (colon > 0) {
      const prefix = space.name.slice(0, colon).trim();
      const existing = groupIndex.get(prefix);
      if (existing === undefined) {
        groupIndex.set(prefix, entries.length);
        entries.push({ kind: "group", prefix, spaces: [space] });
      } else {
        (entries[existing] as { spaces: Space[] }).spaces.push(space);
      }
    } else {
      entries.push({ kind: "space", space });
    }
  }
  return entries;
}

// Label shown inside a group menu: the part after the first colon, trimmed.
// Falls back to the full name if there's nothing after the colon.
function menuLabel(name: string): string {
  const colon = name.indexOf(":");
  const rest = colon > 0 ? name.slice(colon + 1).trim() : "";
  return rest || name;
}

function SpaceLink({
  space, label, activeSpaceId, onEdit, className,
}: {
  space: Space;
  label: string;
  activeSpaceId: number | null;
  onEdit: (s: Space) => void;
  className?: string;
}) {
  const active = activeSpaceId === space.id;
  return (
    <span className={`group/space relative flex items-center ${className ?? ""}`}>
      <Link
        to={`/?space=${space.id}`}
        className={`flex-1 px-3 py-2 rounded-l text-sm pr-1.5 ${active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"}`}
      >
        {label}
      </Link>
      <button
        onClick={() => onEdit(space)}
        className={`px-3 py-2 rounded-r text-zinc-600 hover:text-zinc-300 opacity-0 group-hover/space:opacity-100 transition-opacity text-xs ${active ? "bg-zinc-800" : "hover:bg-zinc-800"}`}
        title="Edit space"
      >
        ⚙
      </button>
    </span>
  );
}

function SpaceMenu({
  prefix, spaces, activeSpaceId, onEdit,
}: {
  prefix: string;
  spaces: Space[];
  activeSpaceId: number | null;
  onEdit: (s: Space) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeChild = spaces.find(s => s.id === activeSpaceId);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative flex flex-col">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex px-3 py-2 rounded text-sm items-center justify-between ${
          activeChild ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        }`}
        title={`${prefix} spaces`}
      >
        <span>{activeChild ? `${prefix}: ${menuLabel(activeChild.name)}` : prefix}</span>
        <span className="text-[10px] text-zinc-500">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="flex flex-col ml-2 border-l border-zinc-800 pl-1 mt-1">
          {spaces.map(space => (
            <SpaceLink
              key={space.id}
              space={space}
              label={menuLabel(space.name)}
              activeSpaceId={activeSpaceId}
              onEdit={s => { setOpen(false); onEdit(s); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SpaceNavItems({ spaces }: { spaces: Space[] }) {
  const [sp] = useSearchParams();
  const activeSpaceId = sp.get("space") ? Number(sp.get("space")) : null;
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Space | null>(null);

  const update = useMutation({
    mutationFn: ({ id, name, namespaces, tags, labels, templates }: { id: number; name: string; namespaces: string[]; tags: string[]; labels: Record<string, string> | null, templates: Template[] }) =>
      api.updateSpace(id, { name, namespaces, tags, labels, templates }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["spaces"] }); setEditing(null); },
  });

  const del = useMutation({
    mutationFn: (id: number) => api.deleteSpace(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["spaces"] }); setEditing(null); },
  });

  const entries = buildNavEntries(spaces);

  return (
    <>
      {entries.map(entry =>
        entry.kind === "space" ? (
          <SpaceLink
            key={entry.space.id}
            space={entry.space}
            label={entry.space.name}
            activeSpaceId={activeSpaceId}
            onEdit={setEditing}
          />
        ) : (
          <SpaceMenu
            key={`grp:${entry.prefix}`}
            prefix={entry.prefix}
            spaces={entry.spaces}
            activeSpaceId={activeSpaceId}
            onEdit={setEditing}
          />
        )
      )}
      {editing && (
        <SpaceDialog
          space={editing}
          onSave={(name, namespaces, tags, labels, templates) => update.mutate({ id: editing.id, name, namespaces, tags, labels, templates })}
          onDelete={() => del.mutate(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function MobileNav({
  spaces,
  onClose,
  onCreateSpace,
}: {
  spaces: Space[];
  onClose: () => void;
  onCreateSpace: () => void;
}) {
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const activeSpaceId = sp.get("space") ? Number(sp.get("space")) : null;
  const [editing, setEditing] = useState<Space | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [demoSettingsOpen, setDemoSettingsOpen] = useState(false);

  const update = useMutation({
    mutationFn: ({ id, name, namespaces, tags, labels, templates }: { id: number; name: string; namespaces: string[]; tags: string[]; labels: Record<string, string> | null, templates: Template[] }) =>
      api.updateSpace(id, { name, namespaces, tags, labels, templates }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["spaces"] }); setEditing(null); },
  });

  const del = useMutation({
    mutationFn: (id: number) => api.deleteSpace(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["spaces"] }); setEditing(null); },
  });

  const linkClass = (active: boolean) =>
    `block px-3 py-2.5 rounded text-sm ${active ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:text-zinc-100 active:bg-zinc-800"}`;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <nav className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-zinc-900 border-r border-zinc-700 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
          <Wordmark />
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 p-1 -mr-1">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
          <NavLink to="/" end onClick={onClose} className={({ isActive }) => linkClass(isActive)}>
            Library
          </NavLink>
          {spaces.length > 0 && (
            <div className="pt-3 pb-1">
              <div className="text-[10px] uppercase text-zinc-500 tracking-wide px-3 pb-1.5">Spaces</div>
              {spaces.map(space => (
                <div key={space.id} className="flex items-center">
                  <Link
                    to={`/?space=${space.id}`}
                    onClick={onClose}
                    className={`flex-1 px-3 py-2.5 rounded-l text-sm ${activeSpaceId === space.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:text-zinc-100 active:bg-zinc-800"}`}
                  >
                    {space.name}
                  </Link>
                  <button
                    onClick={() => setEditing(space)}
                    className="px-3 py-2.5 rounded-r text-zinc-500 hover:text-zinc-300 text-xs"
                    title="Edit space"
                  >
                    ⚙
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex-shrink-0 p-3 border-t border-zinc-800 space-y-0.5">
          <button
            onClick={() => { onClose(); onCreateSpace(); }}
            className="w-full text-left px-3 py-2.5 rounded text-sm text-zinc-400 hover:text-zinc-100 active:bg-zinc-800"
          >
            + New space
          </button>
          <NavLink to="/trash" onClick={onClose} className={({ isActive }) => linkClass(isActive)}>
            Trash
          </NavLink>
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-full text-left px-3 py-2.5 rounded text-sm text-zinc-400 hover:text-zinc-100 active:bg-zinc-800"
          >
            Counter tags…
          </button>
          <button
            onClick={() => setDemoSettingsOpen(true)}
            className="w-full text-left px-3 py-2.5 rounded text-sm text-zinc-400 hover:text-zinc-100 active:bg-zinc-800"
          >
            Settings…
          </button>
        </div>
      </nav>
      {editing && (
        <SpaceDialog
          space={editing}
          onSave={(name, namespaces, tags, labels, templates) => update.mutate({ id: editing.id, name, namespaces, tags, labels, templates })}
          onDelete={() => del.mutate(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
      {settingsOpen && <CounterTagsDialog onClose={() => setSettingsOpen(false)} />}
      {demoSettingsOpen && <SettingsDialog onClose={() => setDemoSettingsOpen(false)} />}
    </>
  );
}

function SettingsMenu({ canInstall, install, onOpenTags, onOpenSettings, collapsed = false, autoCollapse, onToggleAutoCollapse }: { canInstall: boolean, install: () => void, onOpenTags: () => void, onOpenSettings: () => void, collapsed?: boolean, autoCollapse: boolean, onToggleAutoCollapse: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative mt-auto pt-4 border-t border-zinc-800 flex flex-col">
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center ${collapsed ? "justify-center p-1.5 w-8 h-8 mx-auto" : "gap-2 px-3 py-2"} rounded text-sm ${open ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"}`}
        title="Settings"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
        {!collapsed && "Settings"}
      </button>

      {open && (
        <div className={`absolute bottom-full left-0 mb-1 z-40 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl py-1 flex flex-col ${collapsed ? "min-w-[12rem]" : "w-[calc(100%+2rem)] -ml-4"}`}>
          {canInstall && (
            <button
              onClick={() => { setOpen(false); install(); }}
              className="px-4 py-2 text-sm text-left text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            >
              Install app
            </button>
          )}
          <NavLink
            to="/trash"
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `block px-4 py-2 text-sm text-left ${isActive ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"}`
            }
          >
            Trash
          </NavLink>
          <button
            onClick={() => { setOpen(false); onOpenTags(); }}
            className="px-4 py-2 text-sm text-left text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          >
            Counter tags...
          </button>
          <button
            onClick={() => { setOpen(false); onOpenSettings(); }}
            className="px-4 py-2 text-sm text-left text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          >
            Settings...
          </button>
          <button
            onClick={() => onToggleAutoCollapse()}
            className="px-4 py-2 text-sm text-left text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 flex justify-between items-center"
          >
            Auto-collapse
            <div className={`w-7 h-4 rounded-full relative transition-colors ${autoCollapse ? "bg-blue-600" : "bg-zinc-700"}`}>
              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${autoCollapse ? "left-[14px]" : "left-[2px]"}`} />
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

const DEFAULT_LEFT_W = 256;
const MIN_SIDE_W = 180;
const HANDLE_W = 6;

// Captures the browser's beforeinstallprompt so we can trigger it from a button.
function useInstallPrompt() {
  const [prompt, setPrompt] = useState<Event & { prompt(): Promise<void> } | null>(null);
  const [installed, setInstalled] = useState(
    () => window.matchMedia("(display-mode: standalone)").matches
  );
  useEffect(() => {
    function onPrompt(e: Event) { e.preventDefault(); setPrompt(e as Event & { prompt(): Promise<void> }); }
    function onInstalled() { setInstalled(true); setPrompt(null); }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    setPrompt(null);
  }
  return { canInstall: !!prompt && !installed, install, installed };
}

export default function App() {
  const [adding, setAdding] = useState(false);
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [demoSettingsOpen, setDemoSettingsOpen] = useState(false);
  const { canInstall, install } = useInstallPrompt();
  const qc = useQueryClient();

  const [desktopNavOpen, setDesktopNavOpen] = useState(() => {
    return localStorage.getItem(`${STORAGE_PREFIX}:desktopNavOpen`) !== "false";
  });
  const [leftW, setLeftW] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}:leftW`);
    return saved ? Number(saved) : DEFAULT_LEFT_W;
  });
  const [autoCollapse, setAutoCollapse] = useState(() => {
    return localStorage.getItem(`${STORAGE_PREFIX}:autoCollapse`) === "true";
  });
  const dragging = useRef<boolean>(false);

  useEffect(() => { localStorage.setItem(`${STORAGE_PREFIX}:desktopNavOpen`, String(desktopNavOpen)); }, [desktopNavOpen]);
  useEffect(() => { localStorage.setItem(`${STORAGE_PREFIX}:leftW`, String(leftW)); }, [leftW]);
  useEffect(() => { localStorage.setItem(`${STORAGE_PREFIX}:autoCollapse`, String(autoCollapse)); }, [autoCollapse]);

  const location = useLocation();
  useEffect(() => {
    if (autoCollapse && location.pathname.startsWith("/items/")) {
      setDesktopNavOpen(false);
    }
  }, [location.pathname, autoCollapse]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging.current) return;
      const newW = Math.max(MIN_SIDE_W, Math.min(e.clientX, window.innerWidth - MIN_SIDE_W));
      setLeftW(newW);
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

  const { data: spaces = [] } = useQuery({
    queryKey: ["spaces"],
    queryFn: api.listSpaces,
    staleTime: 60_000,
  });

  const createSpace = useMutation({
    mutationFn: ({ name, namespaces, tags, labels }: { name: string; namespaces: string[]; tags: string[]; labels: Record<string, string> | null }) =>
      api.createSpace(name, namespaces, tags, labels),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["spaces"] }); setCreatingSpace(false); },
  });

  const [searchParams] = useSearchParams();
  let activeSpaceId = Number(searchParams.get("space")) || null;
  if (!activeSpaceId && location.state) {
    const from = (location.state as { from?: string }).from;
    if (from) {
      activeSpaceId = Number(new URLSearchParams(from).get("space")) || null;
    }
  }
  const activeSpace = activeSpaceId ? spaces.find(s => s.id === activeSpaceId) : undefined;

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-zinc-950">
      <header className="md:hidden border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        <button
          className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
        >
          <svg width="20" height="20" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 4.5h14M2 9h14M2 13.5h14"/>
          </svg>
        </button>
        <Wordmark className="text-lg" />
        <div className="flex gap-2 ml-auto items-center">
          {canInstall && (
            <button
              onClick={install}
              className="px-3 py-1.5 rounded border border-zinc-600 text-zinc-300 hover:text-zinc-100 hover:border-zinc-400 text-sm"
              title={`Install ${APP_NAME} as an app`}
            >
              Install
            </button>
          )}
          <button
            onClick={() => setAdding(true)}
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-sm font-medium"
          >
            + Add
          </button>
        </div>
      </header>

      {!desktopNavOpen && (
        <aside className="hidden md:flex flex-col w-[64px] shrink-0 border-r border-zinc-800 bg-zinc-950 p-4">
          <div className="flex flex-col gap-4">
            <button
              onClick={() => setDesktopNavOpen(true)}
              className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 w-8 h-8 flex items-center justify-center -ml-1.5"
              title="Open menu"
            >
              <svg width="20" height="20" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 4.5h14M2 9h14M2 13.5h14"/>
              </svg>
            </button>

            <button
              onClick={() => setAdding(true)}
              className="p-1.5 rounded bg-blue-600 hover:bg-blue-500 text-zinc-100 shadow w-8 h-8 flex items-center justify-center -ml-1.5"
              title="Add item"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>

          <SettingsMenu
            canInstall={canInstall}
            install={install}
            onOpenTags={() => setSettingsOpen(true)}
            onOpenSettings={() => setDemoSettingsOpen(true)}
            collapsed={true}
            autoCollapse={autoCollapse}
            onToggleAutoCollapse={() => setAutoCollapse(!autoCollapse)}
          />
        </aside>
      )}

      {desktopNavOpen && (
        <>
          <aside style={{ width: leftW }} className="hidden md:flex shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setDesktopNavOpen(false)}
                  className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 w-8 h-8 flex items-center justify-center -ml-1.5"
                  title="Close menu"
                >
                  <svg width="20" height="20" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M2 4.5h14M2 9h14M2 13.5h14"/>
                  </svg>
                </button>
                <Wordmark className="text-xl tracking-wide" />
              </div>
              <button
                onClick={() => setAdding(true)}
                className="px-2 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-sm font-medium shadow"
                title="Add item"
              >
                + Add
              </button>
            </div>

        <nav className="flex flex-col gap-1 flex-1 overflow-y-auto">
          <NavLink to="/" end className={navClass}>Library</NavLink>
          
          <div className="mt-6 mb-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider px-3">
            Spaces
          </div>
          <SpaceNavItems spaces={spaces} />
          <button
            onClick={() => setCreatingSpace(true)}
            className="text-left px-3 py-2 rounded text-sm text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors mt-2"
          >
            + New space
          </button>
        </nav>

        <SettingsMenu
          canInstall={canInstall}
          install={install}
          onOpenTags={() => setSettingsOpen(true)}
          onOpenSettings={() => setDemoSettingsOpen(true)}
          autoCollapse={autoCollapse}
          onToggleAutoCollapse={() => setAutoCollapse(!autoCollapse)}
        />
      </aside>

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
      </>
      )}

      <main className="flex-1 min-w-0 flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/items/:id" element={<ItemDetail />} />
          <Route path="/trash" element={<Trash />} />
        </Routes>
      </main>
      {mobileNavOpen && (
        <MobileNav
          spaces={spaces}
          onClose={() => setMobileNavOpen(false)}
          onCreateSpace={() => { setMobileNavOpen(false); setCreatingSpace(true); }}
        />
      )}
      {adding && <AddItemDialog activeSpace={activeSpace} onClose={() => setAdding(false)} />}
      {creatingSpace && (
        <SpaceDialog
          onSave={(name, namespaces, tags, labels, templates) => createSpace.mutate({ name, namespaces, tags, labels })}
          onClose={() => setCreatingSpace(false)}
        />
      )}
      {settingsOpen && <CounterTagsDialog onClose={() => setSettingsOpen(false)} />}
      {demoSettingsOpen && <SettingsDialog onClose={() => setDemoSettingsOpen(false)} />}
    </div>
  );
}
