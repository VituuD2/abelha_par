"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "light" | "dark" | "system";
const options = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
] as const;

function readTheme(): Theme {
  const theme = document.documentElement.dataset.themePreference;
  return theme === "light" || theme === "dark" ? theme : "system";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.themePreference = theme;
  document.documentElement.dataset.theme = theme === "system"
    ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const onSystemChange = () => applyTheme(readTheme());
  const onStorage = (event: StorageEvent) => {
    if (event.key !== "theme" && event.key !== null) return;
    applyTheme(event.newValue === "light" || event.newValue === "dark" ? event.newValue : "system");
    onChange();
  };
  applyTheme(readTheme());
  media?.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);
  window.addEventListener("theme-change", onChange);
  return () => {
    media?.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("theme-change", onChange);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system");

  function selectTheme(value: Theme) {
    applyTheme(value);
    try {
      window.localStorage.setItem("theme", value);
    } catch { /* Keep the selection for this visit when storage is unavailable. */ }
    window.dispatchEvent(new Event("theme-change"));
  }

  return (
    <div role="group" aria-label="Tema da interface" className="flex gap-1 rounded-xl border border-[var(--color-border-light)] bg-[var(--color-bg-tertiary)] p-1">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={`Tema ${label.toLowerCase()}`}
          aria-pressed={theme === value}
          onClick={() => selectTheme(value)}
          className={`flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[11px] font-semibold transition-colors ${theme === value
            ? "bg-[var(--color-accent-yellow)] text-[#30291f] shadow-sm"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"}`}
        >
          <Icon aria-hidden="true" className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  );
}
