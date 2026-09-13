# Microsoft Detours vendoring record

GameHub vendors the Windows desktop subset of Microsoft Detours 4.0.1 only
for the isolated overlay-supervisor QA spike.

- Upstream: https://github.com/microsoft/Detours
- Tag: `v4.0.1`
- Commit: `e4bfd6b03e50de46b47abfbd1e46b384f0c5f833`
- Git tree: `600b4d42793cbefd55070c43b8d4b3d4a569cb8c`
- License: MIT; the unmodified upstream `LICENSE.md` is retained here.

The checked-in text files are normalized to LF by `prepare.cjs`, matching this
repository's `.gitattributes`. `SOURCE_MANIFEST.sha256` authenticates the
normalized vendored files. To reproduce the vendor directory from the pinned
upstream commit:

```powershell
node third_party/microsoft-detours/prepare.cjs
node scripts/build-overlay-qa-supervisor.cjs --verify-only
```

The preparation script checks both the exact commit and its Git tree before
copying an explicit allowlist. It never follows an upstream branch or tag.
