import { useId } from "react";
import { CheckIcon } from "@primer/octicons-react";
import "./checkbox-field.scss";

export interface CheckboxFieldProps
  extends React.DetailedHTMLProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    HTMLInputElement
  > {
  label: string | React.ReactNode;
}

export function CheckboxField({
  label,
  id: providedId,
  ...props
}: CheckboxFieldProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;

  return (
    <div className="checkbox-field">
      <div
        className={`checkbox-field__checkbox ${props.checked ? "checked" : ""}`}
      >
        <input
          id={id}
          type="checkbox"
          className="checkbox-field__input"
          {...props}
        />
        <span
          className={`checkbox-field__icon ${props.checked ? "checked" : ""}`}
          aria-hidden="true"
        >
          <CheckIcon />
        </span>
      </div>
      <label htmlFor={id} className="checkbox-field__label">
        {label}
      </label>
    </div>
  );
}
