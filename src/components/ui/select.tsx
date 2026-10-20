"use client";

import { Children, Fragment, isValidElement, type ReactNode } from "react";
import {
  Button, FieldError, I18nProvider, Label, ListBox, ListBoxItem, Popover,
  Select as AriaSelect, SelectValue,
} from "react-aria-components";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string; disabled?: boolean };
type OptionProps = { value?: string | number; disabled?: boolean; children?: ReactNode };
export type SelectProps = {
  value: string | number;
  onValueChange: (value: string) => void;
  children: ReactNode;
  label?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  className?: string;
  inline?: boolean;
  /** Keep overlays inside a native dialog's top layer. */
  popoverContainer?: Element;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

function textOf(children: ReactNode): string {
  return Children.toArray(children).map(child => isValidElement<OptionProps>(child)
    ? textOf(child.props.children) : typeof child === "string" || typeof child === "number" ? String(child) : "").join("").replace(/\s+/g, " ").trim();
}

/** Accept familiar option markup, but render a themed, keyboard-accessible listbox. */
function optionsOf(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<OptionProps>(child)) return [];
    if (child.type === Fragment) return optionsOf(child.props.children);
    if (child.type !== "option") return [];
    const label = textOf(child.props.children);
    return [{ value: String(child.props.value ?? label), label, disabled: child.props.disabled }];
  });
}

export function Select({ value, onValueChange, children, label, disabled, required, name, id, className, inline, popoverContainer, ...aria }: SelectProps) {
  const options = optionsOf(children);
  return <I18nProvider locale="pt-BR">
    <AriaSelect
      {...aria} id={id} name={name} value={String(value)} onChange={key => onValueChange(key == null ? "" : String(key))}
      isDisabled={disabled} isRequired={required} className={cn("app-select", inline && "app-control-inline")}
      disabledKeys={options.filter(option => option.disabled).map(option => option.value)}
      placeholder="Selecionar…"
    >
      {label && <Label className="app-control-label">{label}</Label>}
      <Button className={cn("field app-select-trigger", className)}>
        <SelectValue className="app-select-value" />
        <ChevronDown size={16} aria-hidden="true" className="app-select-chevron" />
      </Button>
      <Popover className="app-control-popover app-select-popover" placement="bottom start" offset={6} UNSTABLE_portalContainer={popoverContainer}>
        <ListBox className="app-select-list" items={options}>
          {option => <ListBoxItem id={option.value} textValue={option.label} className="app-select-option">
            {({ isSelected }) => <><span>{option.label}</span>{isSelected && <Check size={16} aria-hidden="true" />}</>}
          </ListBoxItem>}
        </ListBox>
      </Popover>
      <FieldError className="app-control-error" />
    </AriaSelect>
  </I18nProvider>;
}
