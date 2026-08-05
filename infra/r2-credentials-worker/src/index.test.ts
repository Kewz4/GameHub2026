import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, it } from "node:test";

import worker from "./index.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

class MemoryClaimBucket {
  private readonly values = new Map<string, string>();

  async get(key: string) {
    const value = this.values.get(key);
    return value === undefined ? null : { text: async () => value };
  }

  async put(key: string, value: string, options?: { onlyIf?: Headers }) {
    if (options?.onlyIf?.get("If-None-Match") === "*" && this.values.has(key)) {
      return null;
    }
    this.values.set(key, value);
    return {};
  }
}

const environment = (bucket: MemoryClaimBucket) => ({
  HYDRA_API_URL: "https://api.gamehub.test",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  R2_BUCKET: "gamehub",
  CREDENTIAL_TTL_SECONDS: "900",
  ALLOWED_HYDRA_PROFILE_IDS: "account-a, account-b",
  R2_PARENT_ACCESS_KEY_ID: "parent-access-key",
  R2_PARENT_SECRET_ACCESS_KEY: "parent-secret-key",
  CREDENTIAL_RATE_LIMITER: {
    limit: async () => ({ success: true }),
  },
  GAMEHUB_BUCKET: bucket,
});

const request = (account: string, legacyNamespaceId: string) =>
  new Request("https://credentials.gamehub.test/v1/r2/credentials", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ legacyNamespaceIds: [legacyNamespaceId] }),
  });

const installUpstreamMock = () => {
  const calls = { profile: 0 };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/profile/me")) {
      calls.profile += 1;
      const bearer = String(
        (init?.headers as Record<string, string>).Authorization
      );
      return Response.json({ id: bearer.replace("Bearer ", "") });
    }
    throw new Error(`Unexpected upstream request: ${url}`);
  };
  return calls;
};

interface CredentialResponse {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: string;
}

interface CredentialClaims {
  bucket: string;
  scope: string;
  paths: { prefixPaths: string[]; objectPaths: string[] };
  sub: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

const readCredentialResponse = async (response: Response) => {
  const credentials = (await response.json()) as CredentialResponse;
  assert.equal(credentials.accessKeyId, "parent-access-key");
  assert.match(credentials.secretAccessKey, /^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(credentials.expiresAt)));

  const token = Buffer.from(credentials.sessionToken, "base64").toString(
    "utf8"
  );
  assert.match(token, /^jwt\//);
  const jwt = token.slice(4);
  const parts = jwt.split(".");
  assert.equal(parts.length, 3);

  const header = JSON.parse(
    Buffer.from(parts[0], "base64url").toString("utf8")
  ) as { alg: string; typ: string };
  assert.deepEqual(header, { alg: "HS256", typ: "JWT" });
  assert.equal(
    parts[2],
    createHmac("sha256", "parent-secret-key")
      .update(`${parts[0]}.${parts[1]}`)
      .digest("base64url")
  );
  assert.equal(
    credentials.secretAccessKey,
    createHash("sha256").update(jwt).digest("hex")
  );

  return {
    credentials,
    claims: JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as CredentialClaims,
  };
};

describe("R2 credential broker legacy namespace claims", () => {
  it("reports readiness only when required secrets and settings are present", async () => {
    const bucket = new MemoryClaimBucket();
    const configured = await worker.fetch(
      new Request("https://credentials.gamehub.test/health"),
      environment(bucket)
    );
    assert.equal(configured.status, 200);
    assert.deepEqual(await configured.json(), { ok: true });

    const missingSecret = {
      ...environment(bucket),
      R2_PARENT_SECRET_ACCESS_KEY: "",
    };
    const unavailable = await worker.fetch(
      new Request("https://credentials.gamehub.test/health"),
      missingSecret
    );
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { ok: false });

    const missingAllowlist = {
      ...environment(bucket),
      ALLOWED_HYDRA_PROFILE_IDS: "",
    };
    const noAllowlist = await worker.fetch(
      new Request("https://credentials.gamehub.test/health"),
      missingAllowlist
    );
    assert.equal(noAllowlist.status, 503);

    const missingRateLimiter = {
      ...environment(bucket),
      CREDENTIAL_RATE_LIMITER: undefined,
    };
    const noRateLimiter = await worker.fetch(
      new Request("https://credentials.gamehub.test/health"),
      missingRateLimiter as never
    );
    assert.equal(noRateLimiter.status, 503);
  });

  it("atomically binds a legacy UUID to one authenticated account", async () => {
    const bucket = new MemoryClaimBucket();
    const calls = installUpstreamMock();
    const legacyNamespaceId = "6ce66cac-e77d-4c40-95c2-13954092fe15";

    const [first, second] = await Promise.all([
      worker.fetch(
        request("account-a", legacyNamespaceId),
        environment(bucket)
      ),
      worker.fetch(
        request("account-b", legacyNamespaceId),
        environment(bucket)
      ),
    ]);

    assert.deepEqual([first.status, second.status].sort(), [200, 503]);
    assert.equal(calls.profile, 2);
    const successfulResponse = first.status === 200 ? first : second;
    const { claims } = await readCredentialResponse(successfulResponse);
    assert.equal(claims.scope, "object-read-write");
    assert.equal(claims.paths.prefixPaths.length, 2);
    assert.ok(
      claims.paths.prefixPaths.includes(`users/${legacyNamespaceId}/`)
    );
    assert.deepEqual(claims.paths.objectPaths, []);
  });

  it("allows the owning account to renew the same claim", async () => {
    const bucket = new MemoryClaimBucket();
    const calls = installUpstreamMock();
    const legacyNamespaceId = "6ce66cac-e77d-4c40-95c2-13954092fe15";

    const first = await worker.fetch(
      request("account-a", legacyNamespaceId),
      environment(bucket)
    );
    const second = await worker.fetch(
      request("account-a", legacyNamespaceId),
      environment(bucket)
    );

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(calls.profile, 2);
    const { claims } = await readCredentialResponse(first);
    assert.equal(claims.bucket, "gamehub");
    assert.equal(claims.sub, "a".repeat(32));
    assert.equal(claims.iss, "parent-access-key");
    assert.equal(claims.aud, `${"a".repeat(32)}.r2.cloudflarestorage.com`);
    assert.ok(claims.exp - claims.iat === 900);
    assert.deepEqual(claims.paths.prefixPaths, [
      "users/account-a/",
      `users/${legacyNamespaceId}/`,
    ]);
    await readCredentialResponse(second);
  });

  it("denies authenticated Hydra profiles outside the deployment allowlist", async () => {
    const bucket = new MemoryClaimBucket();
    const calls = installUpstreamMock();

    const response = await worker.fetch(
      request("account-c", "6ce66cac-e77d-4c40-95c2-13954092fe15"),
      environment(bucket)
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "forbidden" });
    assert.equal(calls.profile, 1);
  });

  it("fails closed when the per-profile credential quota is exhausted", async () => {
    const bucket = new MemoryClaimBucket();
    const calls = installUpstreamMock();
    const env = environment(bucket);
    let allowed = true;
    env.CREDENTIAL_RATE_LIMITER = {
      limit: async () => {
        const success = allowed;
        allowed = false;
        return { success };
      },
    };
    const legacyNamespaceId = "6ce66cac-e77d-4c40-95c2-13954092fe15";

    const first = await worker.fetch(
      request("account-a", legacyNamespaceId),
      env
    );
    const second = await worker.fetch(
      request("account-a", legacyNamespaceId),
      env
    );

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.deepEqual(await second.json(), { error: "rate_limited" });
    assert.equal(calls.profile, 2);
  });

  it("does not mint when the configured rate limiter is unavailable", async () => {
    const bucket = new MemoryClaimBucket();
    const calls = installUpstreamMock();
    const env = environment(bucket);
    env.CREDENTIAL_RATE_LIMITER = {
      limit: async () => {
        throw new Error("rate limiter unavailable");
      },
    };

    const response = await worker.fetch(
      request("account-a", "6ce66cac-e77d-4c40-95c2-13954092fe15"),
      env
    );

    assert.equal(response.status, 503);
    assert.equal(calls.profile, 1);
  });
});
