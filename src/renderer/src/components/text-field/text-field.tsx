import React, { useId, useState } from "react";
import { EyeClosedIcon, EyeIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import "./text-field.scss";

export interface TextFieldProps
  extends React.DetailedHTMLProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    HTMLInputElement
  > {
  theme?: "primary" | "dark";
  label?: string | React.ReactNode;
  hint?: string | React.ReactNode;
  textFieldProps?: React.DetailedHTMLProps<
    React.HTMLAttributes<HTMLDivElement>,
    HTMLDivElement
  >;
  containerProps?: React.DetailedHTMLProps<
    React.HTMLAttributes<HTMLDivElement>,
    HTMLDivElement
  >;
  rightContent?: React.ReactNode | null;
  error?: string | React.ReactNode;
}

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  (
    {
      theme = "primary",
      label,
      hint,
      textFieldProps,
      containerProps,
      rightContent = null,
      error,
      id: providedId,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const id = providedId ?? generatedId;
    const [isFocused, setIsFocused] = useState(false);
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const { t } = useTranslation("forms");
    const showPasswordToggleButton = props.type === "password";
    const inputType =
      props.type === "password" && isPasswordVisible
        ? "text"
        : (props.type ?? "text");
    const descriptionId = error || hint ? `${id}-description` : undefined;
    const handleFocus: React.FocusEventHandler<HTMLInputElement> = (event) => {
      setIsFocused(true);
      props.onFocus?.(event);
    };
    const handleBlur: React.FocusEventHandler<HTMLInputElement> = (event) => {
      setIsFocused(false);
      props.onBlur?.(event);
    };
    const hasError = !!error;
    return (
      <div className="text-field-container" {...containerProps}>
        {label && <label htmlFor={id}>{label}</label>}
        <div className="text-field-container__text-field-wrapper">
          <div
            className={cn(
              "text-field-container__text-field",
              `text-field-container__text-field--${theme}`,
              {
                "text-field-container__text-field--has-error": hasError,
                "text-field-container__text-field--focused": isFocused,
              }
            )}
            {...textFieldProps}
          >
            <input
              ref={ref}
              id={id}
              className={cn("text-field-container__text-field-input", {
                "text-field-container__text-field-input--read-only":
                  props.readOnly,
              })}
              {...props}
              aria-describedby={
                [props["aria-describedby"], descriptionId]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              aria-invalid={props["aria-invalid"] ?? hasError}
              onFocus={handleFocus}
              onBlur={handleBlur}
              type={inputType}
            />
            {showPasswordToggleButton && (
              <button
                type="button"
                className="text-field-container__toggle-password-button"
                onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                aria-label={t("toggle_password_visibility")}
              >
                {isPasswordVisible ? (
                  <EyeClosedIcon size={16} aria-hidden="true" />
                ) : (
                  <EyeIcon size={16} aria-hidden="true" />
                )}
              </button>
            )}
          </div>
          {rightContent}
        </div>
        {error ? (
          <small
            id={descriptionId}
            className="text-field-container__error-label"
          >
            {error}
          </small>
        ) : hint ? (
          <small id={descriptionId}>{hint}</small>
        ) : null}
      </div>
    );
  }
);
TextField.displayName = "TextField";
