import { requireSupabase } from "./supabaseClient.js";
import { listMembersPage } from "./memberRepository.js";

const HOUR_COLUMNS =
  "id, member_id, period_month, clinical_minutes, supervision_minutes, opd_points, updated_at, deleted_at";

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// How far back the year stepper may go. It is relative to today, so nothing
// needs changing when a new year starts.
export const YEARS_BACK = 30;

const MAX_MONTH_MINUTES = 31 * 24 * 60; // 44640
const MAX_OPD_POINTS = 9999;

/* ----------------------------- helpers ----------------------------- */

export function currentPeriod(now = new Date()) {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function yearBounds(now = new Date()) {
  const year = now.getFullYear();
  return { min: year - YEARS_BACK, max: year };
}

// "2026-10-01". Built as text on purpose: JavaScript Date objects can shift
// the day when the browser's time zone differs from UTC.
export function periodKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function splitMinutes(total) {
  const minutes = Math.max(0, Math.trunc(Number(total) || 0));
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

// 135 -> "2 h 15 min", 120 -> "2 h", 45 -> "45 min", 0 -> "0 h"
export function formatDuration(total) {
  const { hours, minutes } = splitMinutes(total);
  if (!hours && !minutes) return "0 h";
  return [hours ? `${hours} h` : "", minutes ? `${minutes} min` : ""]
    .filter(Boolean)
    .join(" ");
}

/* ------------------------------ queries ----------------------------- */

// Members that match a name or code (used by the member picker).
export async function searchMembersForHours(term) {
  const { members } = await listMembersPage({
    search: term,
    page: 1,
    pageSize: 8,
  });
  return members;
}

export async function listHoursForYear(memberId, year) {
  const { data, error } = await requireSupabase()
    .from("hour_records")
    .select(HOUR_COLUMNS)
    .eq("member_id", memberId)
    .gte("period_month", periodKey(year, 1))
    .lt("period_month", periodKey(year + 1, 1))
    .is("deleted_at", null)
    .order("period_month", { ascending: true });

  if (error) throw error;
  return data;
}

// Admin only (row-level security hides deleted records from everyone else).
export async function listDeletedHoursForYear(memberId, year) {
  const { data, error } = await requireSupabase()
    .from("hour_records")
    .select(HOUR_COLUMNS)
    .eq("member_id", memberId)
    .gte("period_month", periodKey(year, 1))
    .lt("period_month", periodKey(year + 1, 1))
    .not("deleted_at", "is", null)
    .order("period_month", { ascending: true });

  if (error) throw error;
  return data;
}

/* ----------------------------- changes ------------------------------ */

// Creates the record for a month, or updates it when `recordId` is given.
// `values` holds the form fields: clinicalHours, clinicalMinutes,
// supervisionHours, supervisionMinutes, opdPoints.
export async function saveHours({ memberId, year, month, recordId, values }) {
  const amounts = normalizeHours(values);
  const supabase = requireSupabase();

  if (recordId) {
    const { data, error } = await supabase
      .from("hour_records")
      .update(amounts)
      .eq("id", recordId)
      .select(HOUR_COLUMNS)
      .single();

    if (error) throw friendlyError(error);
    return data;
  }

  const now = currentPeriod();
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Choose a valid month.");
  }
  if (year > now.year || (year === now.year && month > now.month)) {
    throw new Error("Hours can't be recorded for a future month.");
  }

  const { data, error } = await supabase
    .from("hour_records")
    .insert({
      member_id: memberId,
      period_month: periodKey(year, month),
      ...amounts,
    })
    .select(HOUR_COLUMNS)
    .single();

  if (error) throw friendlyError(error);
  return data;
}

// Soft delete (admin only, enforced by a database trigger).
export async function deleteHours(id) {
  const { error } = await requireSupabase()
    .from("hour_records")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw friendlyError(error);
}

export async function restoreHours(id) {
  const { error } = await requireSupabase()
    .from("hour_records")
    .update({ deleted_at: null })
    .eq("id", id);

  if (error) throw friendlyError(error);
}

/* ---------------------------- validation ---------------------------- */

function wholeNumber(value, label) {
  const text = String(value ?? "").trim();
  if (text === "") return 0; // a blank box counts as 0
  if (!/^\d{1,6}$/.test(text)) {
    throw new Error(`${label} must be a whole number of zero or more.`);
  }
  return Number(text);
}

function duration(hoursValue, minutesValue, label) {
  const hours = wholeNumber(hoursValue, `${label} hours`);
  const minutes = wholeNumber(minutesValue, `${label} minutes`);

  if (minutes > 59) {
    throw new Error(`${label} minutes must be between 0 and 59.`);
  }

  const total = hours * 60 + minutes;
  if (total > MAX_MONTH_MINUTES) {
    throw new Error(`${label} time can't be more than 744 hours in one month.`);
  }
  return total;
}

function normalizeHours(values) {
  const opdPoints = wholeNumber(values.opdPoints, "OPD points");
  if (opdPoints > MAX_OPD_POINTS) {
    throw new Error(`OPD points can't be more than ${MAX_OPD_POINTS}.`);
  }

  return {
    clinical_minutes: duration(values.clinicalHours, values.clinicalMinutes, "Clinical"),
    supervision_minutes: duration(values.supervisionHours, values.supervisionMinutes, "Supervision"),
    opd_points: opdPoints,
  };
}

function friendlyError(error) {
  if (error.code === "23505") {
    return new Error("This month already has a record. Go back and reload the year to see it.");
  }
  if (error.code === "42501") {
    return new Error("You don't have permission to do that. Only the admin account can delete or restore hour records.");
  }
  if (error.code === "23503") {
    return new Error("This member no longer exists.");
  }
  if (error.code === "23514") {
    return new Error("One of the values is out of range.");
  }
  if (error.code === "PGRST116") {
    return new Error("That record could not be found or can no longer be changed.");
  }
  // Messages raised by the database rules (future month, deleted member...).
  if (error.code === "P0001" && error.message) {
    return new Error(error.message);
  }
  return new Error(error.message || "Unable to save the hours.");
}
