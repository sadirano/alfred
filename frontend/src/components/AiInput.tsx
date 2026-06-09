import { useState, useRef, useEffect } from "react";
import { api, Template } from "../api/client";
import { BACKEND_AVAILABLE } from "../lib/demo";
import FullVersionBadge from "./FullVersionBadge";

export default function AiInput({ 
  placeholder, 
  onResponse,
  context = "",
  templates = [],
}: { 
  placeholder: string; 
  onResponse: (response: string) => void;
  context?: string;
  templates?: Template[];
}) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // AI generation is backend-only; the demo shows the control but can't run it.
    if (!BACKEND_AVAILABLE) return;
    if (!prompt.trim() || loading) return;
    setLoading(true);
    try {
      // If prompt contains templates, append them explicitly to the end of prompt?
      // No, the context already contains all templates! The AI just needs to know the user mentioned it.
      const fullPrompt = context ? `${context}\n\nUser request: ${prompt}` : prompt;
      const res = await api.askAI(fullPrompt);
      onResponse(res.response);
      setPrompt("");
      setMentionOpen(false);
    } catch (err: any) {
      alert(err.info?.detail || err.message || "AI request failed");
    } finally {
      setLoading(false);
    }
  }

  const filteredTemplates = templates.filter(t => t.name.toLowerCase().includes(mentionQuery.toLowerCase()));

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!mentionOpen) return;
    
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIndex(i => (i + 1) % filteredTemplates.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIndex(i => (i - 1 + filteredTemplates.length) % filteredTemplates.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (filteredTemplates[mentionIndex]) {
        insertMention(filteredTemplates[mentionIndex]);
      }
    } else if (e.key === "Escape") {
      setMentionOpen(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setPrompt(val);
    
    const cursor = e.target.selectionStart || 0;
    const textBeforeCursor = val.slice(0, cursor);
    const match = textBeforeCursor.match(/@([^@]*)$/);
    
    if (match) {
      setMentionOpen(true);
      setMentionQuery(match[1]);
      setMentionIndex(0);
    } else {
      setMentionOpen(false);
    }
  }

  function insertMention(t: Template) {
    if (!inputRef.current) return;
    const cursor = inputRef.current.selectionStart || 0;
    const textBeforeCursor = prompt.slice(0, cursor);
    const textAfterCursor = prompt.slice(cursor);
    
    const match = textBeforeCursor.match(/@([^@]*)$/);
    if (match) {
      const beforeAt = textBeforeCursor.slice(0, match.index);
      const newPrompt = `${beforeAt}"${t.name}" ${textAfterCursor}`;
      setPrompt(newPrompt);
      setMentionOpen(false);
      // Wait a tick for render then focus
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          const newPos = beforeAt.length + t.name.length + 3;
          inputRef.current.setSelectionRange(newPos, newPos);
        }
      }, 0);
    }
  }

  return (
    <form onSubmit={submit} className="relative flex items-center mt-2 w-full">
      {mentionOpen && filteredTemplates.length > 0 && (
        <div className="absolute bottom-full left-0 mb-2 w-[400px] max-h-[300px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden flex flex-col z-50">
          <div className="text-[10px] uppercase text-zinc-500 font-bold px-3 py-1.5 border-b border-zinc-800 bg-zinc-950">Select a Template</div>
          <div className="flex-1 overflow-y-auto flex">
            <div className="w-1/2 border-r border-zinc-800 p-1 flex flex-col gap-0.5 shrink-0">
              {filteredTemplates.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => insertMention(t)}
                  onMouseEnter={() => setMentionIndex(i)}
                  className={`text-left px-2 py-1.5 rounded text-xs truncate ${i === mentionIndex ? "bg-blue-600 text-white" : "text-zinc-300 hover:bg-zinc-800"}`}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <div className="w-1/2 p-2 bg-zinc-950 flex flex-col shrink-0">
              {filteredTemplates[mentionIndex] ? (
                <pre className="text-[10px] text-zinc-400 font-mono whitespace-pre-wrap overflow-y-auto m-0">
                  {filteredTemplates[mentionIndex].content}
                </pre>
              ) : (
                <div className="text-[10px] text-zinc-600 italic">No preview</div>
              )}
            </div>
          </div>
        </div>
      )}
      <input
        ref={inputRef}
        type="text"
        value={prompt}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={!BACKEND_AVAILABLE ? placeholder : loading ? "Thinking..." : placeholder}
        disabled={loading || !BACKEND_AVAILABLE}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-500 pr-8 transition-colors disabled:opacity-50"
      />
      {BACKEND_AVAILABLE ? (
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          className="absolute right-1.5 p-1 text-zinc-400 hover:text-blue-400 disabled:opacity-50 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      ) : (
        <span className="absolute right-1.5">
          <FullVersionBadge note="AI note generation runs on the backend (full version only)." />
        </span>
      )}
    </form>
  );
}
