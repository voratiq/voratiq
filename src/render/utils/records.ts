import {
  createLocalDateTimeFormatter,
  formatLocalTimeZoneLabel,
} from "./timezone.js";

const RUN_TIMESTAMP_FORMAT = createLocalDateTimeFormatter({
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatRunTimestamp(isoTimestamp: string): string {
  try {
    const date = new Date(isoTimestamp);
    if (Number.isNaN(date.getTime())) {
      return isoTimestamp;
    }

    const parts = RUN_TIMESTAMP_FORMAT.formatToParts(date);
    const lookup = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;

    const year = lookup("year");
    const month = lookup("month");
    const day = lookup("day");
    const hour = lookup("hour");
    const minute = lookup("minute");

    if (!year || !month || !day || !hour || !minute) {
      return isoTimestamp;
    }

    const timeZoneLabel = formatLocalTimeZoneLabel(date);

    return `${year}-${month}-${day} ${hour}:${minute} ${timeZoneLabel}`;
  } catch {
    return isoTimestamp;
  }
}
