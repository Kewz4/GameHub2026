import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { ClassicLevel } from "classic-level";

function readArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!name?.startsWith("--") || !argv[index + 1]) {
      throw new Error("Expected --name value arguments");
    }
    values[name.slice(2)] = argv[index + 1];
  }
  return values;
}

async function readHydraAuth(dataDir) {
  const source = path.join(dataDir, "gamehub-db");
  const temporaryRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "gamehub-r2-live-check-")
  );
  const copy = path.join(temporaryRoot, "db");
  try {
    await fs.promises.cp(source, copy, {
      recursive: true,
      filter: (entry) => path.basename(entry).toUpperCase() !== "LOCK",
    });
    const database = new ClassicLevel(copy, { valueEncoding: "json" });
    try {
      await database.open();
      const auth = await database.get("auth");
      const accessToken = auth?.accessToken?.trim();
      const refreshToken = auth?.refreshToken?.trim();
      if (!accessToken || !refreshToken)
        throw new Error("GameHub is not signed in");
      return {
        accessToken,
        refreshToken,
        expirationTimestamp: Number(auth?.tokenExpirationTimestamp ?? 0),
      };
    } finally {
      await database.close().catch(() => undefined);
    }
  } finally {
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function refreshHydraBearer(hydraApi, refreshToken) {
  const response = await fetch(`${hydraApi.replace(/\/+$/, "")}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({ refreshToken }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.accessToken !== "string") {
    throw new Error(`Hydra token refresh failed (HTTP ${response.status})`);
  }
  return body.accessToken;
}

async function requestCredentials(workerUrl, bearer) {
  return fetch(workerUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: "{}",
  });
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  for (const required of [
    "data-dir",
    "worker-url",
    "hydra-api",
    "endpoint",
    "bucket",
    "profile-id",
  ]) {
    if (!args[required]) throw new Error(`Missing --${required}`);
  }

  const auth = await readHydraAuth(path.resolve(args["data-dir"]));
  let bearer = auth.accessToken;
  if (auth.expirationTimestamp < Date.now()) {
    bearer = await refreshHydraBearer(args["hydra-api"], auth.refreshToken);
  }
  let response = await requestCredentials(args["worker-url"], bearer);
  if (response.status === 401 && bearer === auth.accessToken) {
    bearer = await refreshHydraBearer(args["hydra-api"], auth.refreshToken);
    response = await requestCredentials(args["worker-url"], bearer);
  }
  const body = await response.json().catch(() => null);
  if (
    !response.ok ||
    typeof body?.accessKeyId !== "string" ||
    typeof body?.secretAccessKey !== "string" ||
    typeof body?.sessionToken !== "string" ||
    !Number.isFinite(Date.parse(body?.expiresAt ?? ""))
  ) {
    throw new Error(
      `Credential broker rejected the live check (HTTP ${response.status})`
    );
  }

  const client = new S3Client({
    region: "auto",
    endpoint: args.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: body.accessKeyId,
      secretAccessKey: body.secretAccessKey,
      sessionToken: body.sessionToken,
    },
  });
  const allowedPrefix = `users/${encodeURIComponent(args["profile-id"])}/`;
  await client.send(
    new ListObjectsV2Command({
      Bucket: args.bucket,
      Prefix: allowedPrefix,
      MaxKeys: 1,
    })
  );

  let outsidePrefixDenied = false;
  try {
    await client.send(
      new ListObjectsV2Command({
        Bucket: args.bucket,
        Prefix: "shared/",
        MaxKeys: 1,
      })
    );
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    outsidePrefixDenied = status === 401 || status === 403;
    if (!outsidePrefixDenied) throw error;
  } finally {
    client.destroy();
  }
  if (!outsidePrefixDenied) {
    throw new Error("Temporary R2 credential escaped its allowed user prefix");
  }

  console.log(
    "Live R2 credential check passed: the user prefix is readable and shared/ is denied."
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
