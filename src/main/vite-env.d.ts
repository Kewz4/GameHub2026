/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_API_URL: string;
  readonly MAIN_VITE_ANALYTICS_API_URL: string;
  readonly MAIN_VITE_AUTH_URL: string;
  readonly MAIN_VITE_CHECKOUT_URL: string;
  readonly MAIN_VITE_EXTERNAL_RESOURCES_URL: string;
  readonly MAIN_VITE_WS_URL: string;
  readonly MAIN_VITE_NIMBUS_API_URL: string;
  readonly MAIN_VITE_LAUNCHER_SUBDOMAIN: string;
  /** Read-only GitHub token (fine-grained, Contents:read on this repo) injected
   *  at build time so the auto-updater can read releases + download assets from
   *  the PRIVATE release repo. Absent in local/dev builds. */
  readonly MAIN_VITE_UPDATER_GH_TOKEN?: string;
  readonly ELECTRON_RENDERER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
