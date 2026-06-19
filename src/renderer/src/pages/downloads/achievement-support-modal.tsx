import { useTranslation } from "react-i18next";
import { Modal } from "@renderer/components";
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
}: AchievementSupportModalProps) {
  const handleEnable = async () => {
    await window.electron.enableExperimentalAchievements(shop, objectId);
    onClose();
  };

  return (
    <Modal visible={visible} title="No Achievement Support Detected" onClose={onClose}>
      <p style={{ marginBottom: "16px" }}>
        We couldn't detect a supported achievement emulator for{" "}
        <strong>{gameTitle}</strong>. Would you like to enable experimental
        achievement tracking? This will watch for achievement files created by
        the game.
      </p>
      <p style={{ marginBottom: "24px", fontSize: "0.875rem", opacity: 0.7 }}>
        If the game breaks or stops working, you can restore game files from the
        game's options menu.
      </p>
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <button onClick={onClose}>Not Now</button>
        <button onClick={handleEnable}>Enable Experimental Support</button>
      </div>
    </Modal>
  );
}
