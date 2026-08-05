interface Env {
  HYDRA_API_URL: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  R2_BUCKET: string;
  CREDENTIAL_TTL_SECONDS?: string;
  ALLOWED_HYDRA_PROFILE_IDS: string;
  R2_PARENT_ACCESS_KEY_ID: string;
  R2_PARENT_SECRET_ACCESS_KEY: string;
  CREDENTIAL_RATE_LIMITER: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  GAMEHUB_BUCKET: {
    get(key: string): Promise<{ text(): Promise<string> } | null>;
    put(
      key: string,
      value: string,
      options?: {
        onlyIf?: Headers;
        httpMetadata?: { contentType?: string; cacheControl?: string };
      }
    ): Promise<unknown | null>;
  };
}

interface NamespaceClaim {
  schemaVersion: 1;
  accountHash: string;
  legacyNamespaceHash: string;
  claimedAt: string;
}

const LEGACY_NAMESPACE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LEGACY_NAMESPACES = 4;
const MAX_REQUEST_BODY_BYTES = 2_048;
const MAX_ALLOWED_PROFILE_IDS = 128;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });

const readBearer = (request: Request) => {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match || match[1].length > 16_384) return null;
  return match[1];
};

const getCredentialTtlSeconds = (value: string | undefined) => {
  const parsed = Number(value ?? "900");
  if (!Number.isInteger(parsed) || parsed < 300 || parsed > 1_800) {
    throw new Error("invalid_credential_ttl");
  }
  return parsed;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const hasControlCharacters = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

const getAllowedHydraProfileIds = (value: string | undefined) => {
  if (!isNonEmptyString(value)) {
    throw new Error("missing_hydra_profile_allowlist");
  }

  const values = value.split(",").map((profileId) => profileId.trim());
  if (
    values.length > MAX_ALLOWED_PROFILE_IDS ||
    values.some(
      (profileId) =>
        profileId.length === 0 ||
        profileId.length > 512 ||
        hasControlCharacters(profileId)
    )
  ) {
    throw new Error("invalid_hydra_profile_allowlist");
  }

  return new Set(values);
};

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const readLegacyNamespaceIds = async (request: Request) => {
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_REQUEST_BODY_BYTES
  ) {
    throw new Error("request_too_large");
  }

  const text = await request.text();
  if (text.length > MAX_REQUEST_BODY_BYTES) {
    throw new Error("request_too_large");
  }
  if (!text) return [];

  const payload = JSON.parse(text) as unknown;
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    Object.keys(payload).some((key) => key !== "legacyNamespaceIds")
  ) {
    throw new Error("invalid_request");
  }
  const values = (payload as { legacyNamespaceIds?: unknown })
    .legacyNamespaceIds;
  if (values === undefined) return [];
  if (
    !Array.isArray(values) ||
    values.length > MAX_LEGACY_NAMESPACES ||
    values.some(
      (value) =>
        typeof value !== "string" || !LEGACY_NAMESPACE_PATTERN.test(value)
    )
  ) {
    throw new Error("invalid_legacy_namespace");
  }
  return [...new Set(values as string[])];
};

const readNamespaceClaim = async (env: Env, claimKey: string) => {
  const object = await env.GAMEHUB_BUCKET.get(claimKey);
  if (!object) return null;
  const claim = JSON.parse(await object.text()) as Partial<NamespaceClaim>;
  if (
    claim.schemaVersion !== 1 ||
    !/^[a-f0-9]{64}$/.test(claim.accountHash ?? "") ||
    !/^[a-f0-9]{64}$/.test(claim.legacyNamespaceHash ?? "")
  ) {
    throw new Error("legacy_namespace_claim_invalid");
  }
  return claim as NamespaceClaim;
};

/**
 * Bind each high-entropy legacy UUID to exactly one authenticated account.
 * R2's conditional PUT makes concurrent first claims atomic; a losing request
 * re-reads the winner and may proceed only for the same account.
 */
const claimLegacyNamespaces = async (
  env: Env,
  profileId: string,
  legacyNamespaceIds: readonly string[]
) => {
  const accountHash = await sha256(profileId);
  const claimed: string[] = [];

  for (const legacyNamespaceId of legacyNamespaceIds) {
    const legacyNamespaceHash = await sha256(legacyNamespaceId);
    const claimKey = `system/namespace-claims/v1/${legacyNamespaceHash}.json`;
    let existing = await readNamespaceClaim(env, claimKey);

    if (!existing) {
      const claim: NamespaceClaim = {
        schemaVersion: 1,
        accountHash,
        legacyNamespaceHash,
        claimedAt: new Date().toISOString(),
      };
      const created = await env.GAMEHUB_BUCKET.put(
        claimKey,
        JSON.stringify(claim),
        {
          onlyIf: new Headers({ "If-None-Match": "*" }),
          httpMetadata: {
            contentType: "application/json",
            cacheControl: "no-store, max-age=0",
          },
        }
      );
      existing = created ? claim : await readNamespaceClaim(env, claimKey);
    }

    if (
      !existing ||
      existing.accountHash !== accountHash ||
      existing.legacyNamespaceHash !== legacyNamespaceHash
    ) {
      throw new Error("legacy_namespace_already_claimed");
    }
    claimed.push(legacyNamespaceId);
  }

  return claimed;
};

const validateConfiguration = (env: Env) => {
  const apiUrl = new URL(env.HYDRA_API_URL);
  if (apiUrl.protocol !== "https:") throw new Error("invalid_hydra_api_url");
  if (!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID)) {
    throw new Error("invalid_cloudflare_account_id");
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,62}[a-z0-9]$/.test(env.R2_BUCKET)) {
    throw new Error("invalid_r2_bucket");
  }
  if (
    !isNonEmptyString(env.R2_PARENT_ACCESS_KEY_ID) ||
    !isNonEmptyString(env.R2_PARENT_SECRET_ACCESS_KEY)
  ) {
    throw new Error("missing_cloudflare_credentials");
  }
  getAllowedHydraProfileIds(env.ALLOWED_HYDRA_PROFILE_IDS);
  if (
    !env.CREDENTIAL_RATE_LIMITER ||
    typeof env.CREDENTIAL_RATE_LIMITER.limit !== "function"
  ) {
    throw new Error("missing_credential_rate_limiter");
  }
};

const verifyHydraProfile = async (env: Env, bearerToken: string) => {
  const profileUrl = `${env.HYDRA_API_URL.replace(/\/+$/, "")}/profile/me`;
  const response = await fetch(profileUrl, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: "application/json",
      "Cache-Control": "no-store",
    },
  });

  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error("hydra_profile_unavailable");

  const profile = (await response.json()) as { id?: unknown };
  if (
    typeof profile.id !== "string" ||
    profile.id.length === 0 ||
    profile.id.length > 512
  ) {
    throw new Error("hydra_profile_invalid");
  }
  return profile.id;
};

const mintCredentials = async (
  env: Env,
  profileId: string,
  claimedLegacyNamespaceIds: readonly string[],
  ttlSeconds: number
) => {
  const prefixes = [
    `users/${encodeURIComponent(profileId)}/`,
    ...claimedLegacyNamespaceIds.map(
      (namespaceId) => `users/${encodeURIComponent(namespaceId)}/`
    ),
  ];

  const nowSeconds = Math.floor(Date.now() / 1_000);
  const endpoint = `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const encoder = new TextEncoder();
  const base64Url = (value: Uint8Array | string) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/g, "");
  };
  const jwtHeader = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const jwtPayload = base64Url(
    JSON.stringify({
      bucket: env.R2_BUCKET,
      scope: "object-read-write",
      paths: { prefixPaths: prefixes, objectPaths: [] },
      sub: env.CLOUDFLARE_ACCOUNT_ID,
      iss: env.R2_PARENT_ACCESS_KEY_ID,
      aud: new URL(endpoint).host,
      iat: nowSeconds,
      exp: nowSeconds + ttlSeconds,
    })
  );
  const signingInput = `${jwtHeader}.${jwtPayload}`;
  const signingKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.R2_PARENT_SECRET_ACCESS_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", signingKey, encoder.encode(signingInput))
  );
  const jwt = `${signingInput}.${base64Url(signature)}`;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(jwt))
  );
  const secretAccessKey = Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return {
    accessKeyId: env.R2_PARENT_ACCESS_KEY_ID,
    secretAccessKey,
    sessionToken: btoa(`jwt/${jwt}`),
  };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      try {
        validateConfiguration(env);
        getCredentialTtlSeconds(env.CREDENTIAL_TTL_SECONDS);
        return json({ ok: true }, 200);
      } catch {
        // Readiness is intentionally coarse: callers may learn that the
        // service is not configured, but never which secret or value is
        // missing. Release CI uses this to avoid publishing a cloud-save build
        // whose public endpoint cannot mint credentials.
        return json({ ok: false }, 503);
      }
    }
    if (request.method !== "POST" || url.pathname !== "/v1/r2/credentials") {
      return json({ error: "not_found" }, 404);
    }

    const bearerToken = readBearer(request);
    if (!bearerToken) return json({ error: "unauthorized" }, 401);

    try {
      validateConfiguration(env);
      const ttlSeconds = getCredentialTtlSeconds(env.CREDENTIAL_TTL_SECONDS);
      const allowedProfileIds = getAllowedHydraProfileIds(
        env.ALLOWED_HYDRA_PROFILE_IDS
      );
      const mintedAt = Date.now();
      const profileId = await verifyHydraProfile(env, bearerToken);
      if (!profileId) return json({ error: "unauthorized" }, 401);
      if (!allowedProfileIds.has(profileId)) {
        return json({ error: "forbidden" }, 403);
      }

      const rateLimitResult = await env.CREDENTIAL_RATE_LIMITER.limit({
        key: `r2-credentials:${await sha256(profileId)}`,
      });
      if (typeof rateLimitResult?.success !== "boolean") {
        throw new Error("credential_rate_limiter_invalid");
      }
      if (!rateLimitResult.success) {
        return json({ error: "rate_limited" }, 429);
      }

      const requestedLegacyNamespaceIds = await readLegacyNamespaceIds(request);
      const claimedLegacyNamespaceIds = await claimLegacyNamespaces(
        env,
        profileId,
        requestedLegacyNamespaceIds
      );

      const credentials = await mintCredentials(
        env,
        profileId,
        claimedLegacyNamespaceIds,
        ttlSeconds
      );
      return json(
        {
          ...credentials,
          expiresAt: new Date(mintedAt + ttlSeconds * 1_000).toISOString(),
        },
        200
      );
    } catch {
      // No upstream body, bearer, or credential value is ever reflected or
      // logged. Operational detail belongs in Cloudflare metrics, not logs.
      return json({ error: "credential_service_unavailable" }, 503);
    }
  },
};
