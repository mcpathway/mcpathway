import { requireSupabase } from "./supabaseClient.js";
import { buildSearchFilter } from "./memberRepository.js";

// How many rows a report shows per page.
export const REPORT_PAGE_SIZE = 20;

const FETCH_ALL_PAGE_SIZE = 1000; // Supabase returns at most 1000 rows per request.

// Reads every page of a query (used by downloads and "copy").
// `buildQuery` must return a NEW query each time.
async function fetchAll(buildQuery) {
  const all = [];

  for (let from = 0;; from += FETCH_ALL_PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + FETCH_ALL_PAGE_SIZE - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < FETCH_ALL_PAGE_SIZE) break;
  }

  return all;
}

// Reads ONE page plus the total number of matching rows. The query must ask
// for an exact count. If the requested page no longer exists (rows were
// removed meanwhile) it falls back to page 1.
// Returns { rows, total, page }.
async function fetchPage(buildQuery, page, pageSize) {
  const run = (pageNumber) =>
    buildQuery().range((pageNumber - 1) * pageSize, pageNumber * pageSize - 1);

  let current = Math.max(1, Math.floor(Number(page)) || 1);
  let { data, error, count } = await run(current);

  if (error?.code === "PGRST103" && current > 1) {
    current = 1;
    ({ data, error, count } = await run(1));
  }

  if (error) throw error;
  return { rows: data, total: count ?? data.length, page: current };
}

/* ---------------- 1. Memberships expiring soon ---------------- */

const EXPIRING_COLUMNS = `
  id, code_number, name, membership_expiry_date, status, email, phone,
  membership_levels ( name )
`;

// `options` = { startDate, endDate, status, search } - dates are "YYYY-MM-DD".
function narrowExpiring(query, { startDate, endDate, status, search }) {
  let q = query.is("deleted_at", null).lte("membership_expiry_date", endDate);
  if (startDate) q = q.gte("membership_expiry_date", startDate);
  if (status && status !== "all") q = q.eq("status", status);

  const filter = buildSearchFilter(search);
  if (filter) q = q.or(filter);
  return q;
}

const orderExpiring = (query) =>
  query
    .order("membership_expiry_date", { ascending: true })
    .order("code_number", { ascending: true });

export function listMembersExpiringPage(options, page, pageSize) {
  return fetchPage(
    () =>
      orderExpiring(narrowExpiring(
        requireSupabase().from("members").select(EXPIRING_COLUMNS, { count: "exact" }),
        options,
      )),
    page,
    pageSize,
  );
}

export function listAllMembersExpiring(options) {
  return fetchAll(() =>
    orderExpiring(narrowExpiring(
      requireSupabase().from("members").select(EXPIRING_COLUMNS),
      options,
    ))
  );
}

// Counts members in the same selection; `extra` adds more conditions.
export async function countMembersExpiring(options, extra = (query) => query) {
  const { count, error } = await extra(
    narrowExpiring(
      requireSupabase().from("members").select("id", { count: "exact", head: true }),
      options,
    ),
  );

  if (error) throw error;
  return count ?? 0;
}

/* --------------------- 2. Member hours --------------------- */

// `options` = { from, to, status, search, hideEmpty } - see reports_schema.sql.
function hoursArguments({ from, to, status, search, hideEmpty }) {
  return {
    p_from: from,
    p_to: to,
    p_status: status ?? null,
    p_search: String(search ?? "").trim() || null,
    p_hide_empty: Boolean(hideEmpty),
  };
}

export function listMemberHoursPage(options, page, pageSize) {
  return fetchPage(
    () =>
      requireSupabase().rpc("member_hours_report", hoursArguments(options), {
        count: "exact",
      }),
    page,
    pageSize,
  );
}

export function listAllMemberHours(options) {
  return fetchAll(() =>
    requireSupabase().rpc("member_hours_report", hoursArguments(options))
  );
}

export async function getMemberHoursTotals(options) {
  const { data, error } = await requireSupabase()
    .rpc("member_hours_totals", hoursArguments(options))
    .single();

  if (error) throw error;
  return data;
}

/* ---------------------- 3. Member emails ---------------------- */

const EMAIL_COLUMNS = "id, code_number, name, email, status, membership_levels ( name )";

// `options` = { status, levelId, search }
function narrowMembers(query, { status, levelId, search }) {
  let q = query.is("deleted_at", null);
  if (status && status !== "all") q = q.eq("status", status);
  if (levelId) q = q.eq("membership_level_id", levelId);

  const filter = buildSearchFilter(search);
  if (filter) q = q.or(filter);
  return q;
}

// One page of members that have an email, plus how many in the same
// selection have none. Returns { rows, total, page, withoutEmail }.
export async function listMemberEmailsPage(options, page, pageSize) {
  const [result, withoutEmail] = await Promise.all([
    fetchPage(
      () =>
        narrowMembers(
          requireSupabase()
            .from("members")
            .select(EMAIL_COLUMNS, { count: "exact" })
            .not("email", "is", null),
          options,
        ).order("code_number", { ascending: true }),
      page,
      pageSize,
    ),
    (async () => {
      const { count, error } = await narrowMembers(
        requireSupabase()
          .from("members")
          .select("id", { count: "exact", head: true })
          .is("email", null),
        options,
      );
      if (error) throw error;
      return count ?? 0;
    })(),
  ]);

  return { ...result, withoutEmail };
}

export function listAllMemberEmails(options) {
  return fetchAll(() =>
    narrowMembers(
      requireSupabase()
        .from("members")
        .select(EMAIL_COLUMNS)
        .not("email", "is", null),
      options,
    ).order("code_number", { ascending: true })
  );
}
