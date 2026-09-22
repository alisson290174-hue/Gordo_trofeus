import { useId } from "react";
import { Icon } from "@renderer/components/icon/icon";

import "./checkbox-field.scss";

export interface CheckboxFieldProps
  extends React.DetailedHTMLProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    HTMLInputElement
  > {
  label: string | React.ReactNode;
}

export function CheckboxField({ label, ...props }: CheckboxFieldProps) {
  const id = useId();

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
        >
          <Icon name="check"  />
        </span>
      </div>
      <label htmlFor={id} className="checkbox-field__label">
        {label}
      </label>
    </div>
  );
}
