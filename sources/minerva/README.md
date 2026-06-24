# Minerva ROM Sources

Per-platform download-source JSON files in the Hydra source format
(`{ name, downloads: [{ title, fileSize, uris, uploadDate }] }`), generated from
minerva-archive.org's hash database and served raw from GitHub — the same model
as hydralinks.cloud serves its sources.

Each `uris[0]` is a compact base magnet (`magnet:?xt=urn:btih:...&so=...`); the
app appends a shared tracker list at download time (see
`src/main/services/rom-sources/minerva-sources.ts`).

## Files

One file per console: `gb.json`, `gbc.json`, `gba.json`, `n64.json`, `nds.json`,
`dsi.json`, `n3ds.json`, `wii.json`, `wiiu.json`, `gc.json`, `ps1.json`,
`ps2.json`, `ps3.json`, `psp.json`.

## Regenerating

Download the source database and run the generator:

```bash
curl -o hashes.db https://minerva-archive.org/assets/hashes.db
node --experimental-sqlite scripts/generate-minerva-sources.cjs ./hashes.db ./sources/minerva
```

The launcher pulls these at runtime via the "Refresh Minerva Catalogue" button
in Settings → Emulation (`MINERVA_SOURCES_BASE_URL`).
