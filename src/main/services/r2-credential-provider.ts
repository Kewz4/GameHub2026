export interface R2CredentialIdentity {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

interface BrokerCredentialPayload {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: string;
}

export interface R2CredentialProviderOptions {
  credentialsUrl: string;
  getBearerToken: () => Promise<string>;
  getLegacyNamespaceIds?: () => Promise<string[]>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export interface InvalidatableR2CredentialProvider {
  (): Promise<R2CredentialIdentity>;
  invalidate(): void;
}

const MIN_REMAINING_LIFETIME_MS = 30_000;
const MAX_CREDENTIAL_LIFETIME_MS = 60 * 60 * 1_000;
const MAX_CACHE_LIFETIME_MS = 10 * 60 * 1_000;
const REFRESH_SKEW_MS = 60_000;
const LEGACY_NAMESPACE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LEGACY_NAMESPACES = 4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertCredentialField = (
  payload: Record<string, unknown>,
  field: keyof BrokerCredentialPayload,
  minimumLength: number,
  maximumLength: number
) => {
  const value = payload[field];
  if (
    typeof value !== "string" ||
    value.length < minimumLength ||
    value.length > maximumLength
  ) {
    throw new Error("r2_credentials_broker_invalid_response");
  }
  return value;
};

export const validateR2BrokerCredentialPayload = (
  value: unknown,
  now = Date.now()
): { credentials: R2CredentialIdentity; expiresAtMs: number } => {
  if (!isRecord(value)) {
    throw new Error("r2_credentials_broker_invalid_response");
  }

  const allowedKeys = new Set([
    "accessKeyId",
    "secretAccessKey",
    "sessionToken",
    "expiresAt",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("r2_credentials_broker_invalid_response");
  }

  const accessKeyId = assertCredentialField(value, "accessKeyId", 16, 256);
  const secretAccessKey = assertCredentialField(
    value,
    "secretAccessKey",
    16,
    1_024
  );
  const sessionToken = assertCredentialField(value, "sessionToken", 16, 16_384);
  const expiresAt = assertCredentialField(value, "expiresAt", 20, 64);
  const expiresAtMs = Date.parse(expiresAt);

  if (
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs - now < MIN_REMAINING_LIFETIME_MS ||
    expiresAtMs - now > MAX_CREDENTIAL_LIFETIME_MS
  ) {
    throw new Error("r2_credentials_broker_invalid_expiry");
  }

  return {
    credentials: {
      accessKeyId,
      secretAccessKey,
      sessionToken,
      expiration: new Date(expiresAtMs),
    },
    expiresAtMs,
  };
};

const validateBrokerUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("r2_credentials_broker_invalid_url");
  }

  const isLocalDevelopment =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !isLocalDevelopment) {
    throw new Error("r2_credentials_broker_requires_https");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("r2_credentials_broker_invalid_url");
  }
  return url.toString();
};

/**
 * Build an AWS-compatible async credential provider backed by the trusted
 * GameHub credential broker. The response is validated before it enters the
 * SDK and cached only until shortly before its short-lived expiry.
 */
export const createCachedBrokerR2CredentialProvider = (
  options: R2CredentialProviderOptions
): InvalidatableR2CredentialProvider => {
  const credentialsUrl = validateBrokerUrl(options.credentialsUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 15_000;

  let cached:
    | {
        bearerToken: string;
        credentials: R2CredentialIdentity;
        refreshAfterMs: number;
      }
    | undefined;
  let inFlight:
    | { bearerToken: string; promise: Promise<R2CredentialIdentity> }
    | undefined;
  let generation = 0;

  const refresh = async (bearerToken: string, refreshGeneration: number) => {
    const legacyNamespaceIds = [
      ...new Set((await options.getLegacyNamespaceIds?.()) ?? []),
    ];
    if (
      legacyNamespaceIds.length > MAX_LEGACY_NAMESPACES ||
      legacyNamespaceIds.some(
        (namespaceId) => !LEGACY_NAMESPACE_PATTERN.test(namespaceId)
      )
    ) {
      throw new Error("r2_credentials_broker_invalid_legacy_namespace");
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);
    try {
      const response = await fetchImpl(credentialsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Accept: "application/json",
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ legacyNamespaceIds }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`r2_credentials_broker_http_${response.status}`);
      }

      const contentLength = Number(response.headers.get("Content-Length"));
      if (Number.isFinite(contentLength) && contentLength > 64 * 1_024) {
        throw new Error("r2_credentials_broker_invalid_response");
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("r2_credentials_broker_invalid_response");
      }

      const requestedAt = now();
      const validated = validateR2BrokerCredentialPayload(payload, requestedAt);
      if (refreshGeneration === generation) {
        cached = {
          bearerToken,
          credentials: validated.credentials,
          refreshAfterMs: Math.min(
            validated.expiresAtMs - REFRESH_SKEW_MS,
            requestedAt + MAX_CACHE_LIFETIME_MS
          ),
        };
      }
      return validated.credentials;
    } finally {
      clearTimeout(timeout);
    }
  };

  const provider = async () => {
    // Always consult the current Hydra session before serving a cached
    // capability. Otherwise sign-out/account switches can reuse the previous
    // account's still-valid R2 credential until its cache timer expires.
    const bearerToken = await options.getBearerToken();
    if (!bearerToken || bearerToken.length > 16_384) {
      throw new Error("r2_credentials_broker_requires_login");
    }

    if (cached?.bearerToken === bearerToken && now() < cached.refreshAfterMs) {
      return cached.credentials;
    }
    if (inFlight?.bearerToken === bearerToken) return inFlight.promise;

    generation += 1;
    cached = undefined;
    const refreshGeneration = generation;
    const promise = refresh(bearerToken, refreshGeneration).finally(() => {
      if (inFlight?.promise === promise) inFlight = undefined;
    });
    inFlight = { bearerToken, promise };
    return promise;
  };

  provider.invalidate = () => {
    generation += 1;
    cached = undefined;
    inFlight = undefined;
  };
  return provider;
};
