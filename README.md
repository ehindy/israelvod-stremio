# Kan VOD Stremio Addon

This addon discovers Kan VOD episode streams directly from episode pages by extracting the `data-hls-url` and `data-dash-url` values embedded in the page HTML.

## What it does
- Exposes a `series` catalog for Kan content
- Builds `meta` responses by crawling season episode links
- Builds `stream` responses by resolving episode pages and extracting stream URLs
- Works with newly added episodes as long as Kan keeps the same page structure

## Install
```bash
npm install
npm start
```

Then open:
- `http://localhost:7000/manifest.json`

## Notes
- The current implementation targets `kan-11` VOD pages.
- It assumes episode pages contain a `#redge-player-*` element with `data-hls-url` / `data-dash-url`.
- Search and series discovery may need tuning if Kan changes markup.

## Suggested next improvements
- Persist a local index of discovered series/episodes
- Add support for multiple seasons
- Add Hebrew title normalization
- Add subtitles extraction if Kan exposes them in `data-subtitles-urls`
- Add better mapping from episode id to page URL without using search
