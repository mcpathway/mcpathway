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

// One page of members, newest first (highest code number first).
// `search` matches part of a name, or a code number ("12" or "00012").
// Returns { members, total, page } where `page` is the page actually served
// (it moves back to the last page if the requested one no longer exists,
// e.g. after deleting the only member on the final page).
export async function listMembersPage({
  page = 1,
  pageSize = MEMBERS_PAGE_SIZE,
  search = "",
  includeDeleted = false,
} = {}) {
  const supabase = requireSupabase();
  const filter = buildSearchFilter(search);

  const run = (pageNumber, countOnly = false) => {
    let query = supabase
      .from("members")
      .select(countOnly ? "id" : MEMBER_COLUMNS, {
        count: "exact",
        head: countOnly,
      });

    if (!includeDeleted) query = query.is("deleted_at", null);
    if (filter) query = query.or(filter);
    if (countOnly) return query;

    const from = (pageNumber - 1) * pageSize;
    return query
      .order("code_number", { ascending: false })
      .range(from, from + pageSize - 1);
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

// Pages through every active member (used for exports, so the 1000-row
// default limit can't silently truncate the file).
export async function listAllMembersForExport() {
  const supabase = requireSupabase();
  const all = [];

  for (let from = 0;; from += EXPORT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("members")
      .select(MEMBER_COLUMNS)
      .is("deleted_at", null)
      .order("code_number", { ascending: true })
      .range(from, from + EXPORT_PAGE_SIZE - 1);

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
  const email = optional(values.email);
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
  if (error.code === "PGRST116") {
    return new Error("That member record could not be found or can no longer be changed.");
  }
  return new Error(error.message || "Unable to save the member.");
}
