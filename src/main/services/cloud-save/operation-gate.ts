type CloudSaveOperationKind = "sync" | "delete";

interface ActiveCloudSaveOperation {
  kind: CloudSaveOperationKind;
  operationKey: string;
  promise: Promise<unknown>;
}

export class CloudSaveOperationGate {
  private readonly active = new Map<string, ActiveCloudSaveOperation>();
  private readonly activeLaunches = new Set<string>();
  private readonly launchSessions = new Map<string, string>();

  public isDeletionActive(scopeKey: string) {
    return this.active.get(scopeKey)?.kind === "delete";
  }

  public assertSyncAllowed(
    scopeKey: string,
    launchSessionToken?: string
  ): void {
    const ownsLaunchSession =
      launchSessionToken !== undefined &&
      this.launchSessions.get(scopeKey) === launchSessionToken;
    if (
      !ownsLaunchSession &&
      (this.activeLaunches.has(scopeKey) || this.launchSessions.has(scopeKey))
    ) {
      throw new Error("cloud_save_launch_active");
    }
  }

  public runSync<T>(
    scopeKey: string,
    operationKey: string,
    operation: () => Promise<T>,
    assertCanStart?: () => Promise<void>,
    launchSessionToken?: string
  ): Promise<T> {
    try {
      this.assertSyncAllowed(scopeKey, launchSessionToken);
    } catch (error) {
      return Promise.reject(error);
    }

    if (this.active.has(scopeKey)) {
      return Promise.reject(new Error("cloud_save_operation_active"));
    }

    return this.run(scopeKey, "sync", operationKey, async () => {
      await assertCanStart?.();
      return operation();
    });
  }

  public runDeletion<T>(
    scopeKey: string,
    operationKey: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if (
      this.activeLaunches.has(scopeKey) ||
      this.launchSessions.has(scopeKey)
    ) {
      return Promise.reject(new Error("cloud_save_operation_active"));
    }

    const activeOperation = this.active.get(scopeKey);
    if (activeOperation) {
      if (
        activeOperation.kind === "delete" &&
        activeOperation.operationKey === operationKey
      ) {
        return activeOperation.promise as Promise<T>;
      }

      return Promise.reject(new Error("cloud_save_operation_active"));
    }

    return this.run(scopeKey, "delete", operationKey, operation);
  }

  public runLaunch<T>(
    scopeKey: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if (this.isDeletionActive(scopeKey)) {
      return Promise.reject(new Error("cloud_save_delete_active"));
    }
    if (
      this.activeLaunches.has(scopeKey) ||
      this.launchSessions.has(scopeKey)
    ) {
      return Promise.reject(new Error("cloud_save_launch_active"));
    }
    if (this.active.has(scopeKey)) {
      return Promise.reject(new Error("cloud_save_operation_active"));
    }

    this.activeLaunches.add(scopeKey);
    return Promise.resolve()
      .then(operation)
      .finally(() => {
        this.activeLaunches.delete(scopeKey);
      });
  }

  /**
   * Reserve mutation ownership for the game process which is about to launch.
   * Only sync work presenting this exact token may run until the session is
   * released after exit (or explicitly aborted after a failed launch).
   */
  public reserveLaunchSession(scopeKey: string, token: string): void {
    const activeToken = this.launchSessions.get(scopeKey);
    if (activeToken && activeToken !== token) {
      throw new Error("cloud_save_launch_active");
    }
    this.launchSessions.set(scopeKey, token);
  }

  public releaseLaunchSession(scopeKey: string, token: string): boolean {
    if (this.launchSessions.get(scopeKey) !== token) return false;
    return this.launchSessions.delete(scopeKey);
  }

  public isLaunchSessionActive(scopeKey: string): boolean {
    return this.launchSessions.has(scopeKey);
  }

  private run<T>(
    scopeKey: string,
    kind: CloudSaveOperationKind,
    operationKey: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const promise = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (this.active.get(scopeKey)?.promise === promise) {
          this.active.delete(scopeKey);
        }
      });

    this.active.set(scopeKey, { kind, operationKey, promise });
    return promise;
  }
}

export const cloudSaveOperationGate = new CloudSaveOperationGate();

export const cloudSaveOperationScopeKey = (objectId: string, shop: string) =>
  JSON.stringify([shop, objectId]);

export const isCloudSaveDeletionActive = (objectId: string, shop: string) =>
  cloudSaveOperationGate.isDeletionActive(
    cloudSaveOperationScopeKey(objectId, shop)
  );

export const assertCloudSaveDeletionInactive = (
  objectId: string,
  shop: string
) => {
  if (isCloudSaveDeletionActive(objectId, shop)) {
    throw new Error("cloud_save_delete_active");
  }
};

export const assertCloudSaveSyncAllowedDuringLaunch = (
  objectId: string,
  shop: string,
  launchSessionToken?: string
) =>
  cloudSaveOperationGate.assertSyncAllowed(
    cloudSaveOperationScopeKey(objectId, shop),
    launchSessionToken
  );

export const runWithCloudSaveLaunchGate = <T>(
  objectId: string,
  shop: string,
  operation: () => Promise<T>
) =>
  cloudSaveOperationGate.runLaunch(
    cloudSaveOperationScopeKey(objectId, shop),
    operation
  );
