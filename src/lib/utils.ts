import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names with conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format a date for display in the user's timezone. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("ar", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

/** Format a numeric(12,3) quantity string, trimming trailing zeros ("3.000" → "3"). */
export function formatQuantity(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  return text.replace(/\.?0+$/, "");
}
