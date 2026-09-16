// Shared auth helpers built on top of sb (see supabase-client.js)

async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

async function getProfile(userId) {
  const { data, error } = await sb
    .from("profiles")
    .select("id, email, is_admin")
    .eq("id", userId)
    .single();
  if (error) return null;
  return data;
}

async function signUp(email, password) {
  return sb.auth.signUp({ email, password });
}

async function signIn(email, password) {
  return sb.auth.signInWithPassword({ email, password });
}

async function signOut() {
  return sb.auth.signOut();
}
