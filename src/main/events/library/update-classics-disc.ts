import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { emulators } from "@main/services";
import type { ClassicsDisc, EmulatorSystem, GameShop } from "@types";

const updateClassicsDisc = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  disc: ClassicsDisc
) => {
  const key = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(key).catch(() => null);
  if (!game) return null;

  const platform = game.platform as EmulatorSystem | null;
  const sku = platform
    ? await emulators.extractDiscSku(disc.path, platform)
    : null;

  const updatedDisc: ClassicsDisc = { ...disc, sku };
  const existingDiscs = game.discs ?? [];
  const discs = existingDiscs.some((d) => d.path === disc.path)
    ? existingDiscs.map((d) => (d.path === disc.path ? updatedDisc : d))
    : [...existingDiscs, updatedDisc];

  const updated = { ...game, discs };
  await gamesSublevel.put(key, updated);
  return updated;
};

registerEvent("updateClassicsDisc", updateClassicsDisc);
