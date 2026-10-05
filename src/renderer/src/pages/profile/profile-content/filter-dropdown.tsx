import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "@renderer/components/icon/icon";

import "./filter-dropdown.scss";

export interface FilterDropdownOption<T extends string> {
  value: T;
  label: string;
  icon: ReactNode;
}

interface FilterDropdownProps<T extends string> {
  placeholder: string;
  value: T;
  options: FilterDropdownOption<T>[];
  onChange: (value: T) => void;
}

export function FilterDropdown<T extends string>({
  placeholder,
  value,
  options,
  onChange,
}: FilterDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="filter-dropdown" ref={containerRef}>
      <button
        type="button"
        className={`filter-dropdown__trigger ${open ? "filter-dropdown__trigger--open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="filter-dropdown__placeholder">{placeholder}</span>
        {selected && (
          <span className="filter-dropdown__value">
            {selected.icon}
            <span>{selected.label}</span>
          </span>
        )}
        <Icon
          name="chevron-down"
          size={14}
          className="filter-dropdown__chevron"
        />
      </button>

      {open && (
        <div className="filter-dropdown__menu" role="listbox">
          {options.map((option) => {
            const isActive = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`filter-dropdown__option ${isActive ? "filter-dropdown__option--active" : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="filter-dropdown__option-icon">
                  {option.icon}
                </span>
                <span className="filter-dropdown__option-label">
                  {option.label}
                </span>
                {isActive && (
                  <Icon
                    name="check"
                    size={14}
                    className="filter-dropdown__check"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
