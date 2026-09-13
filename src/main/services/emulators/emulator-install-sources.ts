import axios from "axios";

import type {
  EmulatorBinary,
  EmulatorInstallKind,
  ResolvedInstallOption,
} from "@types";
import { logger } from "../logger";
import { KNOWN_BINARIES, primarySystemForBinary } from "./known-binaries";
import type { EmulatorInstallSource } from "./known-binaries";
import {
  RETROARCH_FLATPAK_OPTION_ID,
  RETROARCH_FLATPAK_REF,
} from "./linux-retroarch-provisioner";

const isWindows = process.platform === "win32";
const isLinux = process.platform === "linux";

/**
 * Per-binary cache of resolved install options. The emulation settings page
 * resolves options for every emulator (9+ binaries) on each visit; without a
 * cache that is 9+ unauthenticated GitHub API calls per page view, which
 * quickly trips GitHub's 60-requests/hour limit and makes EVERY emulator fall
 * back to "open the releases page". We cache successful resolutions for a few
 * hours and, on a later rate-limit/network failure, keep serving the last good
 * result instead of regressing to a link.
 */
const OPTIONS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const optionsCache = new Map<
  EmulatorBinary,
  { at: number; options: ResolvedInstallOption[] }
>();

interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  prerelease: boolean;
  assets: GithubAsset[];
}

// Assets that match a build pattern but are NOT the runnable emulator: debug
// symbols, libretro cores (a single DLL/so), source tarballs, checksums, and
// zsync deltas. When a pattern matches several assets we drop these first so a
// loose pattern never resolves to "one file" junk.
const JUNK_ASSET_RE =
  /(symbols|libretro|source|\.sha\d|\.zsync$|debuginfo|-pdb)/i;

const matchAsset = (
  assets: GithubAsset[],
  pattern: string | undefined
): GithubAsset | null => {
  if (!pattern) return null;
  const regex = new RegExp(pattern, "i");
  const matches = assets.filter((asset) => regex.test(asset.name));
  if (matches.length === 0) return null;
  // Prefer a non-junk asset; only fall back to a junk match if that is all
  // the pattern produced.
  return matches.find((a) => !JUNK_ASSET_RE.test(a.name)) ?? matches[0];
};

const kindForAsset = (assetName: string): EmulatorInstallKind => {
  const lower = assetName.toLowerCase();
  if (lower.endsWith(".appimage")) return "linux-appimage";
  if (lower.endsWith(".exe")) return "windows-installer";
  return "windows-archive";
};

/**
 * A vendor-hosted, fixed direct-download archive (e.g. RALibretro's
 * retroachievements.org/bin zip). Bypasses the GitHub API entirely.
 */
const resolveDirectOption = (
  binary: EmulatorBinary,
  source: EmulatorInstallSource
): ResolvedInstallOption | null => {
  if (!source.directDownloadUrl || !isWindows) return null;
  const fileName = source.directDownloadUrl.split("/").pop() || `${binary}.zip`;
  return {
    id: `${binary}-direct`,
    binary,
    kind: kindForAsset(fileName),
    channel: "release",
    downloadUrl: source.directDownloadUrl,
    fileName,
    version: null,
    htmlUrl: null,
    linkUrl: null,
    linkKind: null,
  };
};

/**
 * Resolve the latest GitHub release asset matching the current OS for a binary.
 * Returns null when the repo has no matching asset (callers fall back to a link).
 */
const resolveGithubOption = async (
  binary: EmulatorBinary,
  source: EmulatorInstallSource
): Promise<ResolvedInstallOption | null> => {
  if (!source.githubRepo) return null;

  const pattern = isWindows
    ? source.windowsAssetPattern
    : source.linuxAssetPattern;
  if (!pattern) return null;

  try {
    const { data } = await axios.get<GithubRelease>(
      `https://api.github.com/repos/${source.githubRepo}/releases/latest`,
      {
        timeout: 15_000,
        headers: {
          Accept: "application/vnd.github+json",
          // GitHub rejects API requests with no User-Agent.
          "User-Agent": "GameHub-Launcher",
        },
      }
    );

    const asset = matchAsset(data.assets, pattern);
    if (!asset) return null;

    return {
      id: `${binary}-github-${data.tag_name}`,
      binary,
      kind: kindForAsset(asset.name),
      channel: data.prerelease ? "prerelease" : "release",
      downloadUrl: asset.browser_download_url,
      fileName: asset.name,
      version: data.tag_name,
      htmlUrl: data.html_url,
      linkUrl: null,
      linkKind: null,
    };
  } catch (err) {
    logger.warn(`Emulator install: GitHub lookup failed for ${binary}`, err);
    return null;
  }
};

const linkOption = (
  binary: EmulatorBinary,
  source: EmulatorInstallSource
): ResolvedInstallOption[] => {
  const options: ResolvedInstallOption[] = [];

  if (isLinux && source.flatpakInstallId) {
    options.push({
      id: `${binary}-flatpak`,
      binary,
      kind: "link",
      channel: null,
      downloadUrl: null,
      fileName: null,
      version: null,
      htmlUrl: null,
      linkUrl: `https://flathub.org/apps/${source.flatpakInstallId}`,
      linkKind: "flatpak",
    });
  }

  if (source.releasePageUrl) {
    options.push({
      id: `${binary}-release-page`,
      binary,
      kind: "link",
      channel: null,
      downloadUrl: null,
      fileName: null,
      version: null,
      htmlUrl: null,
      linkUrl: source.releasePageUrl,
      linkKind: "release_page",
    });
  }

  return options;
};

/** Build the install options offered for an emulator binary. */
export const getEmulatorInstallOptions = async (
  binary: EmulatorBinary
): Promise<ResolvedInstallOption[]> => {
  const primarySystem = primarySystemForBinary(binary);
  // No system currently maps to this binary (a stale config from before a
  // registry change, e.g. old "raproject64"/"ravba" entries now served by
  // RALibretro). There is nothing valid to install under this name — return
  // no options rather than silently resolving a different binary's source.
  if (!primarySystem) {
    logger.warn(`No system maps to emulator binary "${binary}" — orphaned`);
    return [];
  }
  const source = KNOWN_BINARIES[primarySystem].install;

  // Serve a fresh cached result without touching the API.
  const cached = optionsCache.get(binary);
  if (cached && Date.now() - cached.at < OPTIONS_CACHE_TTL_MS) {
    return cached.options;
  }

  const options: ResolvedInstallOption[] = [];

  // A fixed vendor URL (RALibretro) wins over the GitHub API path.
  if (isLinux && binary === "ralibretro") {
    options.push({
      id: RETROARCH_FLATPAK_OPTION_ID,
      binary,
      kind: "linux-flatpak",
      channel: "release",
      downloadUrl: RETROARCH_FLATPAK_REF,
      fileName: null,
      version: null,
      htmlUrl: "https://flathub.org/apps/org.libretro.RetroArch",
      linkUrl: null,
      linkKind: "flatpak",
    });
  }
  const direct =
    resolveDirectOption(binary, source) ??
    (await resolveGithubOption(binary, source));
  if (direct) options.push(direct);

  options.push(...linkOption(binary, source));

  // Only cache a result that actually has a direct download — if the lookup
  // failed (rate-limited/offline) and we previously had a good result, keep
  // serving that instead of caching the link-only fallback.
  const hasDirect = options.some((o) => o.kind !== "link");
  if (hasDirect) {
    optionsCache.set(binary, { at: Date.now(), options });
  } else if (cached) {
    return cached.options;
  }

  return options;
};

/** Resolve a single option by id (used by the installer to find the URL). */
export const resolveInstallOptionById = async (
  binary: EmulatorBinary,
  optionId: string
): Promise<ResolvedInstallOption | null> => {
  const options = await getEmulatorInstallOptions(binary);
  return options.find((option) => option.id === optionId) ?? null;
};
