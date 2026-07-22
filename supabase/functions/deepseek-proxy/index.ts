import { createClient } from "npm:@supabase/supabase-js@^2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-deepseek-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const allowedModels = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function safeErrorMessage(payload, fallback) {
  if (payload && typeof payload === "object") {
    if (typeof payload.error === "string") return payload.error.slice(0, 500);
    if (payload.error && typeof payload.error === "object" && typeof payload.error.message === "string") {
      return payload.error.message.slice(0, 500);
    }
    if (typeof payload.message === "string") return payload.message.slice(0, 500);
  }
  return fallback;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Metodă nepermisă.", status: 405 }, 405);
  }

  try {
    const authorization = req.headers.get("Authorization") || "";
    const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!accessToken) {
      return json({ error: "Sesiunea Supabase lipsește.", status: 401 }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      return json({ error: "Funcția Supabase nu este configurată corect.", status: 500 }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) {
      return json({ error: "Sesiunea Supabase nu este validă sau a expirat.", status: 401 }, 401);
    }

    const deepseekApiKey = (req.headers.get("x-deepseek-api-key") || "").trim();
    if (!deepseekApiKey || deepseekApiKey.length < 20 || /\s/.test(deepseekApiKey)) {
      return json({ error: "Cheia API DeepSeek lipsește sau pare invalidă.", status: 401 }, 401);
    }

    const body = await req.json().catch(() => null);
    const model = typeof body?.model === "string" ? body.model : "deepseek-v4-flash";
    const systemPrompt = typeof body?.system_prompt === "string" ? body.system_prompt.trim() : "";
    const userPrompt = typeof body?.user_prompt === "string" ? body.user_prompt.trim() : "";

    if (!allowedModels.has(model)) {
      return json({ error: "Model DeepSeek neacceptat.", status: 400 }, 400);
    }
    if (!systemPrompt || !userPrompt) {
      return json({ error: "Promptul sau textul sursă lipsește.", status: 400 }, 400);
    }
    if (systemPrompt.length > 20_000 || userPrompt.length > 30_000) {
      return json({ error: "Segmentul este prea mare pentru configurația aplicației.", status: 413 }, 413);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 110_000);

    let deepseekResponse;
    try {
      deepseekResponse = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${deepseekApiKey}`,
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

    const deepseekPayload = await deepseekResponse.json().catch(() => null);
    if (!deepseekResponse.ok) {
      const message = safeErrorMessage(deepseekPayload, `DeepSeek a răspuns cu eroarea ${deepseekResponse.status}.`);
      return json({ error: message, status: deepseekResponse.status }, deepseekResponse.status);
    }

    const translation = deepseekPayload?.choices?.[0]?.message?.content;
    if (typeof translation !== "string" || !translation.trim()) {
      return json({ error: "DeepSeek nu a returnat textul traducerii.", status: 502 }, 502);
    }

    return json({
      translation: translation.trim(),
      model: deepseekPayload?.model || model,
      usage: deepseekPayload?.usage || null,
      trace_id: deepseekResponse.headers.get("x-ds-trace-id") || null,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return json({ error: "DeepSeek nu a răspuns în timpul permis. Reîncearcă segmentul.", status: 504 }, 504);
    }
    return json({
      error: error instanceof Error ? error.message.slice(0, 500) : "Eroare internă în funcția DeepSeek.",
      status: 500,
    }, 500);
  }
});
