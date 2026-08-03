// Supabase access. The client is loaded lazily so practice mode never pays
// for the vendor bundle, and everything degrades gracefully when config.js
// is empty (online buttons show a setup hint instead).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const onlineConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let clientPromise = null;

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

export async function insertRoom(code, hostId) {
  const sb = await getClient();
  const { error } = await sb.from("rooms").insert({ code, host_id: hostId });
  return error;
}

export async function fetchRoom(code) {
  const sb = await getClient();
  const { data, error } = await sb.from("rooms").select("*").eq("code", code).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function setRoomStatus(code, status) {
  const sb = await getClient();
  await sb.from("rooms").update({ status }).eq("code", code);
}

export async function openChannel(code, playerId) {
  const sb = await getClient();
  return sb.channel("room:" + code, {
    config: {
      broadcast: { self: false },
      presence: { key: playerId }
    }
  });
}
