import { CloudSync } from "@main/services/cloud-sync";
import { registerR2CredentialSessionInvalidator } from "../r2-credential-session";
import { CloudSaveAccountSessionManager } from "./account-session-manager";

export { CloudSaveAccountSessionManager } from "./account-session-manager";

const accountSessions = new CloudSaveAccountSessionManager(() =>
  CloudSync.getOrCreateUserId()
);

registerR2CredentialSessionInvalidator(accountSessions.invalidate);

export const runWithCloudSaveAccountSession = <T>(
  operation: () => Promise<T>
) => accountSessions.run(operation);

export const getCloudSaveAccountUserId = () => accountSessions.getUserId();
export const getCloudSaveAccountScopeKey = () => accountSessions.getScopeKey();
export const assertCloudSaveAccountSessionCurrent = () =>
  accountSessions.assertCurrent();
