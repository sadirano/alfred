import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { exportDb, importDb } from "../api/client";
import { getHideUnsupported, setHideUnsupported } from "../lib/demo";
import { APP_NAME } from "../config";

// Settings for the browser-only demo: toggle the "Full version only" badges and
// back up / restore the whole library. Alfad keeps everything in localStorage,
// so export/import is the only backup there is.
export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [hide, setHide] = useState(getHideUnsupported);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function toggleHide() {
    const next = !hide;
    setHide(next);
    setHideUnsupported(next);
  }

  function download() {
    const blob = new Blob([exportDb()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${APP_NAME}-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!confirm("Replace your entire library with this backup? This can't be undone.")) return;
    try {
      importDb(await file.text());
      qc.invalidateQueries();
      setMsg("Library replaced from backup.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Import failed.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 w-[26rem]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium">Settings</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-100">×</button>
        </div>

        <label className="flex items-start gap-2 cursor-pointer mb-4">
          <input type="checkbox" checked={hide} onChange={toggleHide} className="mt-0.5" />
          <span>
            <span className="text-sm text-zinc-200">Hide unsupported features</span>
            <span className="block text-xs text-zinc-500">
              Removes the “Full version only” badges and disabled controls for a cleaner demo.
            </span>
          </span>
        </label>

        <div className="border-t border-zinc-800 pt-3">
          <p className="text-sm text-zinc-200 mb-1">Backup</p>
          <p className="text-xs text-zinc-500 mb-2">
            Your library lives only in this browser. Export a JSON copy to keep it safe; import replaces everything.
          </p>
          <div className="flex gap-2">
            <button onClick={download} className="px-3 py-1.5 text-sm rounded bg-zinc-800 hover:bg-zinc-700">
              Export JSON
            </button>
            <button onClick={() => fileRef.current?.click()} className="px-3 py-1.5 text-sm rounded bg-zinc-800 hover:bg-zinc-700">
              Import…
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onPick} />
          </div>
          {msg && <p className="text-xs text-zinc-400 mt-2">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
