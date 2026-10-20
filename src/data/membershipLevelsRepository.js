import { requireSupabase } from "./supabaseClient.js";

export async function listMembershipLevels() {
  const { data, error } = await requireSupabase()
    .from("membership_levels")
    .select("id, name, description, sort_order, is_active")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;
  return data;
}

export async function createMembershipLevel(values) {
  const { data, error } = await requireSupabase()
    .from("membership_levels")
    .insert(normalizeLevel(values))
    .select("id, name, description, sort_order, is_active")
    .single();

  if (error) throw friendlyError(error);
  return data;
}

export async function updateMembershipLevel(id, values) {
  const { data, error } = await requireSupabase()
    .from("membership_levels")
    .update(normalizeLevel(values))
    .eq("id", id)
    .select("id, name, description, sort_order, is_active")
    .single();

  if (error) throw friendlyError(error);
  return data;
}

export async function deleteMembershipLevel(id) {
  const { error } = await requireSupabase()
    .from("membership_levels")
    .delete()
    .eq("id", id);

  if (error) throw friendlyError(error);
}

function normalizeLevel({ name, description, sortOrder, isActive }) {
  const cleanedName = String(name ?? "").trim();
  const cleanedDescription = String(description ?? "").trim();
  const parsedSortOrder = Number.parseInt(String(sortOrder ?? "0"), 10);

  if (!cleanedName) throw new Error("Enter a membership level name.");
  if (cleanedName.length > 100) {
    throw new Error(
      "A membership level name can contain up to 100 characters.",
    );
  }
  if (cleanedDescription.length > 500) {
    throw new Error("The description can contain up to 500 characters.");
  }
  if (!Number.isInteger(parsedSortOrder) || parsedSortOrder < 0) {
    throw new Error("Sort order must be a whole number of zero or more.");
  }

  return {
    name: cleanedName,
    description: cleanedDescription || null,
    sort_order: parsedSortOrder,
    is_active: Boolean(isActive),
  };
}

function friendlyError(error) {
  if (error.code === "23505") {
    return new Error("A membership level with that name already exists.");
  }
  if (error.code === "42501") {
    return new Error("Only the admin account can change membership levels.");
  }
  return new Error(error.message || "Unable to save the membership level.");
}
