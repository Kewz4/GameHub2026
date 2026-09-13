# Linux RetroArch setup

The explicit **Install RetroArch + cores (user Flatpak)** action installs the
official RetroArch Flatpak for the current user and prepares the five native
libretro cores used by GameHub's eight retro-system mappings. It does not run
during startup, discovery, settings reads, or on Windows.

## What the action does

1. Require Linux x64 or arm64 and an executable Flatpak client already installed
   by the distribution. Missing Flatpak produces an actionable setup error; the
   launcher does not run a root/package-manager command to install it.
2. Use Flatpak's `--user` installation with the official Flathub `.flatpakref`
   and matching `x86_64` or `aarch64` architecture. Normal Flatpak repository/GPG
   verification remains enabled. No sandbox or filesystem permission overrides
   are added by GameHub.
3. Resolve the actual user-exported launcher and download these cores from
   Libretro's official HTTPS buildbot for that architecture:

| Systems        | Core                           |
| -------------- | ------------------------------ |
| PlayStation    | `mednafen_psx_libretro.so`     |
| PSP            | `ppsspp_libretro.so`           |
| GB / GBC / GBA | `mgba_libretro.so`             |
| Nintendo 64    | `mupen64plus_next_libretro.so` |
| DS / DSi       | `melondsds_libretro.so`        |

Each archive must contain exactly the expected filename before extraction.
Extracted files must be bounded regular ELF64 shared libraries of the expected
CPU architecture. Publication is atomic and exclusive; existing core files,
configuration, login state, BIOS, ROMs, and saves are not overwritten.

These core downloads follow the official updater's HTTPS source trust model.
They are rolling upstream builds, **not pinned, independently authenticated
release hashes**. 7-Zip validates archive integrity, and GameHub verifies the
resulting binary format/architecture. Redirects are disabled for core downloads.

After provisioning, GameHub checks the core path its launch resolver would
actually select, including an existing custom `libretro_directory`. A malformed
or wrong-architecture custom core stops setup with an error instead of silently
claiming readiness or overwriting that file.

Only when the launcher and all selected cores pass these checks are all eight
GameHub emulator entries updated. Required game-specific BIOS and firmware
remain separate setup requirements. No games, ROMs, or BIOS are included in
this action.

## Failure and retry behavior

- A failed Flatpak command reports that installation did not complete and
  preserves the user's installation/configuration.
- A failed core download/extraction reports that RetroArch is installed but
  names the core still needing setup. Retry installs only missing valid cores;
  the official RetroArch Core Downloader is also offered in the error text.
- Desktop and Big Picture show the backend's detailed failure reason, rather
  than only a generic "Install failed" label.

Unit tests cover Linux/user/architecture command selection, trusted core URL
selection, ELF validation, unexpected archive paths, atomic publication,
idempotent retry, and preservation of existing user files. No Flatpak package or
real core was installed on the Windows development host. Actual Linux Flatpak
and gameplay acceptance must be recorded separately before claiming it tested.

## Opt-in native Linux provisioning smoke

`scripts/qa-linux-retroarch-provisioning.ts` runs only for a non-root Linux
GitHub Actions user with `CI=true`, `GITHUB_ACTIONS=true`, and explicit
`GAMEHUB_LINUX_RETROARCH_QA=1`. It refuses Windows and ordinary user sessions
before installing anything.

Install CI prerequisites in the workflow, not in the harness:

```sh
sudo apt-get update
sudo apt-get install -y flatpak p7zip-full dbus-x11 xvfb libgl1-mesa-dri
```

Then run after the repository's regular Node dependencies are installed:

```sh
GAMEHUB_LINUX_RETROARCH_QA=1 xvfb-run -a dbus-run-session -- \
  node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.web.json \
  scripts/qa-linux-retroarch-provisioning.ts
```

Use a separate optional job with at least 25 minutes available. The smoke has a
20-minute deadline and targets only its own detached process group on timeout.
It creates fresh HOME/XDG/Flatpak directories in a child-only environment; the
parent's HOME and environment are not modified. Ownership markers and resolved
paths are checked before cleanup. Existing user Flatpak data is never reset,
uninstalled, copied, or deleted.

The actual provisioner performs the user installation and core preparation,
using the system 7-Zip CLI as its archive adapter. The smoke then verifies the
installed Flatpak origin/ref, all eight expected core paths and ELF headers,
and executes the installed application's `--version` inside its ordinary
Flatpak sandbox. It uses no ROMs, BIOS, accounts, or permission overrides.

Evidence is written to
`artifacts/linux-retroarch-provisioning/<timestamp>/provisioning-report.json`,
including setup steps even after failure. Upload that directory with
`if: always()` in CI. Namespace, D-Bus, network, or runtime denials are reported
as `external-runtime-blocked` with a failing exit code; the smoke must not
disable AppArmor, adjust namespace sysctls, or add sandbox bypass flags to make
them pass. A timeout preserves its isolated CI directory rather than deleting
files while an external helper might still be finishing.

Sources checked for this implementation:
[Flatpak user installation and flatpakrefs](https://docs.flatpak.org/en/latest/using-flatpak.html),
[official RetroArch Flatpak manifest](https://github.com/flathub/org.libretro.RetroArch/blob/master/org.libretro.RetroArch.json),
[Libretro Linux buildbot](https://buildbot.libretro.com/nightly/linux/x86_64/latest/),
and [Libretro AArch64 buildbot](https://buildbot.libretro.com/nightly/linux/aarch64/latest/).
