import type { ItemStatus, Space } from "../api/client";

// The canonical pipeline. Internal ids are generic ("plan/in-progress/…") so
// they read naturally for any kind of work; Spaces override the *display* of
// the three active states via statusLabel (archived stays fixed).
export const STATUSES: ItemStatus[] = ["plan", "in-progress", "completed", "archived"];

export const DEFAULT_LABELS: Record<ItemStatus, string> = {
  "plan": "plan",
  "in-progress": "in progress",
  "completed": "completed",
  "archived": "archived",
};

export const STATUS_BADGE: Record<ItemStatus, string> = {
  "plan": "bg-blue-600 text-white",
  "in-progress": "bg-amber-600 text-white",
  "completed": "bg-emerald-600 text-white",
  "archived": "bg-zinc-700 text-zinc-300",
};

// The grid toggle cycles plan → in-progress → completed → plan; archived rejoins
// the active pipeline at plan.
export const NEXT_STATUS: Record<ItemStatus, ItemStatus> = {
  "plan": "in-progress",
  "in-progress": "completed",
  "completed": "plan",
  "archived": "plan",
};

export const STATUS_ICON: Record<ItemStatus, string> = {
  "plan": "▶",
  "in-progress": "✓",
  "completed": "↺",
  "archived": "↺",
};

// Display name for a status. A Space's custom labels (its 3 active states) win;
// otherwise the canonical default. archived is never customizable, so it always
// resolves to its default even if a stray label slips into the map.
export function statusLabel(status: string, space?: Pick<Space, "labels"> | null): string {
  if (status !== "archived" && space?.labels?.[status]) return space.labels[status];
  return DEFAULT_LABELS[status as ItemStatus] ?? status;
}
