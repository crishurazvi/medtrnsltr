import { corsHeaders } from "npm:@supabase/supabase-js@^2/cors";

const allowedModels = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);

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

function errorMessage(payload: any, fallback: string) {
  return (
    payload?.error?.message ||
    payload?.error ||
    payload?.message ||
    fallback
  );
}

Deno.serve(async (req) => {
  // Obligatoriu pentru cererile din browser.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return json({ ok: true, function: "deepseek-proxy", version: 3 });
  }

  if (req.method !== "POST") {
    return json({ error: "Metodă nepermisă.", status: 405 }, 405);
  }

  try {
    const body = await req.json().catch(() => null);

    const deepseekApiKey =
      typeof body?.deepseek_api_key === "string"
        ? body.deepseek_api_key.trim()
        : "";

    const model =
      typeof body?.model === "string"
        ? body.model
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
      return json({ error: "Cheia API DeepSeek lipsește sau pare invalidă.", status: 401 }, 401);
    }

    if (!allowedModels.has(model)) {
      return json({ error: "Model DeepSeek neacceptat.", status: 400 }, 400);
    }

    if (!systemPrompt || !userPrompt) {
      return json({ error: "Promptul sau textul sursă lipsește.", status: 400 }, 400);
    }

    if (systemPrompt.length > 20_000 || userPrompt.length > 30_000) {
      return json({ error: "Segmentul este prea mare.", status: 413 }, 413);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 110_000);

    let response: Response;
    try {
      response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${deepseekApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          thinking: { type: "disabled" },
          temperature: 0.1,
          max_tokens: 8192,
          stream: false,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return json(
        {
          error: errorMessage(
            payload,
            `DeepSeek a răspuns cu eroarea ${response.status}.`,
          ),
          status: response.status,
        },
        response.status,
      );
    }

    const translation = payload?.choices?.[0]?.message?.content;

    if (typeof translation !== "string" || !translation.trim()) {
      return json(
        { error: "DeepSeek nu a returnat textul traducerii.", status: 502 },
        502,
      );
    }

    return json({
      translation: translation.trim(),
      model: payload?.model || model,
      usage: payload?.usage || null,
      trace_id: response.headers.get("x-ds-trace-id") || null,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return json(
        { error: "DeepSeek nu a răspuns la timp. Reîncearcă segmentul.", status: 504 },
        504,
      );
    }

    return json(
      {
        error: error instanceof Error ? error.message : "Eroare internă.",
        status: 500,
      },
      500,
    );
  }
});
