import { AsyncLocalStorage } from "node:async_hooks";

interface CloudSaveAccountScope {
  userId: string;
  generation: number;
}

export class CloudSaveAccountSessionManager {
  private generation = 0;
  private readonly storage = new AsyncLocalStorage<CloudSaveAccountScope>();

  constructor(private readonly resolveUserId: () => Promise<string>) {}

  invalidate = () => {
    this.generation += 1;
  };

  assertCurrent() {
    const scope = this.storage.getStore();
    if (scope && scope.generation !== this.generation) {
      throw new Error("cloud_save_account_session_changed");
    }
  }

  async getUserId() {
    const scope = this.storage.getStore();
    if (scope) {
      this.assertCurrent();
      return scope.userId;
    }
    const generation = this.generation;
    const userId = await this.resolveUserId();
    if (generation !== this.generation) {
      throw new Error("cloud_save_account_session_changed");
    }
    return userId;
  }

  getScopeKey() {
    const scope = this.storage.getStore();
    if (!scope) throw new Error("cloud_save_account_session_missing");
    this.assertCurrent();
    return JSON.stringify([scope.userId, scope.generation]);
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.storage.getStore()) {
      this.assertCurrent();
      const result = await operation();
      this.assertCurrent();
      return result;
    }
    const generation = this.generation;
    const userId = await this.resolveUserId();
    if (generation !== this.generation) {
      throw new Error("cloud_save_account_session_changed");
    }
    return this.storage.run({ userId, generation }, async () => {
      this.assertCurrent();
      const result = await operation();
      this.assertCurrent();
      return result;
    });
  }
}
