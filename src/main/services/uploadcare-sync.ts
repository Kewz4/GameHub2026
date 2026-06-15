/**
 * Compatibility shim. Cloud saves and profile images moved from Uploadcare to
 * Cloudflare R2 (see r2-sync.ts). The old `UploadcareSync` name is preserved as
 * an alias so every existing import keeps working without churn.
 */
export { R2Sync, R2Sync as UploadcareSync } from "./r2-sync";
