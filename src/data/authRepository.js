import { appConfig } from "../config.js";
import { requireSupabase } from "./supabaseClient.js";

function emailForUsername(username) {
  return appConfig.usernameEmailMap[username.trim().toLowerCase()] ?? null;
}

function loginError() {
  return new Error("The username or password is incorrect.");
}

export async function signIn(username, password) {
  const email = emailForUsername(username);
  if (!email || !password) throw loginError();

  const client = requireSupabase();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) throw loginError();

  const profile = await getProfile(data.session.user.id);
  if (!profile || profile.username !== username.trim().toLowerCase()) {
    await client.auth.signOut();
    throw loginError();
  }

  return { session: data.session, profile };
}

export async function signOut() {
  const { error } = await requireSupabase().auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (!data.session) return null;

  const profile = await getProfile(data.session.user.id);
  if (!profile) {
    await client.auth.signOut();
    return null;
  }

  return { session: data.session, profile };
}

async function getProfile(userId) {
  const { data, error } = await requireSupabase()
    .from("profiles")
    .select("id, username, role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}
