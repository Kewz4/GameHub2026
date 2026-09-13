import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ACHIEVEMENT_SOUVENIR_QUARANTINE_DIRECTORY,
  achievementSouvenirOwnerRoot,
  isOwnedAchievementSouvenirPath,
  isPathInside,
  isUnownedLegacyAchievementSouvenirPath,
} from "./achievement-souvenir-policy";

/** Filesystem ownership boundary shared by local captures and downloaded R2 caches. */
export class AchievementSouvenirLocalStorage {
  constructor(readonly rootPath: string) {}

  getOwnerRoot(ownerId: string) {
    return achievementSouvenirOwnerRoot(this.rootPath, ownerId);
  }

  async prepareOwnedFilePath(ownerId: string, filePath: string) {
    if (!isOwnedAchievementSouvenirPath(this.rootPath, ownerId, filePath)) {
      throw new Error("achievement_souvenir_path_outside_root");
    }

    const accountsRoot = path.dirname(this.getOwnerRoot(ownerId));
    const ownerRoot = this.getOwnerRoot(ownerId);
    const parent = path.dirname(filePath);
    await fs.promises.mkdir(this.rootPath, { recursive: true });
    await fs.promises.mkdir(accountsRoot, { recursive: true });
    await fs.promises.mkdir(ownerRoot, { recursive: true });
    await fs.promises.mkdir(parent, { recursive: true });

    const [realRoot, realAccountsRoot, realOwnerRoot, realParent] =
      await Promise.all([
        fs.promises.realpath(this.rootPath),
        fs.promises.realpath(accountsRoot),
        fs.promises.realpath(ownerRoot),
        fs.promises.realpath(parent),
      ]);
    const [accountsStat, ownerStat, parentStat] = await Promise.all([
      fs.promises.lstat(accountsRoot),
      fs.promises.lstat(ownerRoot),
      fs.promises.lstat(parent),
    ]);
    if (
      accountsStat.isSymbolicLink() ||
      ownerStat.isSymbolicLink() ||
      parentStat.isSymbolicLink() ||
      !isPathInside(realRoot, realAccountsRoot) ||
      !isPathInside(realAccountsRoot, realOwnerRoot) ||
      !isPathInside(realOwnerRoot, realParent)
    ) {
      throw new Error("achievement_souvenir_owned_path_invalid");
    }
    return filePath;
  }

  /**
   * Return a path only when its real file belongs to the expected account.
   * Ownerless paths from older builds are ambiguous and therefore quarantined
   * rather than assigned to whichever account happens to sign in first.
   */
  async reconcilePersistedPath(
    ownerId: string,
    filePath: string | null
  ): Promise<string | null> {
    if (!filePath) return null;

    if (isOwnedAchievementSouvenirPath(this.rootPath, ownerId, filePath)) {
      const stat = await fs.promises.lstat(filePath).catch(() => null);
      if (!stat?.isFile() || stat.isSymbolicLink()) return null;

      const [realRoot, realOwnerRoot, realFile] = await Promise.all([
        fs.promises.realpath(this.rootPath).catch(() => null),
        fs.promises.realpath(this.getOwnerRoot(ownerId)).catch(() => null),
        fs.promises.realpath(filePath).catch(() => null),
      ]);
      return realRoot &&
        realOwnerRoot &&
        realFile &&
        isPathInside(realRoot, realOwnerRoot) &&
        isPathInside(realOwnerRoot, realFile)
        ? filePath
        : null;
    }

    if (!isUnownedLegacyAchievementSouvenirPath(this.rootPath, filePath)) {
      // Never move or delete a path outside the souvenir root or inside a
      // different account's root.
      return null;
    }

    const stat = await fs.promises.lstat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) return null;
    const [realRoot, realFile] = await Promise.all([
      fs.promises.realpath(this.rootPath).catch(() => null),
      fs.promises.realpath(filePath).catch(() => null),
    ]);
    if (!realRoot || !realFile || !isPathInside(realRoot, realFile)) {
      return null;
    }

    const quarantineRoot = path.join(
      this.rootPath,
      ACHIEVEMENT_SOUVENIR_QUARANTINE_DIRECTORY
    );
    const opaqueName = `${crypto
      .createHash("sha256")
      .update(path.relative(this.rootPath, filePath), "utf8")
      .digest("hex")}-${crypto.randomUUID()}.quarantined`;
    await fs.promises.mkdir(quarantineRoot, { recursive: true });
    const [realQuarantineRoot, quarantineStat] = await Promise.all([
      fs.promises.realpath(quarantineRoot),
      fs.promises.lstat(quarantineRoot),
    ]);
    if (
      quarantineStat.isSymbolicLink() ||
      !isPathInside(realRoot, realQuarantineRoot)
    ) {
      throw new Error("achievement_souvenir_quarantine_path_invalid");
    }
    try {
      await fs.promises.rename(
        filePath,
        path.join(realQuarantineRoot, opaqueName)
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return null;
  }

  async delete(ownerId: string, filePath: string | null) {
    if (!filePath) return;
    const reconciledPath = await this.reconcilePersistedPath(ownerId, filePath);
    if (reconciledPath !== filePath) {
      throw new Error("achievement_souvenir_path_outside_root");
    }
    const resolvedRoot = path.resolve(this.getOwnerRoot(ownerId));
    const resolvedFile = path.resolve(filePath);
    await fs.promises.rm(resolvedFile, { force: true });
    const parent = path.dirname(resolvedFile);
    const remaining = await fs.promises.readdir(parent).catch(() => ["keep"]);
    if (!remaining.length && parent !== resolvedRoot) {
      await fs.promises.rmdir(parent).catch(() => null);
    }
  }
}
