import { HydraApi } from "./hydra-api";
import {
  createCachedBrokerR2CredentialProvider,
  type R2CredentialIdentity,
} from "./r2-credential-provider";
import { getClaimableCloudSaveLegacyNamespaces } from "./cloud-save-namespace-state";
import { registerR2CredentialSessionInvalidator } from "./r2-credential-session";

const DEFAULT_R2_ENDPOINT =
  "https://f27692e18d99d566ad3a04766f3142ef.r2.cloudflarestorage.com";
const DEFAULT_R2_BUCKET = "gamehub";

const valueOrDefault = (value: string | undefined, fallback: string) =>
  value?.trim() || fallback;

export const R2_ENDPOINT = valueOrDefault(
  process.env.GAMEHUB_R2_ENDPOINT ?? import.meta.env.MAIN_VITE_R2_ENDPOINT,
  DEFAULT_R2_ENDPOINT
);
export const R2_BUCKET = valueOrDefault(
  process.env.GAMEHUB_R2_BUCKET ?? import.meta.env.MAIN_VITE_R2_BUCKET,
  DEFAULT_R2_BUCKET
);

const credentialsUrl =
  process.env.GAMEHUB_R2_CREDENTIALS_URL?.trim() ||
  import.meta.env.MAIN_VITE_R2_CREDENTIALS_URL?.trim();

const assertSafeR2Configuration = () => {
  let endpoint: URL;
  try {
    endpoint = new URL(R2_ENDPOINT);
  } catch {
    throw new Error("r2_invalid_endpoint");
  }
  if (endpoint.protocol !== "https:") throw new Error("r2_invalid_endpoint");
  if (!/^[a-z0-9][a-z0-9.-]{1,62}[a-z0-9]$/.test(R2_BUCKET)) {
    throw new Error("r2_invalid_bucket");
  }
};

const brokerProvider = credentialsUrl
  ? createCachedBrokerR2CredentialProvider({
      credentialsUrl,
      getBearerToken: () => HydraApi.getAccessToken(),
      // Defer access to the namespace module until the broker request. The
      // bundled main process has an intentional R2/namespace import cycle;
      // eagerly reading this binding can hit the ESM temporal dead zone when
      // a broker URL is supplied through the runtime environment.
      getLegacyNamespaceIds: () => getClaimableCloudSaveLegacyNamespaces(),
    })
  : null;

registerR2CredentialSessionInvalidator(() => brokerProvider?.invalidate());

const getDirectDevelopmentCredentials = ():
  | (Omit<R2CredentialIdentity, "expiration" | "sessionToken"> & {
      sessionToken?: string;
    })
  | null => {
  const accessKeyId = process.env.GAMEHUB_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.GAMEHUB_R2_SECRET_ACCESS_KEY?.trim();
  const sessionToken = process.env.GAMEHUB_R2_SESSION_TOKEN?.trim();

  if (!accessKeyId && !secretAccessKey && !sessionToken) return null;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("r2_direct_credentials_incomplete");
  }

  return {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  };
};

/**
 * AWS credential provider used by the main-process S3 client. Long-lived
 * credentials are accepted only from the process environment for local
 * development; production obtains short-lived, user-scoped credentials.
 */
export const getR2Credentials = async () => {
  assertSafeR2Configuration();
  const directCredentials = getDirectDevelopmentCredentials();
  if (directCredentials) return directCredentials;
  if (!brokerProvider) throw new Error("r2_credentials_broker_not_configured");
  return brokerProvider();
};
