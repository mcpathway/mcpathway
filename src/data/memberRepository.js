import { requireSupabase } from "./supabaseClient.js";

const MEMBER_COLUMNS = `
  id, code_number, name, membership_level_id, membership_expiry_date,
  education_background, organisation, position, email, address, phone,
  specialisation, status, deleted_at,
  membership_levels ( name )
`;

export const MEMBERS_PAGE_SIZE = 20;
const EXPORT_PAGE_SIZE = 1000; // Supabase returns at most 1000 rows per request.

export function formatMemberCode(codeNumber) {
  return String(codeNumber).padStart(5, "0");
}

// How the member list can be sorted (the second sort is always the code number, for a stable order).
export const MEMBER_SORTS = {
  newest: [["code_number", false]],
  oldest: [["code_number", true]],
  name: [["name", true], ["code_number", true]],
  expiry_soon: [["membership_expiry_date", true], ["code_number", true]],
  expiry_late: [["membership_expiry_date", false], ["code_number", true]],
};

// "YYYY-MM-DD" for a Date, in the browser's own time zone.
function dateText(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Today plus some months; a day that doesn't exist in the target month (31 Jan + 1 month) becomes its last day.
function monthsFromToday(months) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(now.getDate(), lastDay));
  return dateText(target);
}

// The conditions shared by the list and the downloads.
//   levelId  "" = any level
//   organisation  part of the organisation name ("" = any)
//   expiry   "" = any, "expired", "valid" (not expired yet), or "1" / "3" / "6" = expires within that many months
function narrowMembers(
  query,
  { search = "", includeDeleted = false, levelId = "", expiry = "", organisation = "" } = {},
) {
  let q = query;
  if (!includeDeleted) q = q.is("deleted_at", null);

  const filter = buildSearchFilter(search);
  if (filter) q = q.or(filter);

  if (levelId) q = q.eq("membership_level_id", levelId);

  // Characters with a special meaning in a LIKE pattern are removed so the text can't change the match.
  const org = String(organisation ?? "").replace(/[%_*\\]/g, " ").replace(/\s+/g, " ").trim();
  if (org) q = q.ilike("organisation", `%${org}%`);

  const today = dateText(new Date());
  if (expiry === "expired") q = q.lt("membership_expiry_date", today);
  else if (expiry === "valid") q = q.gte("membership_expiry_date", today);
  else if (["1", "3", "6"].includes(String(expiry))) {
    q = q.gte("membership_expiry_date", today).lte("membership_expiry_date", monthsFromToday(Number(expiry)));
  }

  return q;
}

function sortMembers(query, sort) {
  let q = query;
  for (const [column, ascending] of MEMBER_SORTS[sort] ?? MEMBER_SORTS.newest) {
    q = q.order(column, { ascending });
  }
  return q;
}

// One page of members (newest first unless `sort` says otherwise).
// `search` matches part of a name, or a code number ("12" or "00012").
// Returns { members, total, page } where `page` is the page actually served
// (it moves back to the last page if the requested one no longer exists,
// e.g. after deleting the only member on the final page).
export async function listMembersPage({
  page = 1,
  pageSize = MEMBERS_PAGE_SIZE,
  search = "",
  includeDeleted = false,
  levelId = "",
  expiry = "",
  organisation = "",
  sort = "newest",
} = {}) {
  const supabase = requireSupabase();
  const filters = { search, includeDeleted, levelId, expiry, organisation };

  const run = (pageNumber, countOnly = false) => {
    const query = narrowMembers(
      supabase
        .from("members")
        .select(countOnly ? "id" : MEMBER_COLUMNS, {
          count: "exact",
          head: countOnly,
        }),
      filters,
    );
    if (countOnly) return query;

    const from = (pageNumber - 1) * pageSize;
    return sortMembers(query, sort).range(from, from + pageSize - 1);
  };

  let currentPage = Math.max(1, Math.floor(Number(page)) || 1);
  let { data, error, count } = await run(currentPage);

  // PGRST103 = the requested page is past the end of the results.
  if (error?.code === "PGRST103") {
    const head = await run(1, true);
    if (head.error) throw head.error;
    currentPage = Math.max(1, Math.ceil((head.count ?? 0) / pageSize));
    ({ data, error, count } = await run(currentPage));
  }

  if (error) throw error;
  return { members: data, total: count ?? data.length, page: currentPage };
}

// Builds a PostgREST "or" filter. Characters that have a special meaning in a
// filter or in a LIKE pattern are removed so the search text can't break it.
export function buildSearchFilter(search) {
  const term = String(search ?? "")
    .replace(/[%_*,()"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!term) return null;

  const parts = [`name.ilike.%${term}%`];
  if (/^\d{1,15}$/.test(term)) parts.push(`code_number.eq.${Number(term)}`);
  return parts.join(",");
}

// The organisations already in use (without repeats, ignoring capital letters), as suggestions
// for the organisation filter.
export async function listOrganisations() {
  const { data, error } = await requireSupabase()
    .from("members")
    .select("organisation")
    .is("deleted_at", null)
    .not("organisation", "is", null)
    .limit(EXPORT_PAGE_SIZE);

  if (error) throw error;

  const seen = new Map();
  for (const { organisation } of data) {
    const name = String(organisation ?? "").trim();
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// Pages through every member that matches the filters (used for downloads, so the
// 1000-row default limit can't silently truncate the file). Deleted members are never included.
// `filters` = { search, levelId, expiry, organisation, sort } - the same choices as the list on screen.
export async function listAllMembersForExport(
  { search = "", levelId = "", expiry = "", organisation = "", sort = "newest" } = {},
) {
  const supabase = requireSupabase();
  const all = [];

  for (let from = 0;; from += EXPORT_PAGE_SIZE) {
    const { data, error } = await sortMembers(
      narrowMembers(supabase.from("members").select(MEMBER_COLUMNS), {
        search,
        includeDeleted: false,
        levelId,
        expiry,
        organisation,
      }),
      sort,
    ).range(from, from + EXPORT_PAGE_SIZE - 1);

    if (error) throw error;
    all.push(...data);
    if (data.length < EXPORT_PAGE_SIZE) break;
  }

  return all;
}

export async function createMember(values) {
  const { data, error } = await requireSupabase()
    .from("members")
    .insert(normalizeMember(values))
    .select(MEMBER_COLUMNS)
    .single();

  if (error) throw friendlyError(error);
  return data;
}

export async function updateMember(id, values) {
  const { data, error } = await requireSupabase()
    .from("members")
    .update(normalizeMember(values))
    .eq("id", id)
    .select(MEMBER_COLUMNS)
    .single();

  if (error) throw friendlyError(error);
  return data;
}

// Soft delete: the row stays in the database so hours/reports remain accurate.
// Only the admin account is allowed (enforced by a database trigger).
export async function deleteMember(id) {
  const { error } = await requireSupabase()
    .from("members")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw friendlyError(error);
}

export async function restoreMember(id) {
  const { error } = await requireSupabase()
    .from("members")
    .update({ deleted_at: null })
    .eq("id", id);

  if (error) throw friendlyError(error);
}

function normalizeMember(values) {
  const clean = (value) => String(value ?? "").trim();
  const optional = (value) => clean(value) || null;

  const name = clean(values.name);
  const membershipLevelId = clean(values.membershipLevelId);
  const expiry = clean(values.membershipExpiryDate);
  // Stored in lower case, so Name@Mail.com and name@mail.com are the same address.
  const email = optional(values.email)?.toLowerCase() ?? null;
  const status = clean(values.status) || "active";

  if (!name) throw new Error("Enter the member's name.");
  if (name.length > 200) throw new Error("The name can contain up to 200 characters.");
  if (!membershipLevelId) throw new Error("Choose a membership level.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || Number.isNaN(Date.parse(expiry))) {
    throw new Error("Enter a valid membership expiry date.");
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  if (!["active", "suspended"].includes(status)) {
    throw new Error("Choose Active or Suspended.");
  }

  const limits = [
    ["education background", values.educationBackground, 2000],
    ["organisation", values.organisation, 200],
    ["position", values.position, 200],
    ["address", values.address, 1000],
    ["phone number", values.phone, 50],
    ["specialisation", values.specialisation, 200],
  ];
  for (const [label, value, max] of limits) {
    if (clean(value).length > max) {
      throw new Error(`The ${label} can contain up to ${max} characters.`);
    }
  }

  return {
    name,
    membership_level_id: membershipLevelId,
    membership_expiry_date: expiry,
    education_background: optional(values.educationBackground),
    organisation: optional(values.organisation),
    position: optional(values.position),
    email,
    address: optional(values.address),
    phone: optional(values.phone),
    specialisation: optional(values.specialisation),
    status,
  };
}

function friendlyError(error) {
  if (error.code === "42501") {
    return new Error("You don't have permission to do that. Only the admin account can delete or restore members.");
  }
  if (error.code === "23503") {
    return new Error("The selected membership level no longer exists.");
  }
  if (error.code === "23505" && String(error.message).includes("members_name_email_unique_idx")) {
    return new Error("A member with this name and email address already exists.");
  }
  if (error.code === "PGRST116") {
    return new Error("That member record could not be found or can no longer be changed.");
  }
  return new Error(error.message || "Unable to save the member.");
}
