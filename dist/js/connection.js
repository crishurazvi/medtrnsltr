const LOCAL_STORAGE_KEY = "medtranslate.supabase.connection.v2";
const SESSION_STORAGE_KEY = "medtranslate.supabase.connection.session.v2";

function decodeJwtPayload(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const normalized = parts[1].replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function normalizeConnection({ supabaseUrl = "", supabasePublishableKey = "" } = {}) {
  return {
    supabaseUrl: String(supabaseUrl).trim().replace(/\/+$/, ""),
    supabasePublishableKey: String(supabasePublishableKey).trim(),
  };
}

export function validateConnection(connection) {
  const normalized = normalizeConnection(connection);
  let parsedUrl;

  try {
    parsedUrl = new URL(normalized.supabaseUrl);
  } catch {
    throw new Error("URL-ul Supabase nu este valid.");
  }

  const localHost = ["localhost", "127.0.0.1"].includes(parsedUrl.hostname);
  if (parsedUrl.protocol !== "https:" && !(localHost && parsedUrl.protocol === "http:")) {
    throw new Error("URL-ul Supabase trebuie să înceapă cu https://.");
  }

  if (!normalized.supabasePublishableKey || normalized.supabasePublishableKey.length < 20) {
    throw new Error("Introdu cheia Supabase Publishable completă.");
  }

  const lowerKey = normalized.supabasePublishableKey.toLowerCase();
  if (lowerKey.startsWith("sb_secret_") || lowerKey.includes("service_role")) {
    throw new Error("Ai introdus o cheie secretă. Folosește numai cheia Publishable / anon.");
  }

  const jwtPayload = decodeJwtPayload(normalized.supabasePublishableKey);
  if (jwtPayload?.role === "service_role") {
    throw new Error("Cheia service_role nu este permisă în browser. Folosește cheia Publishable / anon.");
  }

  return normalized;
}

export function loadSavedConnection() {
  for (const storage of [sessionStorage, localStorage]) {
    try {
      const raw = storage.getItem(storage === localStorage ? LOCAL_STORAGE_KEY : SESSION_STORAGE_KEY);
      if (!raw) continue;
      return validateConnection(JSON.parse(raw));
    } catch {
      // O valoare veche sau coruptă este ignorată.
    }
  }
  return null;
}

export function hasRememberedConnection() {
  return Boolean(localStorage.getItem(LOCAL_STORAGE_KEY));
}

export function saveConnection(connection, remember = true) {
  const normalized = validateConnection(connection);
  localStorage.removeItem(LOCAL_STORAGE_KEY);
  sessionStorage.removeItem(SESSION_STORAGE_KEY);

  const target = remember ? localStorage : sessionStorage;
  const key = remember ? LOCAL_STORAGE_KEY : SESSION_STORAGE_KEY;
  target.setItem(key, JSON.stringify(normalized));
  return normalized;
}

export function clearSavedConnection() {
  localStorage.removeItem(LOCAL_STORAGE_KEY);
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

export function sameConnection(left, right) {
  if (!left || !right) return false;
  const a = normalizeConnection(left);
  const b = normalizeConnection(right);
  return a.supabaseUrl === b.supabaseUrl && a.supabasePublishableKey === b.supabasePublishableKey;
}

export function connectionHostname(connection) {
  try {
    return new URL(connection?.supabaseUrl).hostname;
  } catch {
    return "Supabase";
  }
}
