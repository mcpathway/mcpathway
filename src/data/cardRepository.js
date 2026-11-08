import { requireSupabase } from "./supabaseClient.js";

const CARD_COLUMNS = `
  id, member_id, membership_level_id, valid_until, delivery_method,
  issued_date, note, deleted_at, created_at,
  membership_levels ( name )
`;

export const DELIVERY_LABELS = {
  digital: "Digital ID",
  post: "Posted",
  collect: "Collected",
};

// Live cards of one member, newest cycle first.
export async function listCardsForMember(memberId) {
  const { data, error } = await requireSupabase()
    .from("member_cards")
    .select(CARD_COLUMNS)
    .eq("member_id", memberId)
    .is("deleted_at", null)
    .order("issued_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw friendlyError(error);
  return data;
}

// Deleted cards of one member (only the admin account can read these).
export async function listDeletedCardsForMember(memberId) {
  const { data, error } = await requireSupabase()
    .from("member_cards")
    .select(CARD_COLUMNS)
    .eq("member_id", memberId)
    .not("deleted_at", "is", null)
    .order("issued_date", { ascending: false });

  if (error) throw friendlyError(error);
  return data;
}

export async function createCard(values) {
  const { data, error } = await requireSupabase()
    .from("member_cards")
    .insert({
      member_id: String(values.memberId ?? ""),
      valid_until: String(values.validUntil ?? ""),
      ...normalizeCard(values),
    })
    .select(CARD_COLUMNS)
    .single();

  if (error) throw friendlyError(error);
  return data;
}

// The member and valid-until date can't change; delete the card and add a new one instead.
export async function updateCard(id, values) {
  const { data, error } = await requireSupabase()
    .from("member_cards")
    .update(normalizeCard(values))
    .eq("id", id)
    .select(CARD_COLUMNS)
    .single();

  if (error) throw friendlyError(error);
  return data;
}

// Soft delete: only the admin account is allowed (enforced by a database trigger).
export async function deleteCard(id) {
  const { error } = await requireSupabase()
    .from("member_cards")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw friendlyError(error);
}

export async function restoreCard(id) {
  const { error } = await requireSupabase()
    .from("member_cards")
    .update({ deleted_at: null })
    .eq("id", id);

  if (error) throw friendlyError(error);
}

function normalizeCard(values) {
  const clean = (value) => String(value ?? "").trim();

  const method = clean(values.deliveryMethod);
  const levelId = clean(values.membershipLevelId);
  const issuedDate = clean(values.issuedDate);
  const note = clean(values.note);

  if (method !== "post" && method !== "collect") {
    throw new Error("Choose Posted or Collected.");
  }
  if (!levelId) throw new Error("Choose the membership level on the card.");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedDate) || Number.isNaN(Date.parse(issuedDate))) {
    throw new Error(
      method === "post" ? "Enter the date the card was posted." : "Enter the date the card was collected.",
    );
  }
  if (note.length > 500) throw new Error("The note can contain up to 500 characters.");

  return {
    membership_level_id: levelId,
    delivery_method: method,
    issued_date: issuedDate,
    note: note || null,
  };
}

function friendlyError(error) {
  if (error.code === "42501") {
    return new Error("You don't have permission to do that. Only the admin account can delete or restore cards.");
  }
  if (error.code === "23505") {
    return new Error("This exact card (same date, type and level) has already been recorded.");
  }
  if (error.code === "23503") {
    return new Error("The selected membership level or member no longer exists.");
  }
  if (error.code === "PGRST116") {
    return new Error("That card could not be found or can no longer be changed.");
  }
  return new Error(error.message || "Unable to save the card.");
}
