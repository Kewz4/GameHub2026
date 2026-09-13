type ShortcutInput = {
  type: string;
  key?: string;
  code?: string;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  isAutoRepeat?: boolean;
};

/** Electron's focused-window path backs up the OS shortcut registration. */
export function isOverlayShortcutInput(input: ShortcutInput) {
  return (
    input.type === "keyDown" &&
    !input.isAutoRepeat &&
    Boolean(input.shift) &&
    !input.alt &&
    !input.meta &&
    (input.code === "F3" || input.key?.toLowerCase() === "f3")
  );
}
