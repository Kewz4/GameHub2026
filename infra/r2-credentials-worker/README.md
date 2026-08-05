# GameHub R2 credential broker

This Worker keeps the parent R2 credential out of GameHub builds. It validates
the launcher's current Hydra bearer against `GET /profile/me`, then locally
signs a 15-minute `object-read-write` R2 temporary credential restricted to
that Hydra user's `users/{id}/` prefix. Only explicitly allowlisted Hydra
profile IDs may mint credentials, and Cloudflare's Rate Limiting binding
applies a separate credential quota to each allowed profile. Shared objects,
including `shared/exophase-cache.json`, are never included in a desktop
credential.

Upgrades from older GameHub builds may present their previous random namespace
UUID. The Worker atomically claims that UUID for the authenticated account in
the bound R2 bucket before adding the legacy prefix to the temporary
credential. A UUID already claimed by another account is never granted. The
desktop keeps using the old namespace until every object has been copied and
verified under the account namespace, so interrupted migrations are safe to
retry.

## Deploy

1. Revoke and replace every parent R2 token that has ever been committed to or
   shipped with GameHub. Removing a value from the current source does not
   remove it from Git history or existing installers.
2. In Cloudflare, create a parent R2 token with Object Read & Write access to
   the `gamehub` bucket only. Keep its S3 access-key ID and secret access key in
   a password manager; never put either value in this repository or a GitHub
   build secret. The Worker uses Cloudflare's documented local JWT signing
   flow, so it does not need a general Cloudflare API bearer token.
3. In GameHub's Friends window, click the friend code shown beside each
   allowlisted person's profile name to copy their Hydra profile ID. Copy
   `wrangler.toml.example` to the ignored `wrangler.toml`, then replace
   `ALLOWED_HYDRA_PROFILE_IDS` with the comma-separated IDs for you and the
   friends who may use this bucket. Do not use display names, `*`, or a blank
   value. Set the account ID, Hydra API URL, bucket, and `GAMEHUB_BUCKET` R2
   binding too.
4. Choose a positive integer `namespace_id` that is unique among rate-limit
   bindings in your Cloudflare account. The example allows six credential
   mints per profile per minute. The desktop normally renews only once per
   credential lifetime, so this leaves recovery headroom without exposing an
   unbounded mint endpoint. Keep the binding in production: readiness fails
   closed when either the allowlist or rate limiter is missing or malformed.
5. Install dependencies and deploy:

   ```powershell
   Copy-Item wrangler.toml.example wrangler.toml
   npm install
   npx wrangler login
   npx wrangler secret put R2_PARENT_ACCESS_KEY_ID
   npx wrangler secret put R2_PARENT_SECRET_ACCESS_KEY
   npm run deploy
   ```

6. Test `GET https://<worker-host>/health`, then set these GitHub Actions
   repository variables before building a release:
   - `MAIN_VITE_R2_CREDENTIALS_URL` =
     `https://<worker-host>/v1/r2/credentials`
   - `MAIN_VITE_R2_ENDPOINT` = the account's R2 S3 endpoint
   - `MAIN_VITE_R2_BUCKET` = `gamehub`

7. Build a signed-in test client and verify upload, list, download, conflict,
   and deletion recovery. A signed-out production client intentionally cannot
   mint R2 credentials. For local development only, the main process also
   accepts `GAMEHUB_R2_ACCESS_KEY_ID`, `GAMEHUB_R2_SECRET_ACCESS_KEY`, and an
   optional `GAMEHUB_R2_SESSION_TOKEN` from the shell environment.

The Worker response and launcher request both use `Cache-Control: no-store`.
The in-Worker quota is keyed by a SHA-256 hash of the verified Hydra profile ID;
the profile ID and bearer are never used as counter keys or logged. The binding
limits credential mints after successful authentication. Add a separate
Cloudflare rate-limiting rule for the public route if you also need to limit
invalid-token traffic before it reaches Hydra, and monitor 401/403/429/503 rates
without logging authorization headers or response bodies.

Cloudflare reference:
[Temporary R2 credentials](https://developers.cloudflare.com/r2/api/s3/temporary-credentials/).
[R2 conditional operations](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations).
[Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
