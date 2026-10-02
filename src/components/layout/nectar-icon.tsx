import type { SVGProps } from "react";
export function NectarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 3c-2.6 3.8-6 7.3-6 11a6 6 0 0 0 12 0c0-3.7-3.4-7.2-6-11Z" />
      <path d="m12 10 3 1.8v3.4L12 17l-3-1.8v-3.4l3-1.8Z" />
      <path d="M9 20h6" />
    </svg>
  );
}
