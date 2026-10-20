import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { appConfig } from "../config.js";

const isConfigured = Boolean(
  appConfig.supabaseUrl && appConfig.supabasePublishableKey,
);

export const configurationError =
  "The app has not been connected to Supabase yet. Add the project URL and publishable key in src/config.js.";

export const supabase = isConfigured
  ? createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  : null;

export function requireSupabase() {
  if (!supabase) throw new Error(configurationError);
  return supabase;
}
