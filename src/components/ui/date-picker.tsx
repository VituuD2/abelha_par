"use client";

import {
  Button, Calendar, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader,
  CalendarHeaderCell, CalendarMonthPicker, CalendarYearPicker, DateInput, DatePicker as AriaDatePicker,
  DatePickerStateContext, DateSegment, Dialog, FieldError, Group, I18nProvider, Label, Popover,
} from "react-aria-components";
import { parseDate, today, type CalendarDate } from "@internationalized/date";
import { useContext } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Select } from "./select";
import { cn } from "@/lib/utils";

export type DatePickerProps = {
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  className?: string;
  "aria-label"?: string;
};

function date(value?: string): CalendarDate | undefined {
  if (!value) return undefined;
  try { return parseDate(value); } catch { return undefined; }
}

function CalendarActions({ min, max, required }: Pick<DatePickerProps, "min" | "max" | "required">) {
  const state = useContext(DatePickerStateContext);
  const current = today("America/Sao_Paulo");
  const available = (!min || current.toString() >= min) && (!max || current.toString() <= max);
  return <div className="app-calendar-actions">
    {!required && <Button className="app-calendar-action" onPress={() => { state?.setValue(null); state?.close(); }}>Limpar</Button>}
    <Button className="app-calendar-action" isDisabled={!available} onPress={() => { state?.setValue(current); state?.close(); }}>Hoje</Button>
  </div>;
}

/** Date-only values remain YYYY-MM-DD; no UTC conversion can move a sale to another day. */
export function DatePicker({ value, onValueChange, label, min, max, disabled, required, name, id, className, ...aria }: DatePickerProps) {
  return <I18nProvider locale="pt-BR">
    <AriaDatePicker
      {...aria} id={id} name={name} value={date(value) ?? null} onChange={value => onValueChange(value?.toString() ?? "")}
      minValue={date(min)} maxValue={date(max)} isDisabled={disabled} isRequired={required}
      placeholderValue={today("America/Sao_Paulo")} shouldForceLeadingZeros className="app-date-picker"
    >
      {label && <Label className="app-control-label">{label}</Label>}
      <Group className={cn("field app-date-field", className)}>
        <DateInput className="app-date-input">{segment => <DateSegment segment={segment} className="app-date-segment" />}</DateInput>
        <Button className="app-calendar-trigger" aria-label={label ? `Abrir calendário: ${label}` : "Abrir calendário"}><CalendarDays size={18} /></Button>
      </Group>
      <FieldError className="app-control-error" />
      <Popover className="app-control-popover app-calendar-popover" placement="bottom start" offset={8}>
        <Dialog className="app-calendar-dialog" aria-label={label ? `Calendário: ${label}` : "Selecionar data"}>
          <Calendar className="app-calendar" firstDayOfWeek="sun">
            <header className="app-calendar-header">
              <Button slot="previous" className="app-calendar-nav" aria-label="Mês anterior"><ChevronLeft size={18} /></Button>
              <div className="app-calendar-caption">
                <CalendarMonthPicker>{props => <Select aria-label={props["aria-label"]} value={String(props.value)} onValueChange={value => props.onChange(Number(value))} className="app-calendar-caption-select">
                  {props.items.map(item => <option key={item.id} value={item.id}>{item.formatted}</option>)}
                </Select>}</CalendarMonthPicker>
                <CalendarYearPicker visibleYears={100}>{props => <Select aria-label={props["aria-label"]} value={String(props.value)} onValueChange={value => props.onChange(Number(value))} className="app-calendar-caption-select">
                  {props.items.map(item => <option key={item.id} value={item.id}>{item.formatted}</option>)}
                </Select>}</CalendarYearPicker>
              </div>
              <Button slot="next" className="app-calendar-nav" aria-label="Próximo mês"><ChevronRight size={18} /></Button>
            </header>
            <CalendarGrid className="app-calendar-grid" weekdayStyle="short">
              <CalendarGridHeader>{day => <CalendarHeaderCell className="app-calendar-weekday">{day}</CalendarHeaderCell>}</CalendarGridHeader>
              <CalendarGridBody>{day => <CalendarCell date={day} className="app-calendar-day" />}</CalendarGridBody>
            </CalendarGrid>
          </Calendar>
          <CalendarActions min={min} max={max} required={required} />
        </Dialog>
      </Popover>
    </AriaDatePicker>
  </I18nProvider>;
}
