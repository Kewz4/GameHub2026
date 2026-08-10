import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import cn from "classnames";
import { Backdrop } from "../backdrop";
import { IS_BROWSER } from "../../../constants";
import { FocusRegionContext } from "../../context";
import { useNavigationScreenActions } from "../../../hooks";

import "./styles.scss";
import { ArrowLeftIcon, XIcon } from "@phosphor-icons/react";
import { NavigationLayer } from "../navigation-layer";
import { shouldHandleOverlayEscape } from "../overlay-dismissal";
import { NAVIGATION_SCREEN_ACTION_PRIORITY } from "../../../services";
import { VerticalFocusGroup } from "../vertical-focus-group";
import { HorizontalFocusGroup } from "../horizontal-focus-group";
import { FocusItem } from "../focus-item";

export interface ModalProps {
  visible: boolean;
  onClose: () => void;
  onBack?: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  coverImage?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  closeOnB?: boolean;
  ariaLabel?: string;
  animateLayout?: boolean;
  /** Render directly at full opacity when another dialog remains underneath. */
  noAnimation?: boolean;
  /** Focus target used when this modal creates its navigation layer. */
  initialFocusId?: string;
}

export const MODAL_OWNED_OVERLAY_ATTRIBUTE = "data-hydra-modal-owned-overlay";

export function Modal({
  visible,
  onClose,
  onBack,
  title,
  description,
  children,
  coverImage,
  className,
  closeOnBackdrop = true,
  closeOnEscape = true,
  closeOnB = true,
  ariaLabel = title,
  animateLayout = false,
  noAnimation = false,
  initialFocusId,
}: Readonly<ModalProps>) {
  const modalContentRef = useRef<HTMLDivElement | null>(null);
  const generatedId = useId().replaceAll(":", "");
  const rootRegionId = `modal-root-${generatedId}`;
  const headerRegionId = `modal-header-${generatedId}`;
  const backFocusId = `modal-back-${generatedId}`;
  const closeFocusId = `modal-close-${generatedId}`;

  const isTopMostModal = () => {
    const openModals = document.querySelectorAll("[role=dialog]");
    return (
      openModals.length &&
      openModals[openModals.length - 1] === modalContentRef.current
    );
  };

  const handleCloseClick = useCallback(() => {
    onClose();
  }, [onClose]);

  const shouldCloseOnB = visible && closeOnB;

  const handleBPress = useCallback(() => {
    if (!isTopMostModal()) return;
    handleCloseClick();
  }, [handleCloseClick]);

  useNavigationScreenActions(
    shouldCloseOnB ? { press: { b: handleBPress } } : {},
    { priority: NAVIGATION_SCREEN_ACTION_PRIORITY.modal }
  );

  useEffect(() => {
    if (!visible || !closeOnEscape) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (shouldHandleOverlayEscape(e) && isTopMostModal()) {
        handleCloseClick();
      }
    };

    globalThis.window.addEventListener("keydown", onKeyDown);
    return () => globalThis.window.removeEventListener("keydown", onKeyDown);
  }, [closeOnEscape, visible, handleCloseClick]);

  useEffect(() => {
    if (!closeOnBackdrop || !visible) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!isTopMostModal()) return;

      const target = e.target as Node | null;
      const targetElement = target instanceof Element ? target : null;
      const clickedOwnedOverlay = targetElement?.closest(
        `[${MODAL_OWNED_OVERLAY_ATTRIBUTE}]`
      );

      const clickedOutside =
        modalContentRef.current &&
        target &&
        !modalContentRef.current.contains(target) &&
        !clickedOwnedOverlay;

      if (clickedOutside) handleCloseClick();
    };

    globalThis.window.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      globalThis.window.removeEventListener("pointerdown", onPointerDown, true);
  }, [closeOnBackdrop, visible, handleCloseClick]);

  if (!IS_BROWSER) return null;

  const portalTarget =
    document.getElementById("big-picture") ??
    document.getElementById("root") ??
    document.body;

  return createPortal(
    <FocusRegionContext.Provider value={null}>
      <AnimatePresence>
        {visible && (
          <Backdrop>
            <NavigationLayer
              rootRegionId={rootRegionId}
              initialFocusId={initialFocusId}
            >
              <VerticalFocusGroup regionId={rootRegionId} asChild>
                <motion.aside
                  role="dialog"
                  aria-modal="true"
                  aria-label={ariaLabel}
                  ref={modalContentRef}
                  data-hydra-dialog
                  className={cn("modal", className)}
                  layout={animateLayout || undefined}
                  initial={
                    noAnimation ? false : { opacity: 0, y: 24, scale: 0.96 }
                  }
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={
                    noAnimation ? undefined : { opacity: 0, y: 16, scale: 0.98 }
                  }
                  transition={{
                    duration: noAnimation ? 0 : 0.22,
                    ease: [0.22, 1, 0.36, 1],
                    layout: { duration: 0.4, ease: "easeInOut" },
                  }}
                >
                  <HorizontalFocusGroup regionId={headerRegionId} asChild>
                    <div className="modal__header">
                      {coverImage && (
                        <div className="modal__header-cover-image">
                          <img src={coverImage} alt={title} />
                        </div>
                      )}

                      <div className="modal__header-title">
                        {onBack && (
                          <FocusItem id={backFocusId} asChild>
                            <button
                              type="button"
                              className="modal__header-back-button"
                              aria-label={`Back from ${title}`}
                              onClick={onBack}
                            >
                              <ArrowLeftIcon size={20} aria-hidden="true" />
                            </button>
                          </FocusItem>
                        )}

                        <h4>{title}</h4>
                      </div>

                      {description && (
                        <p className="modal__header-description">
                          {description}
                        </p>
                      )}

                      <FocusItem id={closeFocusId} asChild>
                        <button
                          type="button"
                          className="modal__header-close-button"
                          aria-label={`Close ${title}`}
                          onClick={handleCloseClick}
                        >
                          <XIcon size={24} aria-hidden="true" />
                        </button>
                      </FocusItem>
                    </div>
                  </HorizontalFocusGroup>

                  <div className="modal__divider" />

                  <div className="modal__content">{children}</div>
                </motion.aside>
              </VerticalFocusGroup>
            </NavigationLayer>
          </Backdrop>
        )}
      </AnimatePresence>
    </FocusRegionContext.Provider>,
    portalTarget
  );
}
