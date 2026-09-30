export function saoPauloDate(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(date);
}

export function isValidDateRange(from: string, to: string, maxDays = 31) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  return valid(from) && valid(to) && from <= to
    && (Date.parse(to) - Date.parse(from)) / 86_400_000 < maxDays;
}
