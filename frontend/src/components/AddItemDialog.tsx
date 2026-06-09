import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, ApiError, ItemCreate, ItemStatus, Space } from "../api/client";
import { DEFAULT_LABELS, STATUSES } from "../lib/status";
import TagInput from "./TagInput";

interface Props {
  activeSpace?: Space;
  onClose: () => void;
}

type Mode = "url" | "file" | "note";

export default function AddItemDialog({ activeSpace, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [filePath, setFilePath] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState(activeSpace?.note_template_md || "");
  // Pre-fill the active space's required tags so a new item lands in that space.
  const [tags, setTags] = useState<string[]>(activeSpace?.tags ?? []);
  const [status, setStatus] = useState<ItemStatus>("plan");
  const [dupId, setDupId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const qc = useQueryClient();
  const nav = useNavigate();

  const m = useMutation({
    mutationFn: (body: ItemCreate) => api.createItem(body),
    onSuccess: (it) => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
      nav(`/items/${it.id}`);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setDupId(err.body?.detail?.existing_id ?? null);
        setError("Already in your library.");
      } else {
        setError(String(err));
      }
    },
  });

  function submit() {
    setError(null); setDupId(null);
    const base = { tags, status };
    if (mode === "url") m.mutate({ ...base, url });
    else if (mode === "file") m.mutate({ ...base, file_path: filePath });
    else m.mutate({ ...base, note_title: noteTitle, note_body: noteBody });
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-xl p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Add to library</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100">×</button>
        </div>
        <div className="flex gap-2 mb-4">
          {(["url", "file", "note"] as Mode[]).map(t => (
            <button
              key={t}
              onClick={() => setMode(t)}
              className={`px-3 py-1 rounded text-sm capitalize ${mode === t ? "bg-zinc-700" : "bg-zinc-800 text-zinc-400"}`}
            >
              {t}
            </button>
          ))}
        </div>

        {mode === "url" && (
          <input
            autoFocus
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=… or any URL"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 mb-3"
          />
        )}
        {mode === "file" && (
          <input
            autoFocus
            value={filePath}
            onChange={e => setFilePath(e.target.value)}
            placeholder="C:\path\to\file.mp4"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 mb-3"
          />
        )}
        {mode === "note" && (
          <>
            <input
              autoFocus
              value={noteTitle}
              onChange={e => setNoteTitle(e.target.value)}
              placeholder="title"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 mb-2"
            />
            <textarea
              value={noteBody}
              onChange={e => setNoteBody(e.target.value)}
              placeholder="body (markdown ok)"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 mb-3 h-28"
            />
          </>
        )}

        <div className="mb-3">
          <label className="text-xs text-zinc-400 mb-1 block">tags</label>
          <TagInput value={tags} onChange={setTags} />
        </div>

        <div className="mb-3">
          <label className="text-xs text-zinc-400 mb-1 block">status</label>
          <select value={status} onChange={e => setStatus(e.target.value as ItemStatus)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm">
            {STATUSES.map(s => <option key={s} value={s}>{DEFAULT_LABELS[s]}</option>)}
          </select>
        </div>

        {error && (
          <div className="mb-3 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-2 flex items-center justify-between">
            <span>{error}</span>
            {dupId && (
              <button
                className="text-xs underline"
                onClick={() => { nav(`/items/${dupId}`); onClose(); }}
              >
                open existing
              </button>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded bg-zinc-800">Cancel</button>
          <button onClick={submit} disabled={m.isPending}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
            {m.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
