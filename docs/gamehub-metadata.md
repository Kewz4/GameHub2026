# GameHub console metadata ("GameHubAPI")

Console/emulated games (PS1, PS2, Game Boy, …) are **not** in the PC HydraAPI
catalogue, so they need their own metadata source for art, descriptions and
genres. Rather than run a live API server, GameHub uses a **static dataset**
hosted in this repo — the same pattern as the Minerva ROM catalogue.

```
sources/minerva/<system>.json        ROM download magnets (titles + magnets)
sources/gamehub-meta/<system>.json   metadata (art + IGDB info) ← this doc
```

Both are fetched raw from GitHub at runtime. No live SteamGridDB/IGDB calls on
the user's launch path (those rate-limit and need keys).

## Data flow

1. **Generate (offline, occasional):**
   `scripts/generate-gamehub-metadata.cjs` walks `sources/minerva/<system>.json`,
   resolves SteamGridDB artwork + IGDB metadata for every distinct base game,
   and writes `sources/gamehub-meta/<system>.json` keyed by the app's normalized
   title.
2. **Commit** the generated JSON to the `dev` branch.
3. **Runtime load:** on first launch the app fetches each hosted file into the
   `gamehubMeta` LevelDB sublevel (`ensureGameHubMeta`, background, non-blocking).
4. **Consume:** the search dropdown, the Catalogue grid and game-details read
   `getGameHubMeta(system, title)` for covers, genres and release year.

## Generating the dataset

```bash
# All systems (long — tens of thousands of titles, rate-limited):
node scripts/generate-gamehub-metadata.cjs

# Specific systems:
node scripts/generate-gamehub-metadata.cjs ps1 ps2 psp

# Smoke test (first N titles per system):
node scripts/generate-gamehub-metadata.cjs gba --limit 20

# Re-resolve entries already present (otherwise they're skipped):
node scripts/generate-gamehub-metadata.cjs ps1 --force
```

- **Resumable:** existing entries are preserved and skipped, and the output is
  flushed every 25 titles, so a long run survives interruption — just re-run.
- **Rate limits:** ~280 ms between titles (IGDB allows ~4 req/s) with
  exponential-backoff retries on HTTP 429.
- **Credentials:** the embedded SteamGridDB key and IGDB (Twitch) app creds are
  the same ones the app ships with. Override via `SGDB_API_KEY`,
  `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` if you want to use your own.

A title that resolves neither art nor IGDB data is omitted (no empty rows). Art
hit-rate is high; IGDB matches are lower for obscure regional titles, so some
entries have art but no description — that's expected.

## Output format

`sources/gamehub-meta/<system>.json`:

```json
{
  "system": "ps1",
  "generatedAt": 1750000000000,
  "games": {
    "granturismo": {
      "title": "Gran Turismo",
      "description": "...",
      "genres": ["Racing", "Simulator"],
      "releaseYear": 1997,
      "coverImageUrl": "https://cdn2.steamgriddb.com/grid/….png",
      "libraryImageUrl": "https://….png",
      "libraryHeroImageUrl": "https://….png",
      "logoImageUrl": "https://….png"
    }
  }
}
```

The key is `title.toLowerCase().replace(/[^a-z0-9]/g, "")` — identical to
`normalizeTitle` in `src/main/level/sublevels/minerva-catalogue.ts` and
`normalizeMetaTitle` in `src/main/level/sublevels/gamehub-meta.ts`. Keep these
three in sync or runtime lookups will miss.

## Hosting

The runtime base URL is
`https://raw.githubusercontent.com/Kewz4/hydra/dev/sources/gamehub-meta` (env
override: `GAMEHUB_META_BASE_URL`). Generated files must be committed to `dev`
for users to receive them. Systems without a generated file are skipped silently.
