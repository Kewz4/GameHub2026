import {
  type ControllerSupportDetails,
  getControllerSupportCopyKeys,
  resolveControllerSupport,
} from "@shared";
import { GameControllerIcon } from "@phosphor-icons/react";
import type { GameShop } from "@types";
import type { FocusOverrides } from "../../../../services";
import { FocusItem, Typography } from "../../../common";

const COPY: Record<string, { label: string; description: string }> = {
  controller_support_full_label: {
    label: "Full controller support",
    description:
      "This game is fully playable with a controller, including menus.",
  },
  controller_support_partial_label: {
    label: "Partial controller support",
    description:
      "This game supports a controller for gameplay, but some menus may require a keyboard or mouse.",
  },
  controller_support_none_label: {
    label: "No controller support",
    description: "",
  },
};

export interface ControllerSupportBoxProps {
  shop: GameShop | undefined;
  shopDetails: unknown;
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
  focusNavigationOrder?: number;
}

export function ControllerSupportBox({
  shop,
  shopDetails,
  focusId,
  focusNavigationOverrides,
  focusNavigationOrder,
}: Readonly<ControllerSupportBoxProps>) {
  if (shop !== "steam" || !shopDetails) return null;

  const status = resolveControllerSupport(
    shopDetails as ControllerSupportDetails
  );

  if (status === "none") return null;

  const copy = getControllerSupportCopyKeys(status);
  const labelCopy = COPY[copy.labelKey];

  return (
    <FocusItem
      id={focusId}
      navigationOverrides={focusNavigationOverrides}
      navigationOrder={focusNavigationOrder}
      asChild
    >
      <div className="game-page__sidebar-section game-page__controller-support">
        <div className="game-page__controller-support-header">
          <GameControllerIcon size={24} />
          <Typography>{labelCopy.label}</Typography>
        </div>
        {labelCopy.description && (
          <Typography className="game-page__controller-support-description">
            {labelCopy.description}
          </Typography>
        )}
      </div>
    </FocusItem>
  );
}
