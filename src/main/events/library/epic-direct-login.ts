import { registerEvent } from "../register-event";
import axios from "axios";
import {
  authenticateLegendary,
  findLegendaryBinary,
  downloadLegendary,
  getLegendaryStatus,
} from "@main/services/legendary";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import { logger } from "@main/services";

const EPIC_CLIENT_ID = "34a02cf8f4414e29b15921876da36f9a";
const EPIC_CLIENT_SECRET = "daafbccc737745039dffe53d94fc76cf";
const TOKEN_URL =
  "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token";
const EXCHANGE_URL = "https://www.epicgames.com/id/api/exchange";

const basicAuth = Buffer.from(
  `${EPIC_CLIENT_ID}:${EPIC_CLIENT_SECRET}`
).toString("base64");

interface EpicTokenResponse {
  access_token?: string;
  error?: string;
  errorMessage?: string;
  errorCode?: string;
  metadata?: {
    mfaToken?: string;
    challengeType?: string;
  };
  mfa_token?: string;
  challenge_type?: string;
}

export type EpicLoginResult =
  | { success: true; account: string }
  | {
      success: false;
      mfaRequired: true;
      mfaToken: string;
      challengeType: string;
    }
  | { success: false; error: string };

async function exchangeAndAuth(
  accessToken: string
): Promise<{ success: true; account: string } | { success: false; error: string }> {
  const exchangeRes = await axios.get<{ code: string }>(EXCHANGE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15_000,
  });

  const code = exchangeRes.data.code;
  if (!code) return { success: false, error: "No exchange code returned" };

  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  let binary = findLegendaryBinary(prefs?.legendaryBinaryPath);
  if (!binary) {
    binary = await downloadLegendary();
  }

  await authenticateLegendary(code, binary);
  let status = await getLegendaryStatus(binary);
  for (let i = 0; i < 5 && !status.account; i++) {
    await new Promise((r) => setTimeout(r, 600));
    status = await getLegendaryStatus(binary);
  }
  return { success: true, account: status.account ?? "Epic Games" };
}

const epicDirectLogin = async (
  _event: Electron.IpcMainInvokeEvent,
  email: string,
  password: string
): Promise<EpicLoginResult> => {
  try {
    const res = await axios.post<EpicTokenResponse>(
      TOKEN_URL,
      new URLSearchParams({
        grant_type: "password",
        username: email,
        password,
        token_type: "eg1",
      }),
      {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 20_000,
        validateStatus: () => true,
      }
    );

    if (res.data.access_token) {
      return exchangeAndAuth(res.data.access_token);
    }

    // MFA required
    if (
      res.data.errorCode?.includes("mfa_required") ||
      res.data.error?.includes("mfa_required")
    ) {
      const mfaToken =
        res.data.mfa_token ?? res.data.metadata?.mfaToken ?? "";
      const challengeType =
        res.data.challenge_type ?? res.data.metadata?.challengeType ?? "TOTP";
      return {
        success: false,
        mfaRequired: true,
        mfaToken,
        challengeType,
      };
    }

    const message =
      res.data.errorMessage ?? res.data.error ?? "Login failed";
    return { success: false, error: message };
  } catch (err: any) {
    logger.error("epicDirectLogin failed", err);
    return { success: false, error: err?.message ?? "Unknown error" };
  }
};

const epicDirectLoginMfa = async (
  _event: Electron.IpcMainInvokeEvent,
  otp: string,
  mfaToken: string,
  challengeType: string
): Promise<EpicLoginResult> => {
  try {
    const res = await axios.post<EpicTokenResponse>(
      TOKEN_URL,
      new URLSearchParams({
        grant_type: "mfa_otp",
        mfa_token: mfaToken,
        otp,
        challenge_type: challengeType,
        token_type: "eg1",
      }),
      {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 20_000,
        validateStatus: () => true,
      }
    );

    if (res.data.access_token) {
      return exchangeAndAuth(res.data.access_token);
    }

    const message =
      res.data.errorMessage ?? res.data.error ?? "MFA verification failed";
    return { success: false, error: message };
  } catch (err: any) {
    logger.error("epicDirectLoginMfa failed", err);
    return { success: false, error: err?.message ?? "Unknown error" };
  }
};

registerEvent("epicDirectLogin", epicDirectLogin);
registerEvent("epicDirectLoginMfa", epicDirectLoginMfa);
