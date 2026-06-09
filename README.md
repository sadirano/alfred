# alfred

**A browser-only preview of a personal favorites library.** Save any YouTube link
(or any URL, local file, or freeform note) with tags, markdown notes, and a status,
then organize everything into **Spaces** with saved tag filters. Search, boolean tag
queries, soft-delete/trash, and a usage counter are all here.

**▶ Live demo: https://sadirano.github.io/alfred/**

> Alfred is a frozen, limited preview of a larger private tool. It runs **entirely in
> your browser** — there is no backend and no account. Everything you add is stored in
> this browser's `localStorage`, and **export/import (in Settings) is the only backup.**

## Your data stays in your browser

Nothing is sent anywhere. The one network call the demo makes is to YouTube's public
**oEmbed** endpoint, to auto-fill a video's title, channel, and thumbnail when you add it.

## What's in the preview vs. the full version

The full tool has a backend (FastAPI + SQLite + yt-dlp + Gemini) that can't run on a
static site. Those capabilities are kept **visible but badged “Full version only”** so you
can see the whole shape of the app — there's a one-click *Hide unsupported features* toggle
in Settings.

| Works in the demo | Full version only |
| --- | --- |
| YouTube auto-fill (title / channel / thumbnail) | Auto-fill for non-YouTube links (server-side scraping) |
| Tags, Spaces, saved filters, statuses, counters | Opening local `file://` items |
| Search, boolean tag queries, trash/restore/purge | Revision history |
| AniList link-out, access metrics, export/import | Re-fetching metadata for non-YouTube links |
| Per-Space AI note templates (create / edit) | AI note generation (@-mention + draft), file attachments & image uploads |

## Run it locally

```bash
cd frontend
npm install
npm run dev      # then open http://localhost:5173/alfred/
```

(The `/alfred/` path matters — the app is built with that base for GitHub Pages.)

```bash
npm run build    # static site -> frontend/dist
```

## Stack

React 19 · Vite · TypeScript · Tailwind v4 · TanStack Query · React Router (HashRouter).
Deployed to GitHub Pages via the workflow in `.github/workflows/deploy.yml`.

## License

MIT — see [LICENSE](LICENSE).
