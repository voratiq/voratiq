const resolvedTimeZone = (() => {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timeZone === "string" && timeZone.length > 0
      ? timeZone
      : undefined;
  } catch {
    return undefined;
  }
})();

export function getLocalTimeZone(): string | undefined {
  return resolvedTimeZone;
}

export function createLocalDateTimeFormatter(
  options: Intl.DateTimeFormatOptions,
  locales: Intl.LocalesArgument = "en-CA",
): Intl.DateTimeFormat {
  if (resolvedTimeZone) {
    return new Intl.DateTimeFormat(locales, {
      timeZone: resolvedTimeZone,
      ...options,
    });
  }

  return new Intl.DateTimeFormat(locales, options);
}

export function formatLocalTimeZoneLabel(date: Date): string {
  try {
    const parts = createLocalDateTimeFormatter({
      timeZoneName: "short",
    }).formatToParts(date);
    const label = parts.find((part) => part.type === "timeZoneName")?.value;
    if (label && label.length > 0) {
      return label;
    }
  } catch {
    // Fall through to offset-based formatting.
  }

  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");

  return minutes === "00"
    ? `GMT${sign}${hours}`
    : `GMT${sign}${hours}:${minutes}`;
}
