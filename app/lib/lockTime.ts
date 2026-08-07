/**
 * ROUND LOCK DEFAULT (D6): "per-round lock datetime (default Sat 11:00 Adelaide
 * time, STORED PER ROUND, never hardcoded)".
 *
 * The distinction matters and is easy to lose: the default belongs to the FORM,
 * not to the system. This module proposes a value the operator can change before
 * saving; once saved, the stored `rounds.lock_at` is the only thing any lock check
 * ever reads (0002's enforce_round_lock reads it per round, G4 proves it).
 *
 * Adelaide runs ACST (+9:30) and ACDT (+10:30), so the UTC instant behind
 * "Saturday 11:00 Adelaide" moves by an hour across the season. The offset is
 * therefore never written down here — it is asked of the platform's timezone
 * database for the specific date in question.
 */

const ZONE = "Australia/Adelaide";

const PARTS = new Intl.DateTimeFormat("en-AU", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** The zone's offset from UTC, in minutes, at a given instant. */
function offsetMinutesAt(instant: Date): number {
  const parts = Object.fromEntries(
    PARTS.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    Number(parts["hour"] === "24" ? "0" : parts["hour"]),
    Number(parts["minute"]),
    Number(parts["second"]),
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/**
 * The instant at which Adelaide's wall clock reads the given local date/time.
 * Two passes: guess with the offset in force at the naive instant, then re-read
 * the offset at the candidate — which is what gets a time on a DST changeover
 * weekend right instead of an hour out.
 */
export function adelaideLocalToInstant(
  year: number,
  month1: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const naive = Date.UTC(year, month1 - 1, day, hour, minute);
  let candidate = new Date(naive - offsetMinutesAt(new Date(naive)) * 60_000);
  candidate = new Date(naive - offsetMinutesAt(candidate) * 60_000);
  return candidate;
}

/** Adelaide-local calendar parts for an instant. */
function adelaideParts(instant: Date): { year: number; month1: number; day: number; weekday: number } {
  const parts = Object.fromEntries(
    PARTS.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const year = Number(parts["year"]);
  const month1 = Number(parts["month"]);
  const day = Number(parts["day"]);
  // Weekday of that Adelaide calendar date (0 = Sunday), computed from the date
  // itself so it cannot be skewed by the reader's own timezone.
  const weekday = new Date(Date.UTC(year, month1 - 1, day)).getUTCDay();
  return { year, month1, day, weekday };
}

/**
 * D6's proposed default: 11:00 Adelaide on the FIRST Saturday strictly after
 * `from` (defaults to now). Returned as an ISO instant, which is what
 * `rounds.lock_at` stores.
 */
export function defaultRoundLockAt(from: Date = new Date()): string {
  const { year, month1, day, weekday } = adelaideParts(from);
  const daysAhead = ((6 - weekday + 7) % 7) || 7; // 6 = Saturday; never "today"
  const target = new Date(Date.UTC(year, month1 - 1, day + daysAhead));
  const t = adelaideParts(target);
  return adelaideLocalToInstant(t.year, t.month1, t.day, 11, 0).toISOString();
}

/**
 * An ISO instant as the value a `datetime-local` input wants, expressed in
 * ADELAIDE local time — so the operator edits the same clock the club runs on
 * rather than their browser's.
 */
export function toAdelaideInputValue(iso: string): string {
  const parts = Object.fromEntries(
    PARTS.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const hour = parts["hour"] === "24" ? "00" : parts["hour"]!;
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${hour}:${parts["minute"]}`;
}

/** The inverse: a `datetime-local` value read as Adelaide wall time. */
export function fromAdelaideInputValue(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return new Date(value).toISOString();
  return adelaideLocalToInstant(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  ).toISOString();
}

/** Adelaide-clock rendering, labelled, so a lock time is never ambiguous. */
export function adelaideLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    d.toLocaleString("en-AU", {
      timeZone: ZONE,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }) + " Adelaide"
  );
}
