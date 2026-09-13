# Linux emulation, launches and save parity

## Implemented in this pass

| Area                               | Linux implementation                                                                                                                                                                                                                                                                              | Verification                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Wine/Proton fallback               | Retains the prefix selected for the game and used by Cloud Saves; runner failure cannot fall through to executing a PE binary natively.                                                                                                                                                           | Environment regression test; node typecheck.                                                  |
| Native game discovery              | User game roots, native/Flatpak Steam libraries, extensionless ELF and executable scripts; no binaries are executed during scanning.                                                                                                                                                              | Pure root tests; executable mode/header test requires Linux.                                  |
| ROM discovery                      | Linux user ROM/EmuDeck roots and selective folders; case-sensitive path deduplication.                                                                                                                                                                                                            | Source wiring and typecheck.                                                                  |
| Big Picture file browser           | Files and directories reached through symlinks, including Steam aliases, remain selectable; broken links omitted, no recursive traversal.                                                                                                                                                         | Directory metadata test; symlink/loop test requires Linux.                                    |
| Standalone emulator settings/saves | Shared resolver for native XDG and Flatpak roots, including custom XDG values. Config/save split preserved for Dolphin, Azahar and Cemu. RPCS3 games.yml and all savedata profiles follow the same selected root.                                                                                 | Table-driven tests for seven emulator families, Flatpak, custom paths and portable layouts.   |
| Controller mapper output           | Writes actual Linux config paths without creating markers in /usr/bin/Flatpak exports. RPCS3 uses SDL rather than Windows-only XInput.                                                                                                                                                            | Typecheck and controller writer tests.                                                        |
| Cemu                               | Custom MLC path respected for Cloud V2; graphical settings use the config root, content/graphic packs use data root.                                                                                                                                                                              | Synthetic custom-MLC test; no saves moved.                                                    |
| PCSX2 AppImage                     | Does not mistake an adjacent portable.ini for an effective AppImage marker. Existing native saves remain selected. Previously-used `PCSX2/inis/PCSX2.ini` portable layouts get the matching data root and explicit `-portable` launch.                                                            | Two AppImage path regression tests.                                                           |
| Eight retro systems                | Linux uses installed RetroArch with native cores for PS1, PSP, GB, GBC, GBA, N64, DS and DSi. The persisted `ralibretro` identifier remains compatible with Windows; Linux presentation is RetroArch.                                                                                             | All-eight core matrix and launch/config/controller tests.                                     |
| RetroArch launch/settings          | Native and Flatpak discovery; exact .so core lookup, CLI arguments preserve spaces, missing cores give actionable errors. Per-system core options and SDL controller mappings are loaded through a separate append-config; original RetroArch config is never rewritten. DS/DSi mode is explicit. | Synthetic native-core launch and unchanged-original-config tests.                             |
| RetroAchievements                  | RetroArch receives the explicit `login2` token when the user signed in through GameHub, not the unrelated web API key. Private launch config uses mode 0600 on Linux. Without a launcher token, native emulator sign-in is preserved.                                                             | Source verified against RetroArch configuration/cheevos code; real account unlock not tested. |
| Emulator reinstall                 | Downloads/extracts to a new staging tree; validated new executable is resolved there. Updates preserve portable saves/settings and unrelated files. File replacement backs up binaries and rolls back on errors; incomplete rollback retains the originals and reports their location.            | Synthetic preservation and injected-copy-failure rollback tests.                              |
| Cloud Save V2                      | Existing account fences, game isolation, path approval, conflict handling and orphaned-anchor protections unchanged. New Linux paths feed the same pipeline.                                                                                                                                      | Full suite: 381 passed, 4 OS-specific skips on Windows.                                       |

## Follow-up save pipeline fixes

- Native XDG/Flatpak roots now receive portable-compatible Cloud V2 identities even when they are outside the executable directory. Existing portable v2 identities stay unchanged; unknown roots and out-of-root targets remain rejected. Seven emulator-family identity tests cover this.
- RetroArch's effective save directory applies the native core/content sorting settings. Launching, backup and clean restore now use that same computed directory, rather than restoring to an unsorted parent the core would not read.
- PSP maps only the current DISC_ID's save-slot folders under PSP/SAVEDATA. Metadata is read from bounded ISO/PBP/unpacked structures or a validated stored serial, never guessed from filenames. New game-bound folder-preserving v3 PSP rule IDs support clean Windows-to-Linux restore without guessing the save-slot suffix. Tests reject sibling titles, tampered folder names, and ambiguous roots.
- DSi maps the exact ROM.public.sav, ROM.private.sav and ROM.banner.sav exports. Shared NAND and SD-card images are never registered as one game's automatic save. Tests mix title exports, a sibling title, NAND and SD images and verify only the current-title files are selected.
- SRAM naming now has a verified same-core alias route for GB/GBC/GBA (mGBA), N64 (Mupen64Plus-Next), and DS/DSi cartridge SRAM (melonDS DS). Both launchers use one shared core registry. RALibretro's standard `S` layout loads the full ROM filename plus `.sram`; RetroArch loads the ROM stem plus `.srm`. Restore writes the target frontend's filename without modifying the payload. Existing portable rule IDs and active snapshot filenames remain the logical identity, including older stem-based v2 entries.
- Local snapshots normalize only this validated logical alias after native hashing, retaining actual disk paths and content hashes, so the next synchronization does not mistake the frontend filename difference for a deleted/new save pair. Tests cover Windows → Linux → Windows planning, old v2 IDs, unchanged source bytes, and the actual native restore resolver/replacement engine writing an `.srm` target while retaining the `.sram` manifest identity.

## Explicit limits: not a certification of complete Linux parity

- This workstation has Windows and only Docker Desktop's internal WSL distribution. No native desktop Linux/Steam Deck game launch, Flatpak sandbox, controller hardware or real Linux save upload/restore has been exercised here. Tests using actual POSIX permissions and symlinks are included for Linux CI and skip Windows.
- RetroArch itself and the five required native core binaries must already be installed through the official distribution/Flathub/package manager or RetroArch Core Downloader. GameHub detects and launches them; it does not claim to bundle/install native cores. Firmware/BIOS requirements still apply, especially PS1 and DSi.
- PSP CSO/CHD images without a previously-resolved serial remain unmapped. Titles deliberately sharing another title's serial-based save folder require a precise custom mapping. These PSP/DSi format gaps also existed in the Windows RALibretro mapper; they were not Linux-only.
- SRAM aliases are intentionally limited to the six consoles/core mappings above and exact unpacked ROM identity. PS1 memory-card modes, different cores, archives with unknown internal filenames, and custom RALibretro SRAM folder layouts are not converted. Conflicting aliases, inactive local filenames, ambiguous cloud identities and overlapping same-stem games produce explicit diagnostics rather than overwrite or silently start fresh. Existing inactive local aliases remain preserved for the user to compare/copy intentionally. Actual core/game loading of cross-platform progress still requires populated Linux acceptance; the native restore engine test proves filename binding and byte preservation, not gameplay.
- Shared DSi NAND/SD images remain excluded on both operating systems by design. melonDS DS's per-title exports are now mapped on both. Custom/older cores that keep progress only in shared NAND require an exported per-title save, not a whole-NAND automatic restore.
- Native RetroArch per-core/content override files and nonstandard user-config launch flags need populated real-world verification. Primary-config core/content sorting is handled; the adapter preserves the primary config and existing settings when GameHub has no custom override.
- Dolphin raw/shared cards and custom GCI paths remain explicitly excluded from automatic per-game restore; use the dedicated memory-card manager or a precise approved mapping. RPCS3 custom VFS remaps, custom Azahar/Eden NAND roots and arbitrary AppImage wrapper scripts need additional acceptance coverage.
- The Windows Steam-emulator/offline-play integration is still PE/DLL-specific: `SteamAutoCrack.CLI.exe`, Windows absolute-path validation and `steam_api*.dll` detection. Native ELF/`libsteam_api.so` parity is not implemented by this pass.
- Existing Cemu UKMM auxiliary paths and emulator-specific auto-login outside RetroArch require further native-Linux review. Do not conflate compiling these modules with actual mod deployment or achievement-unlock acceptance.
- Update staging is rollback-safe for reported file-operation failures. A power loss during multiple binary replacements is not a full filesystem transaction; the retained original backup directory supports recovery. Portable save folders are never part of the replacement plan.

## Tests to run on Linux

```sh
npx tsx --test src/main/services/emulators/emulator-user-paths.test.ts src/main/services/emulators/retroarch-linux.test.ts src/main/services/emulators/install-preserving-data.test.ts src/main/helpers/linux-game-discovery.test.ts src/main/helpers/read-file-explorer-directory.test.ts
npx tsx --test src/main/services/emulators/psp-save-paths.test.ts src/main/services/cloud-save/psp-cloud-save-rules.test.ts src/main/services/cloud-save/linux-emulator-rule-roots.test.ts
npx tsx --test src/main/services/cloud-save/libretro-sram-alias.test.ts
yarn test:cloud-save-v2
yarn typecheck:node
```

Use synthetic profiles first. Real save acceptance must back up the exact game folder, compare file hashes before/after sync, verify downloaded cloud bytes separately, and prove the second sync is a no-op. Do not run destructive restore against the original populated profile.

## Primary references

- [Dolphin user-path selection](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/UICommon/UICommon.cpp)
- [Azahar user/config paths](https://github.com/azahar-emu/azahar/blob/master/src/common/file_util.cpp)
- [Cemu native and AppImage paths](https://github.com/cemu-project/Cemu/blob/main/src/gui/wxgui/CemuApp.cpp)
- [PCSX2 data roots and AppImage portable behavior](https://github.com/PCSX2/pcsx2/blob/master/pcsx2/Pcsx2Config.cpp)
- [PCSX2 CLI](https://github.com/PCSX2/pcsx2/blob/master/pcsx2-qt/QtHost.cpp)
- [RPCS3 filesystem directories](https://github.com/RPCS3/rpcs3/blob/master/Utilities/File.cpp)
- [RetroArch native and Flatpak CLI](https://docs.libretro.com/guides/cli-intro/)
- [RetroArch configuration format](https://github.com/libretro/RetroArch/blob/master/retroarch.cfg)
- [RetroArch login-token flow](https://github.com/libretro/RetroArch/blob/master/cheevos/cheevos.c)
- [melonDS DS console-mode requirements](https://github.com/JesseTG/melonds-ds/blob/main/src/libretro/config/definitions/system.hpp)
- [PPSSPP libretro save-directory layout](https://docs.libretro.com/library/ppsspp/)
- [melonDS DS per-title exports versus shared images](https://docs.libretro.com/library/melonds_ds/)
- [RetroArch effective save-directory construction](https://github.com/libretro/RetroArch/blob/master/runloop.c)
- [RALibretro raw SAVE_RAM and frontend filenames](https://github.com/RetroAchievements/RALibretro/blob/develop/src/States.cpp)
- [RALibretro filename/stem handling](https://github.com/RetroAchievements/RALibretro/blob/develop/src/Util.cpp)
- [RetroArch raw save-memory handling](https://github.com/libretro/RetroArch/blob/master/tasks/task_save.c)

## Steam offline-play PE/Wine adapter feasibility

This remains a genuine Linux-only feature gap, not something resolved merely by allowing `.exe` in a Linux file picker. The pinned CLI/Core projects target `net10.0-windows` and x86; the packaged self-contained runner is `win-x86`. A Wine route is plausible for Windows PE games only, but it has not been demonstrated on a Linux Wine runtime. Native ELF/libsteam_api.so support is separate work.

Minimum safe implementation before enabling this feature:

1. Package the pinned Windows CLI/runtime/Goldberg assets for Linux, keeping existing hash checks. Smoke-test `--help` and `createconfig` in a disposable Wine prefix with working 32-bit support. Changing the .NET runtime identifier to linux-x64 is not sufficient for the Windows-targeted project and native dependencies.
2. Keep all safety/backup decisions on native host paths with canonical containment. Extend the target gate to PE files on Linux while excluding system/library collection roots, symlinks and platform-synced owned installations. Do not replace these boundaries with Windows path guesses.
3. Translate only CLI-facing paths with the selected prefix's `winepath -w`: tool, game directory, runtime config and configured auxiliary paths. Never assume Z: is available. Paths remain separate argv entries, not shell-built command strings.
4. Supply an explicit prefix/environment and host working directory. The current process wrapper lacks an environment parameter. Its POSIX timeout kills/verifies only the immediate child, which cannot prove Wine descendants stopped. A disposable process group and descendant verification are required; quarantine the mutation queue when termination cannot be verified.
5. Preserve the existing transaction backup, in-lock reinspection, DLL verification, failure rollback and eligibility exclusions. Failed Wine launch must never be considered successful modification.
6. Place/read Goldberg achievement state under the game's effective Wine-user AppData inside its prefix, not Linux's host AppData. Prove achievement watching and Cloud V2 use that same prefix before enabling automatic setup.
7. Test synthetic PE trees for success, surviving-child timeout, malformed paths, foreign-emulator signatures, failed generation and rollback. Only then test a user-authorized non-platform-synced game with a verified backup. No real games were modified during this audit.

Pinned project definitions: [CLI](https://github.com/SteamAutoCracks/Steam-auto-crack/blob/f687bc287b762b0843052122ad56196dde2ad9a3/SteamAutoCrack.CLI/SteamAutoCrack.CLI.csproj), [Core](https://github.com/SteamAutoCracks/Steam-auto-crack/blob/f687bc287b762b0843052122ad56196dde2ad9a3/SteamAutoCrack.Core/SteamAutoCrack.Core.csproj). Local implementation entry points are `steam-emulator.ts`, `steam-emulator-target.ts`, `steam-emulator-process.ts`, and `scripts/download-emulator-tool.cjs`.
