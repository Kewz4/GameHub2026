export type CloudSyncOperation =
  | "artifacts"
  | "preview"
  | "upload"
  | "download"
  | "delete";

export interface CloudSyncGameToken {
  readonly gameKey: string;
  readonly gameGeneration: number;
}

export interface CloudSyncOperationToken extends CloudSyncGameToken {
  readonly operation: CloudSyncOperation;
  readonly operationGeneration: number;
}

/**
 * Keeps asynchronous cloud-sync results scoped to the game and operation that
 * started them. This prevents a slow response for the previous details page
 * from replacing the state of the game currently on screen.
 */
export class CloudSyncOperationGuard {
  private gameKey: string;
  private gameGeneration = 0;
  private readonly operationGenerations = new Map<CloudSyncOperation, number>();

  constructor(gameKey: string) {
    this.gameKey = gameKey;
  }

  activateGame(gameKey: string): boolean {
    if (gameKey === this.gameKey) return false;

    this.gameKey = gameKey;
    this.gameGeneration += 1;
    this.operationGenerations.clear();
    return true;
  }

  invalidateGame(gameKey: string): void {
    if (gameKey !== this.gameKey) return;

    this.gameGeneration += 1;
    this.operationGenerations.clear();
  }

  captureGame(): CloudSyncGameToken {
    return {
      gameKey: this.gameKey,
      gameGeneration: this.gameGeneration,
    };
  }

  begin(operation: CloudSyncOperation): CloudSyncOperationToken {
    const operationGeneration =
      (this.operationGenerations.get(operation) ?? 0) + 1;
    this.operationGenerations.set(operation, operationGeneration);

    return {
      ...this.captureGame(),
      operation,
      operationGeneration,
    };
  }

  isGameCurrent(token: CloudSyncGameToken): boolean {
    return (
      token.gameKey === this.gameKey &&
      token.gameGeneration === this.gameGeneration
    );
  }

  isOperationCurrent(token: CloudSyncOperationToken): boolean {
    return (
      this.isGameCurrent(token) &&
      this.operationGenerations.get(token.operation) ===
        token.operationGeneration
    );
  }
}

export const getCloudSyncGameKey = (shop: string, objectId: string) =>
  JSON.stringify([shop, objectId]);
