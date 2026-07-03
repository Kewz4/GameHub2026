import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { CheckIcon, ChevronDownIcon } from "@primer/octicons-react";
import cn from "classnames";

import "./setting-select.scss";

export interface SettingSelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: SettingSelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * Branded replacement for the native <select> in emulator settings — a styled
 * trigger + a portalled, keyboard-navigable menu (Radix), so the dropdown looks
 * like the app instead of an OS control and its open state is fully wired.
 */
export function SettingSelect({
  value,
  options,
  disabled,
  onChange,
}: Readonly<Props>) {
  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn("setting-select__trigger", {
            "setting-select__trigger--disabled": disabled,
          })}
        >
          <span className="setting-select__value">
            {current?.label ?? value}
          </span>
          <ChevronDownIcon size={14} className="setting-select__chevron" />
        </button>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          className="setting-select__content"
          sideOffset={6}
          align="end"
          collisionPadding={16}
        >
          {options.map((option) => (
            <DropdownMenuPrimitive.Item
              key={option.value}
              className={cn("setting-select__item", {
                "setting-select__item--active": option.value === value,
              })}
              onSelect={() => onChange(option.value)}
            >
              <span className="setting-select__item-check">
                {option.value === value && <CheckIcon size={14} />}
              </span>
              <span>{option.label}</span>
            </DropdownMenuPrimitive.Item>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
