import {
  ptBR,
  enUS,
  es,
  fr,
  pl,
  hu,
  tr,
  ru,
  it,
  be,
  zhCN,
  da,
} from "date-fns/locale";

import { charMap } from "./char-map";
import { isArchiveOrgFileUri } from "./archive-org";
import { isBzzhrUri } from "./bzzhr-url";
import { Downloader } from "./constants";
import { format } from "date-fns";
import { AchievementNotificationInfo } from "@types";

export * from "./constants";
export * from "./archive-org";
export * from "./controller-support";
export * from "./overlay-preferences";
export * from "./game-recorder-preferences";
export * from "./game-recorder-quality";
export * from "./fragmented-mp4";
export * from "./download-directories";
export * from "./custom-download";
export * from "./bzzhr-url";
export * from "./steam-emulator-policy";
export * from "./profile-images";
export * from "./html-sanitizer";
export * from "./language-flags";
export * from "./supported-languages";
export * from "./use-hls-video";
export * from "./tracker-list";
export * from "./path-presentation";

export class UserNotLoggedInError extends Error {
  constructor() {
    super("user not logged in");
    this.name = "UserNotLoggedInError";
  }
}

export class SubscriptionRequiredError extends Error {
  constructor() {
    super("user does not have hydra cloud subscription");
    this.name = "SubscriptionRequiredError";
  }
}

const FORMAT = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || isNaN(bytes) || bytes <= 0) {
    return `0 ${FORMAT[0]}`;
  }

  const byteKBase = 1024;

  const base = Math.floor(Math.log(bytes) / Math.log(byteKBase));

  const formatedByte = bytes / byteKBase ** base;

  return `${Math.trunc(formatedByte * 10) / 10} ${FORMAT[base]}`;
};

export const parseBytes = (sizeString: string | null): number | null => {
  if (!sizeString) return null;

  const regex = /^([\d.,]+)\s*([A-Za-z]+)$/;
  const match = regex.exec(sizeString.trim());
  if (!match) return null;

  const value = Number.parseFloat(match[1].replaceAll(",", "."));
  const unit = match[2].toUpperCase();

  if (Number.isNaN(value)) return null;

  const unitIndex = FORMAT.indexOf(unit);
  if (unitIndex === -1) return null;

  const byteKBase = 1024;
  return Math.round(value * Math.pow(byteKBase, unitIndex));
};

export const formatBytesToMbps = (bytesPerSecond: number): string => {
  const bitsPerSecond = bytesPerSecond * 8;
  const mbps = bitsPerSecond / 1e6;
  return `${Math.trunc(mbps * 10) / 10} Mbps`;
};

export const pipe =
  <T>(...fns: ((arg: T) => any)[]) =>
  (arg: T) =>
    fns.reduce((prev, fn) => fn(prev), arg);

export const removeReleaseYearFromName = (name: string) =>
  name.replace(/\(\d{4}\)/g, "");

export const removeSymbolsFromName = (name: string) =>
  name.replace(/[^A-Za-z 0-9]/g, "");

export const removeSpecialEditionFromName = (name: string) =>
  name.replace(
    /(The |Digital )?(GOTY|Deluxe|Standard|Ultimate|Definitive|Enhanced|Collector's|Premium|Digital|Limited|Game of the Year|Reloaded|[0-9]{4}) Edition/gi,
    ""
  );

export const removeDuplicateSpaces = (name: string) =>
  name.replace(/\s{2,}/g, " ");

export const replaceDotsWithSpace = (name: string) => name.replace(/\./g, " ");

export const replaceNbspWithSpace = (name: string) =>
  name.replace(new RegExp(String.fromCharCode(160), "g"), " ");

export const replaceUnderscoreWithSpace = (name: string) =>
  name.replace(/_/g, " ");

const charMapPattern = new RegExp(Object.keys(charMap).join("|"), "g");
const COMBINING_MARKS = /[\u0300-\u036f]/g;

export const removeDiacritics = (value: string) =>
  value
    .normalize("NFC")
    .replace(charMapPattern, (match) => charMap[match])
    .normalize("NFD")
    .replace(COMBINING_MARKS, "");

export const formatName = pipe<string>(
  (str) => str.replace(charMapPattern, (match) => charMap[match]),
  (str) => str.toLowerCase(),
  removeReleaseYearFromName,
  removeSpecialEditionFromName,
  replaceUnderscoreWithSpace,
  replaceDotsWithSpace,
  replaceNbspWithSpace,
  (str) => str.replace(/DIRECTOR'S CUT/gi, ""),
  (str) => str.replace(/Friend's Pass/gi, ""),
  removeSymbolsFromName,
  removeDuplicateSpaces,
  (str) => str.trim()
);

const realDebridHosts = ["https://1fichier.com", "https://mediafire.com"];

export const getDownloadersForUri = (uri: string) => {
  // TorBox can fetch any hoster link via its web-download API, so it's offered
  // for every URI type alongside the host's native downloader.
  if (uri.startsWith("https://gofile.io"))
    return [Downloader.Gofile, Downloader.TorBox];

  if (uri.startsWith("https://pixeldrain.com"))
    return [Downloader.PixelDrain, Downloader.TorBox];
  if (uri.startsWith("https://datanodes.to"))
    return [Downloader.Datanodes, Downloader.TorBox];
  if (uri.startsWith("https://www.mediafire.com"))
    return [Downloader.Mediafire, Downloader.TorBox];
  if (uri.startsWith("https://fuckingfast.co")) {
    return [Downloader.FuckingFast, Downloader.TorBox];
  }
  if (
    uri.startsWith("https://vikingfile.com") ||
    uri.startsWith("https://vik1ngfile.site")
  ) {
    return [Downloader.VikingFile, Downloader.TorBox];
  }
  if (uri.startsWith("https://www.rootz.so")) {
    return [Downloader.Rootz, Downloader.TorBox];
  }
  if (isArchiveOrgFileUri(uri)) {
    return [Downloader.ArchiveOrg, Downloader.TorBox];
  }
  if (isBzzhrUri(uri)) {
    return [Downloader.Bzzhr, Downloader.TorBox];
  }

  if (realDebridHosts.some((host) => uri.startsWith(host)))
    return [Downloader.RealDebrid, Downloader.TorBox];

  // Direct .torrent file link (Minerva collection torrents): only the native
  // torrent client can select ONE file out of the shared collection — debrid
  // services (incl. TorBox) treat torrents as all-or-nothing and their shared
  // caches routinely hold OTHER games' files from the same collection.
  if (/^https?:\/\/.+\.torrent(\?.*)?$/i.test(uri)) {
    return [Downloader.Torrent];
  }

  if (uri.startsWith("magnet:")) {
    return [
      Downloader.Torrent,
      Downloader.Hydra,
      Downloader.TorBox,
      Downloader.RealDebrid,
      Downloader.Premiumize,
      Downloader.AllDebrid,
    ];
  }

  // Any other http(s) link — TorBox can still fetch it as a web download.
  if (/^https?:\/\//i.test(uri)) return [Downloader.TorBox];

  return [];
};

export const getDownloadersForUris = (uris: string[]) => {
  const downloadersSet = uris.reduce<Set<Downloader>>((prev, next) => {
    const downloaders = getDownloadersForUri(next);
    downloaders.forEach((downloader) => prev.add(downloader));

    return prev;
  }, new Set());

  return Array.from(downloadersSet);
};

export const getDateLocale = (language: string) => {
  if (language.startsWith("pt")) return ptBR;
  if (language.startsWith("es")) return es;
  if (language.startsWith("fr")) return fr;
  if (language.startsWith("hu")) return hu;
  if (language.startsWith("pl")) return pl;
  if (language.startsWith("tr")) return tr;
  if (language.startsWith("ru")) return ru;
  if (language.startsWith("it")) return it;
  if (language.startsWith("be")) return be;
  if (language.startsWith("zh")) return zhCN;
  if (language.startsWith("da")) return da;

  return enUS;
};

export const getReviewTranslationLanguage = (language: string) =>
  language.split("-")[0].toLowerCase();

export const formatDate = (
  date: number | Date | string,
  language: string
): string => {
  if (isNaN(new Date(date).getDate())) return "N/A";
  return format(date, language == "en" ? "MM-dd-yyyy" : "dd/MM/yyyy");
};

export const generateAchievementCustomNotificationTest = (
  t: any,
  language?: string,
  options: { isHidden?: boolean; isRare?: boolean; isPlatinum?: boolean } = {}
): AchievementNotificationInfo => {
  return {
    title: t("test_achievement_notification_title", {
      ns: "notifications",
      lng: language ?? "en",
    }),
    description: t("test_achievement_notification_description", {
      ns: "notifications",
      lng: language ?? "en",
    }),
    iconUrl: "https://cdn.losbroxas.org/favicon.svg",
    points: 2440,
    isHidden: options.isHidden ?? false,
    isRare: options.isRare ?? false,
    isPlatinum: options.isPlatinum ?? false,
  };
};
export * from "./cloud-save-access";
export * from "./console-log";
export * from "./game-recorder-concat";
export * from "./metadata-credits";
