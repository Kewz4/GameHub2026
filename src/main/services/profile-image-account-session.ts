import { registerR2CredentialSessionInvalidator } from "./r2-credential-session";

export interface ProfileImageAccountSessionScope {
  readonly ownerId: string;
  readonly generation: number;
}

/**
 * Fences a profile-image mutation to the credential session that started it.
 * Paths/tombstones are owner-stamped as a second line of defense, but remote
 * social mutations must also stop when authentication changes mid-flight.
 */
export class ProfileImageAccountSessionFence {
  private generation = 0;

  invalidate = () => {
    this.generation += 1;
  };

  captureGeneration() {
    return this.generation;
  }

  createScope(
    ownerId: string,
    capturedGeneration: number
  ): ProfileImageAccountSessionScope {
    this.assertGeneration(capturedGeneration);
    const normalizedOwnerId = ownerId.trim();
    if (!normalizedOwnerId) {
      throw new Error("profile_image_account_owner_missing");
    }
    return Object.freeze({
      ownerId: normalizedOwnerId,
      generation: capturedGeneration,
    });
  }

  assertGeneration(capturedGeneration: number) {
    if (capturedGeneration !== this.generation) {
      throw new Error("profile_image_account_session_changed");
    }
  }

  assertCurrent(scope: ProfileImageAccountSessionScope) {
    this.assertGeneration(scope.generation);
  }
}

const profileImageAccountSessions = new ProfileImageAccountSessionFence();

registerR2CredentialSessionInvalidator(profileImageAccountSessions.invalidate);

export const captureProfileImageAccountSessionGeneration = () =>
  profileImageAccountSessions.captureGeneration();

export const createProfileImageAccountSessionScope = (
  ownerId: string,
  capturedGeneration: number
) => profileImageAccountSessions.createScope(ownerId, capturedGeneration);

export const assertProfileImageAccountSessionGeneration = (
  capturedGeneration: number
) => profileImageAccountSessions.assertGeneration(capturedGeneration);

export const assertProfileImageAccountSessionCurrent = (
  scope: ProfileImageAccountSessionScope
) => profileImageAccountSessions.assertCurrent(scope);
