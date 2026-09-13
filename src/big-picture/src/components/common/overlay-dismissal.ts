interface EscapeEventLike {
  key: string;
  defaultPrevented: boolean;
}

export function shouldHandleOverlayEscape(event: EscapeEventLike) {
  return event.key === "Escape" && !event.defaultPrevented;
}
