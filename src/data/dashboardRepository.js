import { requireSupabase } from "./supabaseClient.js";

// All dashboard numbers in one request (see dashboard_schema.sql).
export async function getDashboardSummary() {
  const { data, error } = await requireSupabase().rpc("dashboard_summary");
  if (error) throw error;

  const n = (value) => Number(value) || 0;

  return {
    activeMembers: n(data.active_members),
    suspendedMembers: n(data.suspended_members),
    newThisMonth: n(data.new_this_month),
    expired: n(data.expired),
    expiringWithin1: n(data.expiring_1),
    expiringWithin3: n(data.expiring_3),
    expiringWithin6: n(data.expiring_6),
    missingDetails: n(data.missing_details),
    cardsDue: n(data.cards_due),
    levels: (data.levels ?? []).map((level) => ({
      id: level.id,
      name: level.name,
      count: n(level.count),
    })),
  };
}
