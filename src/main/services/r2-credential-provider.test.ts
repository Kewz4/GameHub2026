import assert from "node:assert/strict";
import { describe, it } from "node:test";

const providerModulePath = "./r2-credential-provider.ts";
const {
  createCachedBrokerR2CredentialProvider,
  validateR2BrokerCredentialPayload,
} = await import(providerModulePath);

const credentialPayload = (now: number) => ({
  accessKeyId: "temporary-access-key",
  secretAccessKey: "temporary-secret-key",
  sessionToken: "temporary-session-token",
  expiresAt: new Date(now + 15 * 60_000).toISOString(),
});

describe("R2 temporary credential provider", () => {
  it("validates and converts a short-lived broker response", () => {
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    const result = validateR2BrokerCredentialPayload(
      credentialPayload(now),
      now
    );

    assert.equal(result.credentials.accessKeyId, "temporary-access-key");
    assert.equal(
      result.credentials.expiration.toISOString(),
      "2026-08-01T12:15:00.000Z"
    );
  });

  it("deduplicates concurrent refreshes and reuses a fresh credential", async () => {
    let now = Date.parse("2026-08-01T12:00:00.000Z");
    let requests = 0;
    const provider = createCachedBrokerR2CredentialProvider({
      credentialsUrl: "https://credentials.gamehub.test/v1/r2/credentials",
      getBearerToken: async () => "hydra-bearer",
      now: () => now,
      fetchImpl: async () => {
        requests += 1;
        return Response.json(credentialPayload(now));
      },
    });

    const [first, second] = await Promise.all([provider(), provider()]);
    assert.strictEqual(first, second);
    assert.equal(requests, 1);

    now += 5 * 60_000;
    assert.strictEqual(await provider(), first);
    assert.equal(requests, 1);
  });

  it("never reuses cached credentials across bearer/account changes", async () => {
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    let bearerToken = "hydra-account-a";
    const authorizations: string[] = [];
    const provider = createCachedBrokerR2CredentialProvider({
      credentialsUrl: "https://credentials.gamehub.test/v1/r2/credentials",
      getBearerToken: async () => bearerToken,
      now: () => now,
      fetchImpl: async (_input, init) => {
        const authorization = String(
          (init?.headers as Record<string, string>).Authorization
        );
        authorizations.push(authorization);
        return Response.json({
          ...credentialPayload(now),
          accessKeyId: `temporary-${authorization.slice("Bearer ".length)}`,
        });
      },
    });

    assert.equal((await provider()).accessKeyId, "temporary-hydra-account-a");
    bearerToken = "hydra-account-b";
    assert.equal((await provider()).accessKeyId, "temporary-hydra-account-b");
    assert.deepEqual(authorizations, [
      "Bearer hydra-account-a",
      "Bearer hydra-account-b",
    ]);
  });

  it("fails closed after sign-out even while a credential is fresh", async () => {
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    let bearerToken = "hydra-account-a";
    let requests = 0;
    const provider = createCachedBrokerR2CredentialProvider({
      credentialsUrl: "https://credentials.gamehub.test/v1/r2/credentials",
      getBearerToken: async () => bearerToken,
      now: () => now,
      fetchImpl: async () => {
        requests += 1;
        return Response.json(credentialPayload(now));
      },
    });

    await provider();
    bearerToken = "";
    await assert.rejects(provider(), /r2_credentials_broker_requires_login/);
    assert.equal(requests, 1);
  });

  it("supports explicit session invalidation", async () => {
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    let requests = 0;
    const provider = createCachedBrokerR2CredentialProvider({
      credentialsUrl: "https://credentials.gamehub.test/v1/r2/credentials",
      getBearerToken: async () => "hydra-account-a",
      now: () => now,
      fetchImpl: async () => {
        requests += 1;
        return Response.json({
          ...credentialPayload(now),
          accessKeyId: `temporary-access-key-${requests}`,
        });
      },
    });

    await provider();
    provider.invalidate();
    assert.equal((await provider()).accessKeyId, "temporary-access-key-2");
    assert.equal(requests, 2);
  });

  it("refreshes before expiry", async () => {
    let now = Date.parse("2026-08-01T12:00:00.000Z");
    let requests = 0;
    const provider = createCachedBrokerR2CredentialProvider({
      credentialsUrl: "https://credentials.gamehub.test/v1/r2/credentials",
      getBearerToken: async () => "hydra-bearer",
      now: () => now,
      fetchImpl: async () => {
        requests += 1;
        return Response.json({
          ...credentialPayload(now),
          accessKeyId: `temporary-access-key-${requests}`,
        });
      },
    });

    assert.equal((await provider()).accessKeyId, "temporary-access-key-1");
    now += 11 * 60_000;
    assert.equal((await provider()).accessKeyId, "temporary-access-key-2");
    assert.equal(requests, 2);
  });

  it("requests only validated legacy namespace capabilities", async () => {
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    let requestBody: unknown;
    const provider = createCachedBrokerR2CredentialProvider({
      credentialsUrl: "https://credentials.gamehub.test/v1/r2/credentials",
      getBearerToken: async () => "hydra-bearer",
      getLegacyNamespaceIds: async () => [
        "6ce66cac-e77d-4c40-95c2-13954092fe15",
      ],
      now: () => now,
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return Response.json(credentialPayload(now));
      },
    });

    await provider();
    assert.deepEqual(requestBody, {
      legacyNamespaceIds: ["6ce66cac-e77d-4c40-95c2-13954092fe15"],
    });
  });

  it("rejects malformed legacy namespace capabilities before the request", async () => {
    let requested = false;
    const provider = createCachedBrokerR2CredentialProvider({
      credentialsUrl: "https://credentials.gamehub.test/v1/r2/credentials",
      getBearerToken: async () => "hydra-bearer",
      getLegacyNamespaceIds: async () => ["another-account"],
      fetchImpl: async () => {
        requested = true;
        return Response.json({});
      },
    });

    await assert.rejects(
      provider(),
      /r2_credentials_broker_invalid_legacy_namespace/
    );
    assert.equal(requested, false);
  });

  it("rejects long-lived or unexpected credential payloads", () => {
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    assert.throws(
      () =>
        validateR2BrokerCredentialPayload(
          {
            ...credentialPayload(now),
            secretAccessKey: "must-not-appear-in-errors",
            expiresAt: new Date(now + 2 * 60 * 60_000).toISOString(),
          },
          now
        ),
      (error: unknown) => {
        assert.equal(
          (error as Error).message,
          "r2_credentials_broker_invalid_expiry"
        );
        assert.doesNotMatch(
          (error as Error).message,
          /must-not-appear-in-errors/
        );
        return true;
      }
    );

    assert.throws(
      () =>
        validateR2BrokerCredentialPayload(
          { ...credentialPayload(now), unexpected: true },
          now
        ),
      /r2_credentials_broker_invalid_response/
    );
  });

  it("requires HTTPS except for local development", () => {
    assert.throws(
      () =>
        createCachedBrokerR2CredentialProvider({
          credentialsUrl: "http://credentials.gamehub.test/v1/r2/credentials",
          getBearerToken: async () => "hydra-bearer",
        }),
      /r2_credentials_broker_requires_https/
    );

    assert.doesNotThrow(() =>
      createCachedBrokerR2CredentialProvider({
        credentialsUrl: "http://127.0.0.1:8787/v1/r2/credentials",
        getBearerToken: async () => "hydra-bearer",
      })
    );
  });
});
