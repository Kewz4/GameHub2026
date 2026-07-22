export interface SteamGenre {
  id: string;
  name: string;
}

export interface SteamScreenshot {
  id: number;
  path_thumbnail: string;
  path_full: string;
}

export interface SteamVideoSource {
  max: string;
  "480": string;
}

export interface SteamMovie {
  id: number;
  dash_av1?: string;
  dash_h264?: string;
  hls_h264?: string;
  mp4?: SteamVideoSource;
  webm?: SteamVideoSource;
  thumbnail: string;
  name: string;
  highlight: boolean;
}

export interface SteamAppDetails {
  name: string;
  steam_appid: number;
  detailed_description: string;
  about_the_game: string;
  short_description: string;
  developers: string[];
  publishers: string[];
  genres: SteamGenre[];
  movies?: SteamMovie[];
  supported_languages: string;
  screenshots?: SteamScreenshot[];
  pc_requirements: {
    minimum: string;
    recommended: string;
  };
  mac_requirements: {
    minimum: string;
    recommended: string;
  };
  linux_requirements: {
    minimum: string;
    recommended: string;
  };
  release_date: {
    coming_soon: boolean;
    date: string;
  };
  /** Minimum age Steam gates the store page behind (0 when ungated). */
  required_age?: number | string;
  /**
   * Per-agency age ratings Steam returns for the `cc`/region requested (only
   * populated for some games/regions). Agency keys vary (esrb, pegi, usk, oflc,
   * dejus, steam_germany, …); each carries at least a `rating` code.
   */
  ratings?: Record<
    string,
    {
      rating?: string;
      descriptors?: string;
      required_age?: string;
      use_age_gate?: string;
    }
  >;
  content_descriptors: {
    ids: number[];
    /** Free-text mature-content notes, when present. */
    notes?: string | null;
  };
}

export interface SteamShortcut {
  appid: number;
  appname: string;
  Exe: string;
  StartDir: string;
  icon: string;
  ShortcutPath: string;
  LaunchOptions: string;
  IsHidden: boolean;
  AllowDesktopConfig: boolean;
  AllowOverlay: boolean;
  OpenVR: boolean;
  Devkit: boolean;
  DevkitGameID: string;
  DevkitOverrideAppID: boolean;
  LastPlayTime: number;
  FlatpakAppID: string;
}

export interface CreateSteamShortcutOptions {
  openVr?: boolean;
}
