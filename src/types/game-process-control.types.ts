import type { GameShop } from "./game.types";

export type GameProcessControlStatus =
  | "idle"
  | "waiting"
  | "running"
  | "paused"
  | "stopped"
  | "error"
  | "unavailable";

export type GameProcessControlState = {
  status: GameProcessControlStatus;
  shop: GameShop | null;
  objectId: string | null;
  gameTitle: string | null;
  rootPid: number;
  processCount: number;
  canPause: boolean;
  canResume: boolean;
  canClose: boolean;
  message: string | null;
  updatedAt: number;
};
