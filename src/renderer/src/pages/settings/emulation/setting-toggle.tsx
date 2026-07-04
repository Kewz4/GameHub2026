import cn from "classnames";

import "./setting-toggle.scss";

interface Props {
  /** Whether the toggle is on. */
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
}

/**
 * Branded on/off switch used for boolean emulator settings, replacing an
 * On/Off dropdown so a two-state setting reads as a toggle instead of a menu.
 */
export function SettingToggle({
  checked,
  disabled,
  onChange,
  ariaLabel,
}: Readonly<Props>) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("setting-toggle", {
        "setting-toggle--on": checked,
        "setting-toggle--disabled": disabled,
      })}
    >
      <span className="setting-toggle__thumb" />
    </button>
  );
}
