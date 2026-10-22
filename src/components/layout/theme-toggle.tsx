"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

function initialTheme(): Theme {
  try {
    const saved = window.localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* Resolve the device preference once if storage is unavailable. */ }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.themePreference = theme;
  document.documentElement.dataset.theme = theme;
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== "theme" || (event.newValue !== "light" && event.newValue !== "dark")) return;
    applyTheme(event.newValue);
    onChange();
  };
  if (!["light", "dark"].includes(document.documentElement.dataset.theme || "")) applyTheme(initialTheme());
  window.addEventListener("storage", onStorage);
  window.addEventListener("theme-change", onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("theme-change", onChange);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light");

  function selectTheme(value: Theme) {
    applyTheme(value);
    try {
      window.localStorage.setItem("theme", value);
    } catch { /* Keep the selection for this visit when storage is unavailable. */ }
    window.dispatchEvent(new Event("theme-change"));
  }

  return (
    <button type="button" role="switch" aria-checked={theme === "dark"} aria-label="Tema escuro"
      onClick={() => selectTheme(theme === "dark" ? "light" : "dark")}
      className="relative inline-flex h-11 w-[72px] shrink-0 items-center justify-center rounded-full p-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-blue)]">
      <span aria-hidden="true" className="relative inline-flex h-7 w-14 items-center rounded-full bg-[var(--color-theme-track)]">
        <span className="absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-[var(--color-theme-thumb)] transition-transform duration-200 ease-in-out motion-reduce:transition-none dark:translate-x-7" />
        <Sun size={14} className="absolute left-[7px] text-[var(--color-accent-blue)] dark:text-[var(--color-text-secondary)]" />
        <Moon size={14} className="absolute right-[7px] text-[var(--color-text-secondary)] dark:text-[var(--color-on-primary)]" />
      </span>
    </button>
  );
}
