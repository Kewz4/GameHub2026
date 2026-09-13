export type ExophaseAuthVerification = "verified" | "cached" | "signed-out";

export interface ExophaseAuthState {
  authenticated: boolean;
  username: string | null;
  verification: ExophaseAuthVerification;
}

export function isExophaseAuthPageUrl(url: string): boolean {
  const normalized = url.toLowerCase();

  return (
    normalized.includes("/login") ||
    normalized.includes("/register") ||
    normalized.includes("/signup") ||
    normalized.includes("/password")
  );
}

interface ResolveExophaseProbeStateOptions {
  cachedUsername: string | null;
  detectedUsername: string | null;
  definitivelySignedOut: boolean;
}

/**
 * A network timeout, Cloudflare interstitial, or incomplete account-page load
 * must not erase a known local account from the UI. Only a confirmed redirect
 * to an authentication page is authoritative evidence that the session ended.
 */
export function resolveExophaseProbeState({
  cachedUsername,
  detectedUsername,
  definitivelySignedOut,
}: ResolveExophaseProbeStateOptions): ExophaseAuthState {
  if (detectedUsername) {
    return {
      authenticated: true,
      username: detectedUsername,
      verification: "verified",
    };
  }

  if (definitivelySignedOut) {
    return {
      authenticated: false,
      username: null,
      verification: "signed-out",
    };
  }

  if (cachedUsername) {
    return {
      authenticated: true,
      username: cachedUsername,
      verification: "cached",
    };
  }

  return {
    authenticated: false,
    username: null,
    verification: "signed-out",
  };
}
