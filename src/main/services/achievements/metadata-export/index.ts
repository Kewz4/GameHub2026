import type { Game } from "@types";
import { achievementsLogger } from "../../logger";
import { downloadAchievementIcons } from "./download-achievement-icons";
import { generateAchievementMetadata } from "./generate-achievement-metadata";

const pending = new Map<string, AbortController>();

/** Hydra 4.1.3 metadata export, adapted to GameHub's non-blocking launch flow. */
export async function runAchievementMetadataExport(
  gameKey: string,
  game: Game
) {
  if (game.shop !== "steam" || game.libraryOrigin === "sync") return;
  pending.get(gameKey)?.abort();
  const controller = new AbortController();
  pending.set(gameKey, controller);
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const result = await generateAchievementMetadata(game, controller.signal);
    if (result && !controller.signal.aborted) {
      await downloadAchievementIcons({ ...result, signal: controller.signal });
    }
  } catch (error) {
    if (!controller.signal.aborted)
      achievementsLogger.warn("Achievement metadata export failed", error);
  } finally {
    clearTimeout(timeout);
    if (pending.get(gameKey) === controller) pending.delete(gameKey);
  }
}
