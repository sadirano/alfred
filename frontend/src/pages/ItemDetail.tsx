import { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import MarkdownRenderer from "../components/MarkdownRenderer";
import { api, ItemStatus, Revision, Space, Template, itemLink } from "../api/client";
import { isSerialized } from "../lib/serialized";
import { DEFAULT_LABELS, STATUSES } from "../lib/status";
import TagInput from "../components/TagInput";
import AiInput from "../components/AiInput";
import FullVersionBadge from "../components/FullVersionBadge";
import { BACKEND_AVAILABLE } from "../lib/demo";
import { STORAGE_PREFIX } from "../config";

const DEFAULT_LEFT_W = 280;
const DEFAULT_RIGHT_W = 300;
const MIN_SIDE_W = 180;
const HANDLE_W = 6;

export default function ItemDetail() {
  const { id } = useParams();
  const itemId = Number(id);
  const qc = useQueryClient();
  const nav = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const fromSpaceId = from ? Number(new URLSearchParams(from).get("space")) || null : null;

  const { data: spaces = [] } = useQuery<Space[]>({
    queryKey: ["spaces"],
    queryFn: api.listSpaces,
    staleTime: 60_000,
  });
  const [tags, setTags] = useState<string[]>([]);
  const activeSpace = useMemo(() => {
    if (fromSpaceId != null) {
      const s = spaces.find(s => s.id === fromSpaceId);
      if (s) return s;
    }
    // Infer from tags
    if (tags.length > 0) {
      for (const space of spaces) {
        if (tags.some(t => space.namespaces.some(ns => t.startsWith(ns + ":")))) {
          return space;
        }
      }
    }
    if (spaces.length === 1) return spaces[0];
    return null;
  }, [fromSpaceId, spaces, tags]);

  const { data: item, isLoading } = useQuery({
    queryKey: ["item", itemId],
    queryFn: () => api.getItem(itemId),
    enabled: !!itemId,
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api.listTags(),
    staleTime: 30_000,
  });

  const updateSpace = useMutation({
    mutationFn: (data: { id: number, templates: Template[] }) => api.updateSpace(data.id, { templates: data.templates }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["spaces"] });
    }
  });

  const [savingTemplate, setSavingTemplate] = useState(false);

  async function saveAsTemplate() {
    if (!activeSpace || savingTemplate) return;
    setSavingTemplate(true);
    let name = `Template ${activeSpace.templates.length + 1}`;
    try {
      const prompt = `Based on the following template content, suggest a short, 1-3 word name for this template. Reply ONLY with the suggested name, no quotes or extra text.\n\nContent: ${notes.slice(0, 1000)}`;
      const res = await api.askAI(prompt);
      if (res.response && res.response.trim()) {
        name = res.response.trim().replace(/^"|"$/g, "");
      }
    } catch (e) {
      // ignore, fallback to base name
    } finally {
      const newTemplate: Template = { id: crypto.randomUUID(), name, content: notes };
      updateSpace.mutate({ id: activeSpace.id, templates: [...activeSpace.templates, newTemplate] });
      setSavingTemplate(false);
    }
  }

  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<ItemStatus>("plan");
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [preview, setPreview] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [notesFontSize, setNotesFontSize] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}:notesFontSize`);
    return saved ? Number(saved) : 14;
  });

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}:notesFontSize`, String(notesFontSize));
  }, [notesFontSize]);

  // Resizable column widths.
  const [leftW, setLeftW] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}:defaultLeftW`);
    return saved ? Number(saved) : DEFAULT_LEFT_W;
  });
  const [rightW, setRightW] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}:defaultRightW`);
    return saved ? Number(saved) : DEFAULT_RIGHT_W;
  });
  const dragging = useRef<"left" | "right" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Pointer-based drag for resize handles.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (dragging.current === "left") {
        const newW = Math.max(MIN_SIDE_W, Math.min(e.clientX - rect.left, rect.width - rightW - MIN_SIDE_W - HANDLE_W * 2));
        setLeftW(newW);
      } else {
        const newW = Math.max(MIN_SIDE_W, Math.min(rect.right - e.clientX, rect.width - leftW - MIN_SIDE_W - HANDLE_W * 2));
        setRightW(newW);
      }
    }
    function onUp() {
      // Persist only on drag end — the effect re-runs on every width change, so
      // leftW/rightW here are current. Avoids a localStorage write per pointermove.
      if (dragging.current === "left") {
        localStorage.setItem(`${STORAGE_PREFIX}:defaultLeftW`, String(leftW));
      } else if (dragging.current === "right") {
        localStorage.setItem(`${STORAGE_PREFIX}:defaultRightW`, String(rightW));
      }
      dragging.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [leftW, rightW]);
  const ready = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const notesFileRef = useRef<HTMLInputElement>(null);
  const thumbFileRef = useRef<HTMLInputElement>(null);
  const attachFileRef = useRef<HTMLInputElement>(null);
  const notesCursor = useRef(0);

  const [thumbEdit, setThumbEdit] = useState(false);
  const [thumbInput, setThumbInput] = useState("");

  const [sourceEdit, setSourceEdit] = useState(false);
  const [sourceInput, setSourceInput] = useState("");

  // AI suggestions held for review before they touch the saved item.
  const [pendingTags, setPendingTags] = useState<string[]>([]);
  const [pendingNotes, setPendingNotes] = useState<string | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>([]);

  useEffect(() => {
    if (!item) return;
    ready.current = false;
    setNotes(item.notes_md);
    setTitle(item.title);
    setTags(item.tags.map(t => t.name));
    setStatus(item.status);
    setProgress(item.progress);
    setTotal(item.total);
    setPendingTags([]);
    setPendingNotes(null);
    setSourceEdit(false);
    const t = setTimeout(() => { ready.current = true; }, 0);
    return () => clearTimeout(t);
  }, [item?.id]);

  // Ctrl+E toggles edit/preview for the notes panel.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === "e" && !e.shiftKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        setPreview(p => !p);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const save = useMutation({
    mutationFn: (data: { title: string; notes_md: string; tags: string[]; status: ItemStatus; progress: number; total: number | null }) =>
      api.patchItem(itemId, data),
    onMutate: () => setSaveStatus("saving"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["item", itemId] });
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
  });

  useEffect(() => {
    if (!ready.current) return;
    const t = setTimeout(() => {
      save.mutate({
        title, notes_md: notes, tags, status, progress, total
      });
    }, 800);
    return () => clearTimeout(t);
  }, [title, notes, tags, status, progress, total]);

  const del = useMutation({
    mutationFn: () => api.deleteItem(itemId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["items"] }); nav("/"); },
  });

  const restore = useMutation({
    mutationFn: (revId: number) => api.restoreRevision(itemId, revId),
    onSuccess: (updated) => {
      ready.current = false;
      setTitle(updated.title);
      setNotes(updated.notes_md);
      setTags(updated.tags.map(t => t.name));
      setStatus(updated.status);
      setProgress(updated.progress);
      setTotal(updated.total);
      setTimeout(() => { ready.current = true; }, 0);
      qc.invalidateQueries({ queryKey: ["item", itemId] });
      qc.invalidateQueries({ queryKey: ["items"] });
      setHistoryOpen(false);
    },
  });

  // An explicit open-the-resource click counts as one access (usage metrics).
  // Fire-and-forget, then refresh the item so the displayed count stays current.
  function pingAccess() {
    api.pingAccess(itemId)
      .then(() => qc.invalidateQueries({ queryKey: ["item", itemId] }))
      .catch(() => { });
  }

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  async function openHistory() {
    setMenuOpen(false);
    const revs = await api.listRevisions(itemId);
    setRevisions(revs);
    setHistoryOpen(true);
  }

  function fmtTime(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  const refresh = useMutation({
    mutationFn: () => api.refreshItem(itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["item", itemId] }),
  });

  const patchThumb = useMutation({
    mutationFn: (url: string) => api.patchItem(itemId, { thumbnail_url: url || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["item", itemId] });
      qc.invalidateQueries({ queryKey: ["items"] });
      setThumbEdit(false);
    },
  });

  const patchSource = useMutation({
    mutationFn: (data: { url?: string | null; file_path?: string | null }) => api.patchItem(itemId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["item", itemId] });
      qc.invalidateQueries({ queryKey: ["items"] });
      setSourceEdit(false);
    },
  });

  // Apply a reviewed AI tag suggestion; the pending list never auto-saves.
  function acceptPendingTag(t: string) {
    setTags(prev => (prev.includes(t) ? prev : [...prev, t]));
    setPendingTags(prev => prev.filter(x => x !== t));
  }
  function acceptAllPendingTags() {
    setTags(prev => Array.from(new Set([...prev, ...pendingTags])));
    setPendingTags([]);
  }

  const { data: attachments = [], refetch: refetchAttachments } = useQuery({
    queryKey: ["attachments", itemId],
    queryFn: () => api.listAttachments(itemId),
    enabled: !!itemId,
  });

  const uploadAttachment = useMutation({
    mutationFn: (file: File) => api.uploadAttachment(itemId, file),
    onSuccess: () => refetchAttachments(),
  });

  const deleteAttachment = useMutation({
    mutationFn: (name: string) => api.deleteAttachment(itemId, name),
    onSuccess: () => refetchAttachments(),
  });

  function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function uploadImage(file: File): Promise<string> {
    const { url } = await api.uploadItemFile(itemId, file);
    return url;
  }

  async function handleThumbPaste(e: React.ClipboardEvent) {
    if (!BACKEND_AVAILABLE) return; // image upload needs the backend; let URL paste work
    const file = Array.from(e.clipboardData.items)
      .find(it => it.kind === "file" && it.type.startsWith("image/"))
      ?.getAsFile();
    if (!file) return;
    e.preventDefault();
    const url = await uploadImage(file);
    setThumbInput(url);
  }

  async function handleNotesPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!BACKEND_AVAILABLE) return; // image upload needs the backend; let text paste work
    const file = Array.from(e.clipboardData.items)
      .find(it => it.kind === "file" && it.type.startsWith("image/"))
      ?.getAsFile();
    if (!file) return;
    e.preventDefault();
    const start = e.currentTarget.selectionStart;
    const end = e.currentTarget.selectionEnd;
    const url = await uploadImage(file);
    setNotes(prev => `${prev.slice(0, start)}![](${url})${prev.slice(end)}`);
  }

  async function handleNotesFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const pos = notesCursor.current;
    const url = await uploadImage(file);
    setNotes(prev => `${prev.slice(0, pos)}![](${url})${prev.slice(pos)}`);
  }

  async function handleThumbFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const url = await uploadImage(file);
    setThumbInput(url);
  }

  if (isLoading || !item) return <div className="p-6 text-zinc-500">Loading...</div>;

  const media = (
    <div className="w-full h-full bg-zinc-900 rounded overflow-hidden flex items-center justify-center relative group/thumb">
      {thumbEdit ? (
        <div className="absolute inset-0 bg-zinc-900/95 flex flex-col overflow-y-auto p-4 z-10">
          <div className="m-auto flex flex-col items-center gap-3 w-full">
            {thumbInput && (
              <img src={thumbInput} alt="preview" className="w-full max-h-32 object-contain rounded shrink-0" onError={e => (e.currentTarget.style.display = "none")} />
            )}
            <input
              autoFocus
              value={thumbInput}
              onChange={e => setThumbInput(e.target.value)}
              onPaste={handleThumbPaste}
              onKeyDown={e => {
                if (e.key === "Enter") patchThumb.mutate(thumbInput.trim());
                if (e.key === "Escape") setThumbEdit(false);
              }}
              placeholder="Paste image or URL…"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-zinc-500 shrink-0"
            />
            <div className="flex items-center gap-2 shrink-0">
              {BACKEND_AVAILABLE ? (
                <>
                  <button
                    type="button"
                    onClick={() => thumbFileRef.current?.click()}
                    className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-2 py-1"
                  >
                    Choose file…
                  </button>
                  <input ref={thumbFileRef} type="file" accept="image/*" className="hidden" onChange={handleThumbFileSelect} />
                </>
              ) : (
                <FullVersionBadge note="Uploading an image file needs the backend. Pasting an image URL works here." />
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => patchThumb.mutate(thumbInput.trim())}
                disabled={patchThumb.isPending}
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded disabled:opacity-50"
              >
                {patchThumb.isPending ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setThumbEdit(false)} className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 rounded">
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {item.kind === "youtube" && item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer" onClick={pingAccess} className="relative w-full h-full block group">
              {item.thumbnail_url
                ? <img src={item.thumbnail_url} alt={item.title} className="w-full h-full object-contain" />
                : <div className="w-full h-full bg-zinc-800" />
              }
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-white text-sm font-medium">Watch on YouTube</span>
              </div>
            </a>
          ) : item.kind === "file" && item.file_path ? (
            <video src={`file:///${item.file_path}`} controls className="w-full h-full" />
          ) : item.thumbnail_url ? (
            <img src={item.thumbnail_url} alt={item.title} className="w-full h-full object-contain" />
          ) : item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer" onClick={pingAccess} className="text-blue-400 underline">Open source</a>
          ) : (
            <span className="text-zinc-500 text-sm">No preview</span>
          )}
          <button
            onClick={() => { setThumbInput(item.thumbnail_url || ""); setThumbEdit(true); }}
            className="absolute bottom-2 right-2 px-2 py-1 text-xs bg-black/70 hover:bg-black/90 rounded md:opacity-0 md:group-hover/thumb:opacity-100 transition-opacity z-10"
          >
            Change image
          </button>
          {itemLink(item) && (
            <a
              href={itemLink(item)!}
              target="_blank"
              rel="noreferrer"
              onClick={pingAccess}
              className="absolute top-2 right-2 text-sm w-8 h-8 flex items-center justify-center rounded bg-black/80 hover:bg-blue-700 text-center z-10 md:opacity-0 md:group-hover/thumb:opacity-100 transition-opacity"
              title="Open link"
            >
              ↗
            </a>
          )}
        </>
      )}
    </div>
  );

  const hasMeta = !!item.channel || !!item.published_at || item.access_count > 0;
  const meta = hasMeta ? (
    <div className="flex items-center gap-2 text-xs text-zinc-400">
      {item.channel && <span>{item.channel}</span>}
      {item.published_at && <span>- {item.published_at}</span>}
      {item.access_count > 0 && (
        <span title={item.last_accessed_at ? `last opened ${fmtTime(item.last_accessed_at)}` : undefined}>
          opened {item.access_count}×{item.last_accessed_at ? ` · ${fmtTime(item.last_accessed_at)}` : ""}
        </span>
      )}
    </div>
  ) : null;

  const notesHeader = (
    <div className="flex items-start gap-3 mb-2 group">
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        className="flex-1 bg-transparent text-2xl font-semibold outline-none border-b border-transparent focus:border-zinc-700 min-w-0"
        placeholder="Title"
      />
      <div className="flex items-center gap-1 shrink-0 pt-1">
        {!preview && BACKEND_AVAILABLE && (
          <>
            <button
              type="button"
              onClick={() => notesFileRef.current?.click()}
              className="text-xs text-zinc-500 hover:text-zinc-100 px-1"
              title="Insert image"
            >
              img
            </button>
            <input ref={notesFileRef} type="file" accept="image/*" className="hidden" onChange={handleNotesFileSelect} />
          </>
        )}
        {activeSpace && (
          <button disabled={savingTemplate} onClick={saveAsTemplate} className={`text-xs text-zinc-500 px-1 mr-1 ${savingTemplate ? "opacity-50" : "hover:text-zinc-100"}`} title="Save as Space Template">
            {savingTemplate ? "saving..." : "save tmpl"}
          </button>
        )}
        <button onClick={() => setNotesFontSize(s => Math.max(10, s - 1))} className="text-xs font-semibold text-zinc-500 hover:text-zinc-100 px-1" title="Decrease font size">
          A-
        </button>
        <button onClick={() => setNotesFontSize(s => Math.min(32, s + 1))} className="text-xs font-semibold text-zinc-500 hover:text-zinc-100 px-1 mr-1" title="Increase font size">
          A+
        </button>
        <button onClick={() => setPreview(p => !p)} className="text-zinc-400 hover:text-zinc-100 p-1" title={preview ? "edit notes (Ctrl+E)" : "preview notes (Ctrl+E)"}>
          {preview ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          )}
        </button>
      </div>
    </div>
  );

  const templatesContext = spaces
    .flatMap(s => [
      ...(s.note_template_md ? [`Template "Default" (from Space "${s.name}"):\n${s.note_template_md}`] : []),
      ...(s.templates || []).map(t => `Template "${t.name}" (from Space "${s.name}"):\n${t.content}`)
    ])
    .join("\n\n");

  const itemContext = [
    `Item title: ${title}`,
    `URL: ${item?.url || "N/A"}`,
    `Channel/Author: ${item?.channel || "N/A"}`,
    `Published: ${item?.published_at || "N/A"}`,
    `Current tags: ${tags.join(", ") || "None"}`,
    `Description: ${item?.description || "N/A"}`
  ].join("\n");

  const notesAiContext = `${itemContext}\nCurrent notes: ${notes}\n${templatesContext ? `Available Note Templates:\n${templatesContext}\n\n` : ""}Rewrite or append to the notes based on the user request. If the user asks to use a specific template (e.g., 'Anime template'), or if it naturally fits one of the Available Note Templates, YOU MUST strictly format your response to match it, extracting and filling in the relevant fields from the provided context (tags, description, URL, etc.). Respond ONLY with the new full notes markdown.`;

  // Used in fixed-height desktop layouts where the notes fill remaining space.
  const notesPanelFill = (
    <div className="flex-1 min-h-0 flex flex-col">
      {notesHeader}
      {preview ? (
        <div className="flex-1 overflow-auto bg-zinc-900 rounded p-3 border border-zinc-800" style={{ fontSize: `${notesFontSize}px` }}>
          <MarkdownRenderer>{notes || "_no notes_"}</MarkdownRenderer>
        </div>
      ) : (
        <textarea
          autoFocus
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onPaste={handleNotesPaste}
          onSelect={e => { notesCursor.current = e.currentTarget.selectionStart; }}
          onKeyUp={e => { notesCursor.current = e.currentTarget.selectionStart; }}
          className="flex-1 resize-none bg-zinc-900 rounded p-3 border border-zinc-800 font-mono"
          style={{ fontSize: `${notesFontSize}px` }}
          placeholder="What did you think? Key takeaways. Timestamps. Anything searchable."
        />
      )}
      <div className="px-4 pb-4 mt-2">
        <AiInput 
          placeholder="Ask AI to write notes... (type @ for template)" 
          context={notesAiContext}
          templates={activeSpace?.templates}
          onResponse={res => setPendingNotes(res)} 
        />
      </div>
    </div>
  );
  // Used in scrollable layouts (mobile + desktop split right column).
  const notesPanel = (
    <div className="flex flex-col">
      {notesHeader}
      {preview ? (
        <div className="bg-zinc-900 rounded p-3 border border-zinc-800 min-h-[8rem]" style={{ fontSize: `${notesFontSize}px` }}>
          <MarkdownRenderer>{notes || "_no notes_"}</MarkdownRenderer>
        </div>
      ) : (
        <textarea
          autoFocus
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onPaste={handleNotesPaste}
          onSelect={e => { notesCursor.current = e.currentTarget.selectionStart; }}
          onKeyUp={e => { notesCursor.current = e.currentTarget.selectionStart; }}
          className="w-full resize-none bg-zinc-900 rounded p-3 border border-zinc-800 font-mono min-h-[12rem]"
          style={{ fontSize: `${notesFontSize}px` }}
          placeholder="What did you think? Key takeaways. Timestamps. Anything searchable."
        />
      )}
      <div className="mt-2">
        <AiInput 
          placeholder="Ask AI to write notes... (type @ for template)" 
          context={notesAiContext}
          templates={activeSpace?.templates}
          onResponse={res => setPendingNotes(res)} 
        />
      </div>
    </div>
  );

  const isFileKind = item.kind === "file";
  const sourceLabel = isFileKind ? "file path" : "url";
  const sourceValue = isFileKind ? item.file_path : item.url;
  const sourceField = item.kind !== "note" && (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-zinc-400">{sourceLabel}</label>
        {!sourceEdit && (
          <button
            type="button"
            onClick={() => { setSourceInput(sourceValue || ""); setSourceEdit(true); }}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            edit
          </button>
        )}
      </div>
      {sourceEdit ? (
        <div className="flex flex-col gap-2">
          <input
            autoFocus
            value={sourceInput}
            onChange={e => setSourceInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") patchSource.mutate(isFileKind ? { file_path: sourceInput.trim() || null } : { url: sourceInput.trim() || null });
              if (e.key === "Escape") setSourceEdit(false);
            }}
            placeholder={isFileKind ? "C:\\path\\to\\file" : "https://…"}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm outline-none focus:border-zinc-600"
          />
          <div className="flex gap-2">
            <button
              onClick={() => patchSource.mutate(isFileKind ? { file_path: sourceInput.trim() || null } : { url: sourceInput.trim() || null })}
              disabled={patchSource.isPending}
              className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 rounded disabled:opacity-50"
            >
              {patchSource.isPending ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setSourceEdit(false)} className="px-3 py-1 text-sm bg-zinc-700 hover:bg-zinc-600 rounded">
              Cancel
            </button>
          </div>
          {!isFileKind && <span className="text-[10px] text-zinc-600">Use "Re-fetch metadata" in the ... menu to refresh title/thumbnail after changing the URL.</span>}
        </div>
      ) : sourceValue ? (
        <a href={itemLink(item)!} target="_blank" rel="noreferrer" onClick={pingAccess} className="text-sm text-blue-400 hover:underline break-all line-clamp-2">
          {sourceValue}
        </a>
      ) : (
        <span className="text-sm text-zinc-600">not set</span>
      )}
    </div>
  );

  const fields = (
    <>
      {sourceField}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-zinc-400">tags</label>
        </div>
        <TagInput value={tags} onChange={setTags} allowedNamespaces={activeSpace?.namespaces} />
        <AiInput 
          placeholder="Ask AI for tags..." 
          context={`Item title: ${title}\nDescription: ${item?.description}\nCurrent tags on this item: ${tags.join(", ")}\n\nExisting tags in this space context: ${(activeSpace?.namespaces?.length ? allTags.filter(t => activeSpace.namespaces!.some(ns => t.name.startsWith(ns + ":"))) : allTags).map(t => t.name).join(", ")}\n\n${activeSpace?.namespaces?.length ? `Available tag scopes: ${activeSpace.namespaces.join(", ")}. EVERY SINGLE TAG YOU SUGGEST MUST HAVE A NAMESPACE PREFIX (e.g., 'genre:romance' instead of 'romance'). DO NOT suggest any tag without a colon (':'). If the 'acg:' scope is available, use it specifically for Anime, Comic, and Game related tropes, themes, or elements (e.g., 'acg:tsundere', 'acg:mecha', 'acg:isekai', 'acg:war').\n` : ""}Suggest comma-separated tags based on the user request. Prefer reusing "Existing tags in this space context" if they fit, but you CAN create new ones following the same namespacing idea. EVERY TAG MUST HAVE A NAMESPACE (e.g., 'type:video'). DO NOT provide bare tags. Respond ONLY with comma-separated tags.`}
          onResponse={res => {
            const newTags = res.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
            setPendingTags(prev => Array.from(new Set([...prev, ...newTags])));
          }}
        />
        {pendingTags.length > 0 && (
          <div className="mt-2 border border-zinc-700 rounded p-2 bg-zinc-900/50">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase text-zinc-500 font-bold">AI suggestions · click to add</span>
              <div className="flex gap-2 shrink-0">
                <button onClick={acceptAllPendingTags} className="text-xs text-blue-400 hover:text-blue-300">add all</button>
                <button onClick={() => setPendingTags([])} className="text-xs text-zinc-500 hover:text-zinc-300">dismiss</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {pendingTags.map(t => {
                const already = tags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => acceptPendingTag(t)}
                    disabled={already}
                    title={already ? "already added" : "add tag"}
                    className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${already ? "border-zinc-800 text-zinc-600 line-through cursor-default" : "border-blue-700 text-blue-300 hover:bg-blue-700/30"}`}
                  >
                    {already ? t : `+ ${t}`}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {item.kind !== "note" && (
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">status</label>
          <select value={status} onChange={e => setStatus(e.target.value as ItemStatus)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm">
            {STATUSES.map(s => <option key={s} value={s}>{DEFAULT_LABELS[s]}</option>)}
          </select>
        </div>
      )}
      {isSerialized(tags) && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">progress</label>
            <input
              type="number"
              min={0}
              value={progress}
              onChange={e => setProgress(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">total <span className="text-zinc-600">(blank = ongoing)</span></label>
            <input
              type="number"
              min={0}
              value={total ?? ""}
              onChange={e => {
                const v = e.target.value.trim();
                setTotal(v === "" ? null : Math.max(0, Math.floor(Number(v) || 0)));
              }}
              placeholder="?"
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      )}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-zinc-400">files</label>
          {BACKEND_AVAILABLE ? (
            <>
              <button
                type="button"
                onClick={() => attachFileRef.current?.click()}
                disabled={uploadAttachment.isPending}
                className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
              >
                {uploadAttachment.isPending ? "uploading…" : "+ attach"}
              </button>
              <input
                ref={attachFileRef}
                type="file"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) { uploadAttachment.mutate(file); e.target.value = ""; }
                }}
              />
            </>
          ) : (
            <FullVersionBadge note="File attachments are stored on the backend (full version only)." />
          )}
        </div>
        {attachments.length > 0 && (
          <div className="space-y-1">
            {attachments.map(att => (
              <div key={att.name} className="flex items-center gap-2 group/att">
                <a
                  href={att.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 min-w-0 flex items-center gap-1.5 text-sm text-blue-400 hover:underline"
                >
                  <span className="truncate">{att.name}</span>
                  <span className="text-zinc-600 text-xs shrink-0">{fmtSize(att.size)}</span>
                </a>
                <button
                  type="button"
                  onClick={() => deleteAttachment.mutate(att.name)}
                  className="text-zinc-600 hover:text-red-400 text-sm opacity-0 group-hover/att:opacity-100 shrink-0"
                  title="remove"
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
      {item.needs_enrichment && (
        <div className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900 rounded p-2">
          Enrichment failed. Try "Re-fetch metadata" in the ... menu.
        </div>
      )}
    </>
  );

  const leftTopBar = (
    <div className="flex items-center shrink-0">
      <button onClick={() => nav(-1)} className="text-xs text-zinc-400 hover:text-zinc-100 px-2 py-1 -ml-2 rounded hover:bg-zinc-800">&lt; back</button>
    </div>
  );

  const rightTopBar = (
    <div className="flex items-center gap-2 shrink-0">
      <span className={`text-xs transition-opacity duration-500 ${saveStatus === "idle" ? "opacity-0" : "opacity-100"} ${saveStatus === "saved" ? "text-zinc-400" : "text-zinc-500"}`}>
        {saveStatus === "saving" ? "Saving..." : "Saved"}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="px-2 py-1 text-zinc-400 hover:text-zinc-100 rounded hover:bg-zinc-800 text-base leading-none"
          >
            ...
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 bg-zinc-900 border border-zinc-800 rounded shadow-lg z-20 min-w-44">
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-800"
                onMouseDown={openHistory}
              >
                History
              </button>
              {item.url && (
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
                  onMouseDown={() => { refresh.mutate(); setMenuOpen(false); }}
                  disabled={refresh.isPending}
                >
                  {refresh.isPending ? "Refreshing..." : "Re-fetch metadata"}
                </button>
              )}
              <button
                className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-zinc-800 disabled:opacity-50"
                onMouseDown={() => del.mutate()}
                disabled={del.isPending}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const notesReviewPanel = pendingNotes !== null && (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={() => setPendingNotes(null)}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <span className="text-sm font-medium">Review AI notes</span>
          <button onClick={() => setPendingNotes(null)} className="text-zinc-500 hover:text-zinc-200">x</button>
        </div>
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-px bg-zinc-800 overflow-hidden">
          <div className="bg-zinc-900 overflow-y-auto p-3 min-h-0">
            <div className="text-[10px] uppercase text-zinc-500 font-bold mb-2">Current</div>
            <MarkdownRenderer>{notes || "_no notes_"}</MarkdownRenderer>
          </div>
          <div className="bg-zinc-900 overflow-y-auto p-3 min-h-0">
            <div className="text-[10px] uppercase text-zinc-500 font-bold mb-2">Proposed</div>
            <MarkdownRenderer>{pendingNotes || "_empty_"}</MarkdownRenderer>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-800 shrink-0">
          <button onClick={() => setPendingNotes(null)} className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 rounded">Discard</button>
          <button onClick={() => { setNotes(pendingNotes); setPendingNotes(null); }} className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded">Accept</button>
        </div>
      </div>
    </div>
  );

  const historyPanel = historyOpen && (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={() => setHistoryOpen(false)}>
      <div className="w-full md:w-80 bg-zinc-900 border-l border-zinc-800 h-full flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <span className="text-sm font-medium">History</span>
          <button onClick={() => setHistoryOpen(false)} className="text-zinc-500 hover:text-zinc-200">x</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {revisions.length === 0 ? (
            <p className="text-zinc-500 text-sm p-4">No history yet. Changes will appear here after the first save.</p>
          ) : (
            <ul>
              {revisions.map(rev => (
                <li key={rev.id} className="border-b border-zinc-800 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{rev.title || "(no title)"}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{fmtTime(rev.created_at)}</p>
                      {JSON.parse(rev.tags_json).length > 0 && (
                        <p className="text-xs text-zinc-600 mt-1 truncate">{JSON.parse(rev.tags_json).join(", ")}</p>
                      )}
                    </div>
                    <button
                      onClick={() => restore.mutate(rev.id)}
                      disabled={restore.isPending}
                      className="shrink-0 text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
                    >
                      Restore
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* ── Mobile: single scrollable column ─────────────────────── */}
      <div className="md:hidden flex flex-col">
        <div className="sticky top-0 z-20 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800 px-4 py-2 shrink-0 flex items-center justify-between">
          {leftTopBar}
          {rightTopBar}
        </div>
        <div className="aspect-video shrink-0">{media}</div>
        {hasMeta && <div className="px-4 py-2 border-b border-zinc-800">{meta}</div>}
        <div className="flex flex-col gap-4 p-4 pb-10">
          {notesPanel}
          {fields}
        </div>
      </div>

      {/* ── Desktop: notes-focused 3-column layout ──────────────── */}
      <div
        ref={containerRef}
        className="hidden md:flex h-full overflow-hidden"
      >
          {/* Left column — image + meta */}
          <div
            className="flex flex-col gap-3 p-4 overflow-y-auto shrink-0"
            style={{ width: leftW }}
          >
            {leftTopBar}
            <div className="aspect-video w-full shrink-0">{media}</div>
            {meta}
          </div>

          {/* Resize handle — left */}
          <div
            className="shrink-0 cursor-col-resize flex items-center justify-center hover:bg-zinc-700/40 active:bg-zinc-600/40 transition-colors"
            style={{ width: HANDLE_W }}
            onPointerDown={(e) => {
              e.preventDefault();
              dragging.current = "left";
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
          >
            <div className="w-px h-8 bg-zinc-700 rounded-full" />
          </div>

          {/* Center column — notes */}
          <div className="flex-1 min-w-0 flex flex-col gap-3 p-4 overflow-hidden">
            {notesPanelFill}
          </div>

          {/* Resize handle — right */}
          <div
            className="shrink-0 cursor-col-resize flex items-center justify-center hover:bg-zinc-700/40 active:bg-zinc-600/40 transition-colors"
            style={{ width: HANDLE_W }}
            onPointerDown={(e) => {
              e.preventDefault();
              dragging.current = "right";
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
          >
            <div className="w-px h-8 bg-zinc-700 rounded-full" />
          </div>

          {/* Right column — fields */}
          <div
            className="flex flex-col gap-3 p-4 overflow-y-auto shrink-0"
            style={{ width: rightW }}
          >
            {rightTopBar}
            {fields}
          </div>
        </div>

      {historyPanel}
      {notesReviewPanel}
    </>
  );
}
