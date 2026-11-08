// The ONE date format used across the system: month and year, e.g. "Oct 2026".
// Dates come from the database as "YYYY-MM-DD"; they are read as plain text,
// never through `new Date(...)`, so the time zone can't shift the month.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMonthYear(value) {
  const match = /^(\d{4})-(\d{2})/.exec(String(value ?? ""));
  if (!match) return "";

  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : "";
}
