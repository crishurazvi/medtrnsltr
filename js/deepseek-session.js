const STORAGE_KEY = "medtranslate.deepseek.session.v1";
const ALLOWED_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);

let memoryConfig = null;

export function validateDeepSeekConfig({ apiKey, model }) {
  const normalizedKey = String(apiKey || "").trim();
  const normalizedModel = ALLOWED_MODELS.has(model) ? model : "deepseek-v4-flash";

  if (!normalizedKey) {
    throw new Error("Introdu cheia API DeepSeek.");
  }
  if (normalizedKey.length < 20 || /\s/.test(normalizedKey)) {
    throw new Error("Cheia DeepSeek pare invalidă. Verifică să fie cheia completă, fără spații.");
  }

  return {
    apiKey: normalizedKey,
    model: normalizedModel,
  };
}

export function saveDeepSeekSession(config) {
  const validated = validateDeepSeekConfig(config);
  memoryConfig = validated;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
  return validated;
}

export function loadDeepSeekSession() {
  if (memoryConfig) return memoryConfig;

  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    memoryConfig = validateDeepSeekConfig(parsed);
    return memoryConfig;
  } catch {
    clearDeepSeekSession();
    return null;
  }
}

export function clearDeepSeekSession() {
  memoryConfig = null;
  sessionStorage.removeItem(STORAGE_KEY);
}

export function deepSeekModelLabel(model) {
  return model === "deepseek-v4-pro" ? "DeepSeek V4 Pro" : "DeepSeek V4 Flash";
}
