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

const EMAIL_COLUMNS =
  "id, code_number, name, email, phone, status, membership_levels ( name )";

// `options` = { status, levelId, search, emailFilter }
// emailFilter: "with" (default), "without" or "all".
function narrowMembers(query, { status, levelId, search }) {
  let q = query.is("deleted_at", null);
  if (status && status !== "all") q = q.eq("status", status);
  if (levelId) q = q.eq("membership_level_id", levelId);

  const filter = buildSearchFilter(search);
  if (filter) q = q.or(filter);
  return q;
}

function narrowByEmail(query, emailFilter) {
  if (emailFilter === "without") return query.is("email", null);
  if (emailFilter === "all") return query;
  return query.not("email", "is", null);
}

// How many members in the selection have / don't have an email address.
async function countEmailSplit(options) {
  const count = async (narrow) => {
    const { count: total, error } = await narrow(
      narrowMembers(
        requireSupabase().from("members").select("id", { count: "exact", head: true }),
        options,
      ),
    );
    if (error) throw error;
    return total ?? 0;
  };

  const [withEmail, withoutEmail] = await Promise.all([
    count((query) => query.not("email", "is", null)),
    count((query) => query.is("email", null)),
  ]);

  return { withEmail, withoutEmail };
}

// One page of members, plus the with/without counts for the whole selection.
// Returns { rows, total, page, withEmail, withoutEmail }.
export async function listMemberEmailsPage(options, page, pageSize) {
  const [result, split] = await Promise.all([
    fetchPage(
      () =>
        narrowMembers(
          narrowByEmail(
            requireSupabase().from("members").select(EMAIL_COLUMNS, { count: "exact" }),
            options.emailFilter,
          ),
          options,
        ).order("code_number", { ascending: true }),
      page,
      pageSize,
    ),
    countEmailSplit(options),
  ]);

  return { ...result, ...split };
}

export function listAllMemberEmails(options) {
  return fetchAll(() =>
    narrowMembers(
      narrowByEmail(
        requireSupabase().from("members").select(EMAIL_COLUMNS),
        options.emailFilter,
      ),
      options,
    ).order("code_number", { ascending: true })
  );
}

/* ------------- 4. Incomplete member records ------------- */

// The optional member details a report can check: [column, label].
export const MEMBER_DETAIL_FIELDS = [
  ["email", "Email"],
  ["phone", "Phone"],
  ["address", "Address"],
  ["organisation", "Organisation"],
  ["position", "Position"],
  ["specialisation", "Specialisation"],
  ["education_background", "Education background"],
];

const INCOMPLETE_COLUMNS = `
  id, code_number, name, status, email, phone, address, organisation,
  position, specialisation, education_background,
  membership_levels ( name )
`;

// `options` = { status, levelId, search, fields }
// A member matches when ANY of the chosen `fields` is empty. With no `fields`
// the condition is skipped (used to count everyone in the selection).
function narrowIncomplete(query, { status, levelId, search, fields }) {
  let q = query.is("deleted_at", null);
  if (status && status !== "all") q = q.eq("status", status);
  if (levelId) q = q.eq("membership_level_id", levelId);

  // Only known column names are ever put into the filter.
  const allowed = new Set(MEMBER_DETAIL_FIELDS.map(([column]) => column));
  const missing = (fields ?? [])
    .filter((column) => allowed.has(column))
    .map((column) => `${column}.is.null`)
    .join(",");
  const searchFilter = buildSearchFilter(search);

  // The member search and the "missing" condition must BOTH hold, so they are
  // combined into one filter.
  if (searchFilter && missing) return q.or(`and(or(${searchFilter}),or(${missing}))`);
  if (searchFilter) return q.or(searchFilter);
  if (missing) return q.or(missing);
  return q;
}

// Returns { rows, total, page, selectionTotal } where selectionTotal is how
// many members match the other filters, complete or not.
export async function listIncompleteMembersPage(options, page, pageSize) {
  const [result, selectionTotal] = await Promise.all([
    fetchPage(
      () =>
        narrowIncomplete(
          requireSupabase().from("members").select(INCOMPLETE_COLUMNS, { count: "exact" }),
          options,
        ).order("code_number", { ascending: true }),
      page,
      pageSize,
    ),
    (async () => {
      const { count, error } = await narrowIncomplete(
        requireSupabase().from("members").select("id", { count: "exact", head: true }),
        { ...options, fields: [] },
      );
      if (error) throw error;
      return count ?? 0;
    })(),
  ]);

  return { ...result, selectionTotal };
}

export function listAllIncompleteMembers(options) {
  return fetchAll(() =>
    narrowIncomplete(
      requireSupabase().from("members").select(INCOMPLETE_COLUMNS),
      options,
    ).order("code_number", { ascending: true })
  );
}

/* ---------------------- 5. Card status ---------------------- */

const CARD_STATUS_COLUMNS = `
  member_id, code_number, name, status, level_name, membership_expiry_date,
  card_state, issued_date, card_level_name, note
`;

// `options` = { cardState, status, levelId, search }
// cardState: "due", "post", "collect", "issued" (any physical card) or "all".
function narrowCards(query, { cardState, status, levelId, search }) {
  let q = query;
  if (cardState === "issued") q = q.neq("card_state", "due");
  else if (cardState && cardState !== "all") q = q.eq("card_state", cardState);

  if (status && status !== "all") q = q.eq("status", status);
  if (levelId) q = q.eq("membership_level_id", levelId);

  const filter = buildSearchFilter(search);
  if (filter) q = q.or(filter);
  return q;
}

const orderCards = (query) =>
  query
    .order("membership_expiry_date", { ascending: true })
    .order("code_number", { ascending: true });

export function listCardStatusPage(options, page, pageSize) {
  return fetchPage(
    () =>
      orderCards(narrowCards(
        requireSupabase().from("member_card_status").select(CARD_STATUS_COLUMNS, { count: "exact" }),
        options,
      )),
    page,
    pageSize,
  );
}

export function listAllCardStatus(options) {
  return fetchAll(() =>
    orderCards(narrowCards(
      requireSupabase().from("member_card_status").select(CARD_STATUS_COLUMNS),
      options,
    ))
  );
}

// How many members are in each card state, for the same member filters
// (the card-state filter itself is ignored). Returns { due, post, collect }.
export async function countCardStates(options) {
  const count = async (state) => {
    const { count: total, error } = await narrowCards(
      requireSupabase().from("member_card_status").select("member_id", { count: "exact", head: true }),
      { ...options, cardState: state },
    );
    if (error) throw error;
    return total ?? 0;
  };

  const [due, post, collect] = await Promise.all([
    count("due"),
    count("post"),
    count("collect"),
  ]);

  return { due, post, collect };
}

/* -------------------- 6. Card level changes -------------------- */

const CHANGE_COLUMNS = `
  card_id, member_id, code_number, name, status, delivery_method, issued_date,
  level_name, previous_level_name, previous_date, previous_method,
  days_since_previous, level_changed
`;

// `options` = { change, status, search, fromDate }
// Lists physical cards that have an earlier card (digital or physical) to compare with.
// change: "changed", "same" or "all"; fromDate: "YYYY-MM-DD" or null.
function narrowChanges(query, { change, status, search, fromDate }) {
  let q = query
    .in("delivery_method", ["post", "collect"])
    .not("previous_date", "is", null);

  if (change === "changed") q = q.eq("level_changed", true);
  else if (change === "same") q = q.eq("level_changed", false);

  if (status && status !== "all") q = q.eq("status", status);
  if (fromDate) q = q.gte("issued_date", fromDate);

  const filter = buildSearchFilter(search);
  if (filter) q = q.or(filter);
  return q;
}

const orderChanges = (query) =>
  query
    .order("issued_date", { ascending: false })
    .order("code_number", { ascending: true });

export function listCardChangesPage(options, page, pageSize) {
  return fetchPage(
    () =>
      orderChanges(narrowChanges(
        requireSupabase().from("member_card_changes").select(CHANGE_COLUMNS, { count: "exact" }),
        options,
      )),
    page,
    pageSize,
  );
}

export function listAllCardChanges(options) {
  return fetchAll(() =>
    orderChanges(narrowChanges(
      requireSupabase().from("member_card_changes").select(CHANGE_COLUMNS),
      options,
    ))
  );
}

// Returns { changed, same } for the same filters (the "change" filter itself is ignored).
export async function countCardChanges(options) {
  const count = async (change) => {
    const { count: total, error } = await narrowChanges(
      requireSupabase().from("member_card_changes").select("card_id", { count: "exact", head: true }),
      { ...options, change },
    );
    if (error) throw error;
    return total ?? 0;
  };

  const [changed, same] = await Promise.all([count("changed"), count("same")]);
  return { changed, same };
}

/* ------------------------ 7. Shared details ------------------------ */

// `options` = { fields, status, levelId, search, maxSize }
// fields: any of "name", "email", "phone", "organisation" - members match when ALL ticked details match.
// maxSize: the biggest group to show (null = any size). Groups always have at least 2 members.
function sharedArguments({ fields, status, levelId, search, maxSize }) {
  return {
    p_fields: fields ?? [],
    p_status: status && status !== "all" ? status : null,
    p_level: levelId || null,
    p_search: String(search ?? "").trim() || null,
    p_min_size: 2,
    p_max_size: maxSize ?? null,
  };
}

// One row per group: { group_key, shared_value, members_count, members: [{ id, code, name, level }] }.
export function listSharedGroupsPage(options, page, pageSize) {
  return fetchPage(
    () =>
      requireSupabase()
        .rpc("shared_details_report", sharedArguments(options), { count: "exact" })
        .order("members_count", { ascending: false })
        .order("shared_value", { ascending: true })
        .order("group_key", { ascending: true }),
    page,
    pageSize,
  );
}

// One row per member per group, for downloads.
export function listAllSharedMembers(options) {
  return fetchAll(() =>
    requireSupabase()
      .rpc("shared_details_members", sharedArguments(options))
      .order("members_count", { ascending: false })
      .order("shared_value", { ascending: true })
      .order("group_key", { ascending: true })
      .order("code_number", { ascending: true })
  );
}

// { groups, members }: how many groups, and how many different members are in them.
export async function getSharedTotals(options) {
  const { data, error } = await requireSupabase()
    .rpc("shared_details_totals", sharedArguments(options))
    .single();

  if (error) throw error;
  return data;
}
