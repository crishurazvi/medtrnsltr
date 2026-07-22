import { corsHeaders } from "npm:@supabase/supabase-js@^2/cors";

const ALLOWED_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function getErrorMessage(payload: any, fallback: string) {
  if (typeof payload?.error?.message === "string") return payload.error.message;
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.message === "string") return payload.message;
  return fallback;
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") return value.trim();

  // Tolerăm și răspunsuri de tip content-parts, chiar dacă schema curentă
  // DeepSeek documentează content ca string.
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .join("")
      .trim();
  }

  return "";
}

function extractTranslation(payload: any): string {
  return (
    normalizeText(payload?.choices?.[0]?.message?.content) ||
    normalizeText(payload?.choices?.[0]?.text) ||
    normalizeText(payload?.output_text) ||
    normalizeText(payload?.translation)
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return json({ ok: true, function: "deepseek-proxy", version: 4 });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Metodă nepermisă.", status: 405 }, 405);
  }

  try {
    const body = await req.json().catch(() => null);

    const deepseekApiKey =
      typeof body?.deepseek_api_key === "string"
        ? body.deepseek_api_key.trim()
        : "";

    const model =
      typeof body?.model === "string"
        ? body.model.trim()
        : "deepseek-v4-flash";

    const systemPrompt =
      typeof body?.system_prompt === "string"
        ? body.system_prompt.trim()
        : "";

    const userPrompt =
      typeof body?.user_prompt === "string"
        ? body.user_prompt.trim()
        : "";

    if (!deepseekApiKey || deepseekApiKey.length < 20 || /\s/.test(deepseekApiKey)) {
      return json({ ok: false, error: "Cheia API DeepSeek lipsește sau pare invalidă.", status: 401 }, 401);
    }

    if (!ALLOWED_MODELS.has(model)) {
      return json({ ok: false, error: `Model DeepSeek neacceptat: ${model}.`, status: 400 }, 400);
    }

    if (!systemPrompt || !userPrompt) {
      return json({ ok: false, error: "Promptul sau textul sursă lipsește.", status: 400 }, 400);
    }

    if (systemPrompt.length > 20_000 || userPrompt.length > 50_000) {
      return json({ ok: false, error: "Segmentul este prea mare.", status: 413 }, 413);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 110_000);

    let response: Response;
    try {
      response = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${deepseekApiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          thinking: { type: "disabled" },
          response_format: { type: "text" },
          tool_choice: "none",
          temperature: 0.1,
          max_tokens: 8192,
          stream: false,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const rawResponse = await response.text();
    let payload: any = null;

    try {
      payload = rawResponse ? JSON.parse(rawResponse) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message = getErrorMessage(
        payload,
        rawResponse.slice(0, 350) || `DeepSeek a răspuns cu eroarea ${response.status}.`,
      );

      console.error("DeepSeek HTTP error", {
        status: response.status,
        message,
        traceId: response.headers.get("x-ds-trace-id"),
      });

      return json(
        {
          ok: false,
          error: message,
          status: response.status,
          trace_id: response.headers.get("x-ds-trace-id") || null,
        },
        response.status,
      );
    }

    const choice = payload?.choices?.[0];
    const translation = extractTranslation(payload);
    const finishReason = choice?.finish_reason ?? null;

    if (!translation) {
      const retryable = finishReason === "insufficient_system_resource";
      const status = retryable ? 503 : 502;
      const diagnostic = {
        finish_reason: finishReason,
        payload_keys: payload && typeof payload === "object" ? Object.keys(payload) : [],
        choice_keys: choice && typeof choice === "object" ? Object.keys(choice) : [],
        message_keys:
          choice?.message && typeof choice.message === "object"
            ? Object.keys(choice.message)
            : [],
        has_reasoning_content: Boolean(normalizeText(choice?.message?.reasoning_content)),
        raw_preview: rawResponse.slice(0, 500),
      };

      console.error("DeepSeek empty/unknown response", diagnostic);

      return json(
        {
          ok: false,
          error: `DeepSeek nu a returnat textul traducerii${finishReason ? ` (finish_reason: ${finishReason})` : ""}.`,
          status,
          diagnostic,
          trace_id: response.headers.get("x-ds-trace-id") || null,
        },
        status,
      );
    }

    return json({
      ok: true,
      translation,
      model: payload?.model || model,
      finish_reason: finishReason,
      usage: payload?.usage || null,
      trace_id: response.headers.get("x-ds-trace-id") || null,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return json(
        { ok: false, error: "DeepSeek nu a răspuns la timp. Reîncearcă segmentul.", status: 504 },
        504,
      );
    }

    const message = error instanceof Error ? error.message : "Eroare internă.";
    console.error("deepseek-proxy error", message);
    return json({ ok: false, error: message, status: 500 }, 500);
  }
});
