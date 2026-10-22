import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Shares the primary action style used throughout the app. */
export function Button({ className, ...props }: ComponentProps<"button">) {
  return <button className={cn("btn-primary", className)} {...props} />;
}
