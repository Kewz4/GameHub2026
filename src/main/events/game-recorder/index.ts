import type {
  GameRecorderPcmChunkMetadata,
  GameRecorderSegmentMetadata,
  UserPreferences,
} from "@types";
import { GameRecorderManager } from "@main/services/game-recorder-manager";
import { db, levelKeys } from "@main/level";
import { registerEvent } from "../register-event";

registerEvent("gameRecorderGetState", () => GameRecorderManager.getState());
registerEvent("gameRecorderStart", () => GameRecorderManager.startRecording());
registerEvent("gameRecorderStop", () => GameRecorderManager.stopRecording());
registerEvent("gameRecorderSaveReplay", () =>
  GameRecorderManager.saveInstantReplay()
);
registerEvent("gameRecorderOpenOutputDirectory", () =>
  GameRecorderManager.openOutputDirectory()
);

registerEvent(
  "gameRecorderCommitSegment",
  (event, metadata: GameRecorderSegmentMetadata, payload: ArrayBuffer) =>
    GameRecorderManager.commitSegment(event.sender.id, metadata, payload)
);
registerEvent(
  "gameRecorderCommitPcmChunk",
  (event, metadata: GameRecorderPcmChunkMetadata, payload: ArrayBuffer) =>
    GameRecorderManager.commitPcmChunk(event.sender.id, metadata, payload)
);
registerEvent("gameRecorderCaptureError", (event, message: string) =>
  GameRecorderManager.handleCaptureError(event.sender.id, String(message))
);
registerEvent("gameRecorderCaptureReady", (event) =>
  GameRecorderManager.handleCaptureReady(event.sender.id)
);

// Settings can render the OS-resolved default before a game has started.
registerEvent("gameRecorderGetPreferences", async () => {
  const preferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);
  await GameRecorderManager.applyUserPreferences(preferences ?? {});
  return GameRecorderManager.probeCaptureCapabilities();
});
