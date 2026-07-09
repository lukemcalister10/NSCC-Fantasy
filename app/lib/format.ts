import type { PlayerRole } from "../../src/config/types";

/** Whole-dollar price, e.g. 60000 → "$60,000". Prices are integer dollars (bigint). */
export function money(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  return "$" + Math.round(v).toLocaleString("en-AU");
}

/** Signed price movement, e.g. +8000 → "+$8,000", -5000 → "−$5,000". */
export function signedMoney(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return sign + "$" + Math.abs(Math.round(n)).toLocaleString("en-AU");
}

export type Direction = "up" | "down" | "flat";
export function direction(delta: number): Direction {
  return delta > 0 ? "up" : delta < 0 ? "down" : "flat";
}

export const ROLE_LABEL: Record<PlayerRole, string> = {
  BAT: "BAT",
  WK: "WK",
  BWL: "BWL",
  AR: "AR",
};

/** Human date from an ISO/date string, e.g. "2026-10-04" → "4 Oct 2026". */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Date + time, for round lock datetimes (per-round lock, D6). */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Monogram initials for the photo-slot placeholder, e.g. "Sam Waugh" → "SW". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
