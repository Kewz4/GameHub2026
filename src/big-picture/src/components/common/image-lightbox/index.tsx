import "./styles.scss";

import { XIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import { useNavigationScreenActions } from "../../../hooks";
import { NAVIGATION_SCREEN_ACTION_PRIORITY } from "../../../services";
import { Backdrop } from "../backdrop";

export interface ImageLightboxProps {
  src: string;
  alt: string;
  onClose?: () => void;
}

export function ImageLightbox({
  src,
  alt,
  onClose,
}: Readonly<ImageLightboxProps>) {
  useNavigationScreenActions(onClose ? { press: { b: onClose } } : {}, {
    priority: NAVIGATION_SCREEN_ACTION_PRIORITY.floating,
  });

  useEffect(() => {
    if (!onClose) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    globalThis.window.addEventListener("keydown", onKeyDown);
    return () => globalThis.window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <Backdrop>
      <div
        className="image-lightbox__surface"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose?.();
        }}
      >
        {onClose && (
          <button
            type="button"
            className="image-lightbox__close"
            onClick={onClose}
            aria-label="Close image"
          >
            <XIcon size={28} aria-hidden="true" />
          </button>
        )}
        <img src={src} alt={alt} className="image-lightbox" draggable={false} />
      </div>
    </Backdrop>
  );
}
