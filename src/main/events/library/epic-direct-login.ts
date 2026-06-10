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

const EPIC_OAUTH = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token";
const EPIC_EXCHANGE = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/exchange";
// Launcher client credentials (same ones used by the webview flow)
const CLIENT_ID = "34a02cf8f4414e29b15921876da36f9a";
const CLIENT_SECRET = "daafbccc737745039dffe53d94fc76cf";
const BASIC_AUTH = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

export type EpicLoginResult =
  | { success: true; account: string }
  | { success: false; mfaRequired: true; mfaToken: string; challengeType: string }
  | { success: false; mfaRequired?: false; error: string };

async function getExchangeCodeAndAuth(accessToken: string, prefs: UserPreferences | null): Promise<{ success: true; account: string } | { success: false; error: string }> {
  const exchangeRes = await axios.get<{ code: string }>(EPIC_EXCHANGE, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const code = exchangeRes.data.code;

  let binary = findLegendaryBinary(prefs?.legendaryBinaryPath);
  if (!binary) {
    binary = await downloadLegendary();
  }
  await authenticateLegendary(code, binary);

  let status = await getLegendaryStatus(binary);
  for (let i = 0; i < 5 && !status.account; i++) {
    await new Promise(r => setTimeout(r, 600));
    status = await getLegendaryStatus(binary);
  }
  return { success: true, account: status.account ?? "Epic Games" };
}

const epicDirectLogin = async (
  _event: Electron.IpcMainInvokeEvent,
  email: string,
  password: string
): Promise<EpicLoginResult> => {
  const prefs = await db.get<string, UserPreferences | null>(levelKeys.userPreferences, { valueEncoding: "json" }).catch(() => null);

  try {
    const res = await axios.post(
      EPIC_OAUTH,
      new URLSearchParams({ grant_type: "password", username: email, password, token_type: "eg1" }),
      {
        headers: {
          Authorization: `Basic ${BASIC_AUTH}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    return await getExchangeCodeAndAuth(res.data.access_token, prefs);
  } catch (err: unknown) {
    const data = (err as { response?: { data?: { errorCode?: string; mfa_token?: string; challenge?: string } } })?.response?.data;
    const errorCode = data?.errorCode ?? "";
    if (errorCode.includes("two_factor_authentication.required") || errorCode.includes("mfa")) {
      return {
        success: false,
        mfaRequired: true,
        mfaToken: data?.mfa_token ?? "",
        challengeType: data?.challenge ?? "EMAIL",
      };
    }
    logger.error("Epic direct login failed", err);
    return { success: false, error: "Invalid email or password. Check your credentials and try again." };
  }
};

const epicDirectLoginMfa = async (
  _event: Electron.IpcMainInvokeEvent,
  otp: string,
  mfaToken: string,
  challengeType: string
): Promise<EpicLoginResult> => {
  const prefs = await db.get<string, UserPreferences | null>(levelKeys.userPreferences, { valueEncoding: "json" }).catch(() => null);

  try {
    const res = await axios.post(
      EPIC_OAUTH,
      new URLSearchParams({ grant_type: "otp", otp, challenge_type: challengeType, mfa_token: mfaToken }),
      {
        headers: {
          Authorization: `Basic ${BASIC_AUTH}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    return await getExchangeCodeAndAuth(res.data.access_token, prefs);
  } catch (err) {
    logger.error("Epic MFA login failed", err);
    return { success: false, error: "MFA code incorrect or expired. Try again." };
  }
};

registerEvent("epicDirectLogin", epicDirectLogin);
registerEvent("epicDirectLoginMfa", epicDirectLoginMfa);
