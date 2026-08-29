export type OverlayUnavailableReason =
  | "exclusive-fullscreen"
  | "window-compositor-unavailable"
  | "focus-refused";

const OVERLAY_UNAVAILABLE_MESSAGES: Record<OverlayUnavailableReason, string> = {
  "exclusive-fullscreen":
    "Exclusive fullscreen is not supported. Switch the game to Borderless or Windowed.",
  "window-compositor-unavailable":
    "GameHub could not attach to this game window. Use Borderless or Windowed mode and try again.",
  "focus-refused":
    "The game kept exclusive display control. Switch it to Borderless or Windowed and try again.",
};

export const getOverlayUnavailableMessage = (search: string) => {
  const params = new URLSearchParams(search);
  if (params.get("kind") !== "overlay-unavailable") return null;

  const reason = params.get("reason") as OverlayUnavailableReason | null;
  if (!reason || !(reason in OVERLAY_UNAVAILABLE_MESSAGES)) {
    return OVERLAY_UNAVAILABLE_MESSAGES["window-compositor-unavailable"];
  }
  return OVERLAY_UNAVAILABLE_MESSAGES[reason];
};
