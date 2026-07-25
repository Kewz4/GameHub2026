import { useId, useState } from "react";
import "./select-field.scss";
import cn from "classnames";

export interface SelectProps
  extends React.DetailedHTMLProps<
    React.SelectHTMLAttributes<HTMLSelectElement>,
    HTMLSelectElement
  > {
  theme?: "primary" | "dark";
  label?: string;
  options?: { key: string; value: string; label: string }[];
}

export function SelectField({
  value,
  label,
  options = [{ key: "-", value: value?.toString() || "-", label: "-" }],
  theme = "primary",
  onChange,
  onFocus,
  onBlur,
  className,
  ...props
}: Readonly<SelectProps>) {
  const [isFocused, setIsFocused] = useState(false);
  const id = useId();

  return (
    <div className={cn("select-field__container", className)}>
      {label && (
        <label htmlFor={id} className="select-field__label">
          {label}
        </label>
      )}

      <div
        className={cn("select-field", `select-field--${theme}`, {
          "select-field--focused": isFocused,
        })}
      >
        <select
          {...props}
          id={id}
          value={value}
          className="select-field__option"
          onFocus={(event) => {
            setIsFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setIsFocused(false);
            onBlur?.(event);
          }}
          onChange={onChange}
        >
          {options.map((option) => (
            <option key={option.key} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
