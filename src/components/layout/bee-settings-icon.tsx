import type { SVGProps } from "react";

export function BeeSettingsIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M13 10C5 1 2 9 8 13M19 10c8-9 11-1 5 3" />
    <ellipse cx="16" cy="16" rx="6" ry="8" />
    <path d="M11 13h10M10 17h12M12 21h8M14 8l-2-4m6 4 2-4M16 24v3" />
    <path d="m26 19 .5 2 2 .6-.4 2-1.8.7-.6 1.9-2-.3-.8-1.7-1.9-.6.3-2 1.8-.8.6-1.9Z" />
    <circle cx="25" cy="23" r="1.1" />
  </svg>;
}
