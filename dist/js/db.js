import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { chunkArray } from "./utils.js";

let client;

export function initSupabase(config) {
  client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}

export function getSupabase() {
  if (!client) throw new Error("Supabase nu a fost inițializat.");
  return client;
}

export async function invokeDeepSeekTranslation({ apiKey, model, systemPrompt, userPrompt }) {
  const { data, error } = await getSupabase().functions.invoke("deepseek-proxy", {
    headers: {
      "x-deepseek-api-key": apiKey,
    },
    body: {
      model,
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
    },
  });

  if (error) {
    let message = error.message || "Apelul către funcția DeepSeek a eșuat.";
    let status = error.context?.status || 0;

    try {
      const payload = await error.context?.clone?.().json?.();
      if (payload?.error) message = payload.error;
      if (payload?.status) status = payload.status;
    } catch {
      // Păstrăm mesajul standard oferit de supabase-js.
    }

    const wrapped = new Error(message);
    wrapped.status = Number(status) || 0;
    throw wrapped;
  }

  if (!data?.translation || typeof data.translation !== "string") {
    throw new Error("DeepSeek nu a returnat o traducere validă.");
  }

  return data;
}

export async function getSession() {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChange(callback) {
  return getSupabase().auth.onAuthStateChange((event, session) => callback(event, session));
}

export async function signIn(email, password) {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password) {
  const { data, error } = await getSupabase().auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}

export async function resetPassword(email, redirectTo) {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function updatePassword(password) {
  const { error } = await getSupabase().auth.updateUser({ password });
  if (error) throw error;
}

export async function listProjects() {
  const { data, error } = await getSupabase()
    .from("projects")
    .select(`
      id, title, source_filename, source_pdf_path, page_count, chunk_size,
      status, created_at, updated_at,
      chunks ( id, status, translated_text )
    `)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((project) => {
    const chunks = project.chunks ?? [];
    return {
      ...project,
      chunks,
      chunkCount: chunks.length,
      translatedCount: chunks.filter((chunk) => Boolean(chunk.translated_text?.trim())).length,
      approvedCount: chunks.filter((chunk) => chunk.status === "approved").length,
    };
  });
}

export async function getProject(projectId) {
  const { data, error } = await getSupabase()
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (error) throw error;
  return data;
}

export async function getProjectChunks(projectId) {
  const { data, error } = await getSupabase()
    .from("chunks")
    .select("*")
    .eq("project_id", projectId)
    .order("position", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createProject({ userId, title, file, pageCount, chunkSize, systemPrompt, chunks, uploadPdf }) {
  const { data: project, error: projectError } = await getSupabase()
    .from("projects")
    .insert({
      user_id: userId,
      title,
      source_filename: file.name,
      page_count: pageCount,
      chunk_size: chunkSize,
      system_prompt: systemPrompt,
      status: "pending",
    })
    .select("*")
    .single();

  if (projectError) throw projectError;

  try {
    const rows = chunks.map((chunk, index) => ({
      project_id: project.id,
      user_id: userId,
      position: index,
      page_start: chunk.pageStart,
      page_end: chunk.pageEnd,
      source_text: chunk.text,
      translated_text: "",
      status: "pending",
    }));

    for (const batch of chunkArray(rows, 100)) {
      const { error } = await getSupabase().from("chunks").insert(batch);
      if (error) throw error;
    }

    if (uploadPdf) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const path = `${userId}/${project.id}/${Date.now()}_${safeName}`;
      const { error: uploadError } = await getSupabase()
        .storage
        .from("source-pdfs")
        .upload(path, file, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw uploadError;

      const { error: updateError } = await getSupabase()
        .from("projects")
        .update({ source_pdf_path: path })
        .eq("id", project.id);
      if (updateError) throw updateError;
      project.source_pdf_path = path;
    }

    return project;
  } catch (error) {
    await getSupabase().from("projects").delete().eq("id", project.id);
    throw error;
  }
}

export async function updateChunk(chunkId, patch) {
  const { data, error } = await getSupabase()
    .from("chunks")
    .update(patch)
    .eq("id", chunkId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateProject(projectId, patch) {
  const { data, error } = await getSupabase()
    .from("projects")
    .update(patch)
    .eq("id", projectId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProject(project) {
  if (project.source_pdf_path) {
    await getSupabase().storage.from("source-pdfs").remove([project.source_pdf_path]);
  }
  const { error } = await getSupabase().from("projects").delete().eq("id", project.id);
  if (error) throw error;
}

export async function getOriginalPdfUrl(path) {
  if (!path) return null;
  const { data, error } = await getSupabase().storage.from("source-pdfs").createSignedUrl(path, 120);
  if (error) throw error;
  return data.signedUrl;
}

export async function listGlossary() {
  const { data, error } = await getSupabase()
    .from("glossary")
    .select("*")
    .order("source_term", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addGlossaryEntry({ userId, sourceTerm, preferredTranslation, note }) {
  const { data, error } = await getSupabase()
    .from("glossary")
    .insert({
      user_id: userId,
      source_term: sourceTerm,
      preferred_translation: preferredTranslation,
      note: note || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteGlossaryEntry(id) {
  const { error } = await getSupabase().from("glossary").delete().eq("id", id);
  if (error) throw error;
}

export async function importBackup({ userId, backup }) {
  if (!backup?.project || !Array.isArray(backup?.chunks)) {
    throw new Error("Fișierul JSON nu are structura unui backup MedTranslate Studio.");
  }

  const projectPayload = {
    user_id: userId,
    title: `${backup.project.title || "Proiect importat"} (importat)`,
    source_filename: backup.project.source_filename || "backup.json",
    page_count: backup.project.page_count || null,
    chunk_size: backup.project.chunk_size || 2500,
    system_prompt: backup.project.system_prompt || "",
    status: backup.project.status === "completed" ? "completed" : "pending",
  };

  const { data: project, error } = await getSupabase()
    .from("projects")
    .insert(projectPayload)
    .select("*")
    .single();
  if (error) throw error;

  try {
    const rows = backup.chunks.map((chunk, index) => ({
      project_id: project.id,
      user_id: userId,
      position: Number.isInteger(chunk.position) ? chunk.position : index,
      page_start: chunk.page_start || null,
      page_end: chunk.page_end || null,
      source_text: chunk.source_text || "",
      translated_text: chunk.translated_text || "",
      status: ["pending", "draft", "approved"].includes(chunk.status) ? chunk.status : "pending",
      notes: chunk.notes || null,
    }));

    for (const batch of chunkArray(rows, 100)) {
      const { error: chunkError } = await getSupabase().from("chunks").insert(batch);
      if (chunkError) throw chunkError;
    }
    return project;
  } catch (importError) {
    await getSupabase().from("projects").delete().eq("id", project.id);
    throw importError;
  }
}
