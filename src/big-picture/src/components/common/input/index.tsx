import "./styles.scss";

import cn from "classnames";
import { Typography } from "../typography";
import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useId,
  useRef,
} from "react";
import { FocusItem } from "..";
import type { FocusOverrides, NavigationNodeState } from "../../../services";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
  focusNavigationState?: NavigationNodeState;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    type = "text",
    placeholder = "Placeholder",
    className,
    label,
    hint,
    error = false,
    disabled = false,
    iconLeft,
    iconRight,
    focusId,
    focusNavigationOverrides,
    focusNavigationState,
    id: idProp,
    ...props
  },
  ref
) {
  const generatedId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId =
    idProp ?? `big-picture-input-${generatedId.replaceAll(":", "")}`;
  const resolvedFocusNavigationState =
    focusNavigationState ?? (disabled ? "disabled" : "active");

  const setInputRef = (element: HTMLInputElement | null) => {
    inputRef.current = element;

    if (typeof ref === "function") {
      ref(element);
    } else if (ref) {
      ref.current = element;
    }
  };

  return (
    <div className={cn("input-container", className)}>
      {label && (
        <Typography variant="label" className="input-label">
          {label}
        </Typography>
      )}
      <div className="input-wrapper">
        <FocusItem
          id={focusId}
          actions={{ primary: () => inputRef.current?.focus() }}
          navigationOverrides={focusNavigationOverrides}
          navigationState={resolvedFocusNavigationState}
        >
          <input
            ref={setInputRef}
            id={inputId}
            type={type}
            placeholder={placeholder}
            disabled={disabled}
            data-icon-left={iconLeft ? "true" : undefined}
            data-icon-right={iconRight ? "true" : undefined}
            className={`input ${error ? "input--error" : ""} ${
              disabled ? "input--disabled" : ""
            }`}
            {...props}
          />
        </FocusItem>
        {iconLeft && (
          <div className="input-icon input-icon--left">{iconLeft}</div>
        )}
        {iconRight && (
          <div className="input-icon input-icon--right">{iconRight}</div>
        )}
      </div>
      {hint && (
        <p className={cn("input-hint", { "input-hint--error": error })}>
          {hint}
        </p>
      )}
    </div>
  );
});
