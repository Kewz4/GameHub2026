import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { HydraApi, logger } from "@main/services";
import type { GameShop, UserGame } from "@types";

const toggleGamePin = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  pin: boolean
) => {
  try {
    const gameKey = levelKeys.game(shop, objectId);

    const game = await gamesSublevel.get(gameKey);
    if (!game) return;

    // Custom games don't exist on the Hydra API — pin them locally only.
    // For catalogue games, an API failure shouldn't block the local pin.
    const isLocalOnly = shop === "custom";

    if (pin) {
      let pinnedDate = new Date();
      if (!isLocalOnly) {
        const response = await HydraApi.put<UserGame>(
          `/profile/games/${shop}/${objectId}/pin`
        ).catch(() => null);
        if (response?.pinnedDate) pinnedDate = new Date(response.pinnedDate);
      }

      await gamesSublevel.put(gameKey, {
        ...game,
        isPinned: pin,
        pinnedDate,
      });
    } else {
      if (!isLocalOnly) {
        await HydraApi.put(`/profile/games/${shop}/${objectId}/unpin`).catch(
          () => null
        );
      }

      await gamesSublevel.put(gameKey, {
        ...game,
        isPinned: pin,
        pinnedDate: null,
      });
    }
  } catch (error) {
    logger.error("Failed to update game pinned status", error);
    throw new Error(`Failed to update game pinned status: ${error}`);
  }
};

registerEvent("toggleGamePin", toggleGamePin);
