// Supabase access. The client is loaded lazily so practice mode never pays
// for the vendor bundle, and everything degrades gracefully when config.js
// is empty (online buttons show a setup hint instead).
//
// Every player signs in anonymously before touching the database: the
// server issues a real identity (auth.uid()), which is what the RLS
// policies in supabase/schema.sql verify. The session persists in
// localStorage, so a player keeps the same identity across visits.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const onlineConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let clientPromise = null;
let authedUser = null;

export function getClient() {
  if (!onlineConfigured) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import("../vendor/supabase.mjs").then(mod =>
      mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        realtime: { params: { eventsPerSecond: 10 } }
      })
    );
  }
  return clientPromise;
}

async function ensureAuth(sb) {
  if (authedUser) return authedUser;
  const { data: { session } } = await sb.auth.getSession();
  if (session && session.user) {
    authedUser = session.user;
    return authedUser;
  }
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) {
    throw new Error("Could not sign in (is Anonymous sign-in enabled in Supabase?): " + error.message);
  }
  authedUser = data.user;
  return authedUser;
}

export async function insertRoom(code) {
  const sb = await getClient();
  const user = await ensureAuth(sb);
  const { error } = await sb.from("rooms").insert({ code, host_id: user.id });
  return error;
}

export async function fetchRoom(code) {
  const sb = await getClient();
  await ensureAuth(sb);
  const { data, error } = await sb.from("rooms").select("*").eq("code", code).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function setRoomStatus(code, status) {
  const sb = await getClient();
  await ensureAuth(sb);
  await sb.from("rooms").update({ status }).eq("code", code);
}

export async function openChannel(code, playerId) {
  const sb = await getClient();
  await ensureAuth(sb);
  return sb.channel("room:" + code, {
    config: {
      broadcast: { self: false },
      presence: { key: playerId }
    }
  });
}
