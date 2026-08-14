import type { Game } from "@types";

export const isSameOverlayGame = (
  activeGame: Pick<Game, "shop" | "objectId"> | null,
  candidate: Pick<Game, "shop" | "objectId">
) =>
  activeGame?.shop === candidate.shop &&
  activeGame.objectId === candidate.objectId;

/**
 * Refresh the selected game, or restore a surviving running session after a
 * newer overlapping game closes. Never steal the slot while another game is
 * still the selected active session.
 */
export const shouldActivateOverlayGame = (
  activeGame: Pick<Game, "shop" | "objectId"> | null,
  candidate: Pick<Game, "shop" | "objectId">
) => activeGame === null || isSameOverlayGame(activeGame, candidate);
