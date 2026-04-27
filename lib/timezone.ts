export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export type TimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function isValidTimezone(timezone?: string | null): boolean {
  if (!timezone) return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimezone(timezone?: string | null): string {
  const clean = timezone?.trim();
  return isValidTimezone(clean) ? clean! : DEFAULT_TIMEZONE;
}

export function getTimezoneOffsetMs(date: Date, timezone?: string | null): number {
  const zone = normalizeTimezone(timezone);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values: Record<string, number> = {};

  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  const asUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour === 24 ? 0 : values.hour,
    values.minute,
    values.second,
  );

  return asUtc - date.getTime();
}

export function zonedLocalTimeToUtc(params: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timezone?: string | null;
}): Date {
  const zone = normalizeTimezone(params.timezone);

  const utcGuess = new Date(
    Date.UTC(params.year, params.month - 1, params.day, params.hour, params.minute, 0),
  );

  const offset = getTimezoneOffsetMs(utcGuess, zone);
  const utcDate = new Date(utcGuess.getTime() - offset);

  const secondOffset = getTimezoneOffsetMs(utcDate, zone);
  if (secondOffset !== offset) {
    return new Date(utcGuess.getTime() - secondOffset);
  }

  return utcDate;
}

export function parseLocalDateTime(params: {
  date: string;
  time: string;
  timezone?: string | null;
}) {
  const zone = normalizeTimezone(params.timezone);
  const dateMatch = params.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = params.time.match(/^(\d{1,2}):(\d{2})$/);

  if (!dateMatch || !timeMatch) {
    throw new Error("Expected date as yyyy-MM-dd and time as HH:mm");
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("Invalid reminder time");
  }

  const dueAtUtc = zonedLocalTimeToUtc({ year, month, day, hour, minute, timezone: zone });

  return {
    timezone: zone,
    dueAtUtc,
    dueAtUtcISO: dueAtUtc.toISOString(),
    dueAtLocalISO: `${params.date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`,
    displayText: formatInTimezone(dueAtUtc, zone),
  };
}

export function formatInTimezone(dateInput: Date | string, timezone?: string | null): string {
  const zone = normalizeTimezone(timezone);
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: zone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatTimezoneLabel(timezone?: string | null): string {
  const zone = normalizeTimezone(timezone);
  return zone.replace(/_/g, " ");
}

export function timezoneFromCity(input?: string | null): string | null {
  if (!input) return null;

  const clean = input.trim().toLowerCase();

  if (isValidTimezone(input)) return normalizeTimezone(input);

  const cityMap: Record<string, string> = {
    bangalore: "Asia/Kolkata",
    bengaluru: "Asia/Kolkata",
    mumbai: "Asia/Kolkata",
    delhi: "Asia/Kolkata",
    hyderabad: "Asia/Kolkata",
    chennai: "Asia/Kolkata",
    kolkata: "Asia/Kolkata",
    pune: "Asia/Kolkata",
    india: "Asia/Kolkata",
    dubai: "Asia/Dubai",
    abu_dhabi: "Asia/Dubai",
    uae: "Asia/Dubai",
    singapore: "Asia/Singapore",
    london: "Europe/London",
    uk: "Europe/London",
    new_york: "America/New_York",
    nyc: "America/New_York",
    california: "America/Los_Angeles",
    san_francisco: "America/Los_Angeles",
    los_angeles: "America/Los_Angeles",
    sydney: "Australia/Sydney",
    melbourne: "Australia/Melbourne",
    tokyo: "Asia/Tokyo",
  };

  const key = clean.replace(/[\s-]+/g, "_");
  return cityMap[key] || null;
}
