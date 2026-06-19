import { ConfirmationModal } from "@renderer/components";
import type { GameShop } from "@types";

interface AchievementSupportModalProps {
  visible: boolean;
  gameTitle: string;
  shop: GameShop;
  objectId: string;
  onClose: () => void;
}

export function AchievementSupportModal({
  visible,
  gameTitle,
  shop,
  objectId,
  onClose,
}: Readonly<AchievementSupportModalProps>) {
  const handleConfirm = async () => {
    await window.electron.enableExperimentalAchievements(shop, objectId);
    onClose();
  };

  return (
    <ConfirmationModal
      visible={visible}
      title="No achievement support detected"
      descriptionText={`We couldn't find a supported achievement emulator for "${gameTitle}". Enable experimental achievement tracking? If the game breaks or stops working, you can restore game files from the game's options menu.`}
      confirmButtonLabel="Enable"
      cancelButtonLabel="Not now"
      onConfirm={handleConfirm}
      onClose={onClose}
    />
  );
}
