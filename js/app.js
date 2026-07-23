import {
  addGlossaryEntry,
  createProject,
  deleteGlossaryEntry,
  deleteProject,
  getOriginalPdfUrl,
  getProject,
  getProjectChunks,
  getProjectKnowledge,
  getSession,
  importBackup,
  initSupabase,
  invokeDeepSeekTranslation,
  listGlossary,
  listProjects,
  onAuthChange,
  replaceProjectKnowledge,
  resetPassword,
  saveConceptEditor,
  saveConceptNotes,
  signIn,
  signOut,
  signUp,
  updateChunk,
  updatePassword,
  updateProject,
} from "./db.js";
import {
  clearSavedConnection,
  connectionHostname,
  hasRememberedConnection,
  loadSavedConnection,
  sameConnection,
  saveConnection,
  validateConnection,
} from "./connection.js";
import {
  clearDeepSeekSession,
  deepSeekModelLabel,
  loadDeepSeekSession,
  saveDeepSeekSession,
  validateDeepSeekConfig,
} from "./deepseek-session.js";
import { DEFAULT_SYSTEM_PROMPT, CHUNK_STATUS } from "./constants.js";
import { buildChunks, extractPdf } from "./pdf-tools.js";
import {
  exportBackup,
  exportHtml,
  exportMarkdown,
  openPrintView,
} from "./export-tools.js";
import {
  debounce,
  escapeHtml,
  formatDate,
  formatDateShort,
  pagesLabel,
  percentage,
  setButtonLoading,
} from "./utils.js";

const APP_CONFIG = {
  appName: "MedTranslate Studio",
  defaultChunkSize: 2500,
  uploadOriginalPdfByDefault: false,
};
const app = document.querySelector("#app");

const state = {
  session: null,
  connection: loadSavedConnection(),
  projects: [],
  glossary: [],
  currentProject: null,
  chunks: [],
  currentIndex: 0,
  chunkSearch: "",
  projectView: "translation",
  chapters: [],
  concepts: [],
  knowledgeSearch: "",
  selectedConceptId: null,
  collapsedChapters: new Set(),
  knowledgeSetupError: null,
  knowledge: {
    running: false,
    stopRequested: false,
    completed: 0,
    total: 0,
    failed: [],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  },
  authMode: "signin",
  loading: false,
  deepseek: loadDeepSeekSession(),
  ai: {
    running: false,
    stopRequested: false,
    completed: 0,
    total: 0,
    currentPosition: null,
    failed: [],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  },
};

let saveDebounced;
let conceptSaveDebounced;
let conceptNotesSaveDebounced;
let conceptEditorSelection = null;
let conceptNotesSelection = null;
let authSubscription;

function ensureToastRegion() {
  if (document.querySelector("#toast-region")) return;
  document.body.insertAdjacentHTML("beforeend", '<div id="toast-region" class="toast-region" aria-live="polite"></div>');
}

function toast(message, type = "default", duration = 3400) {
  ensureToastRegion();
  const region = document.querySelector("#toast-region");
  const element = document.createElement("div");
  element.className = `toast ${type === "default" ? "" : type}`.trim();
  element.textContent = message;
  region.appendChild(element);
  setTimeout(() => element.remove(), duration);
}

function showModal(content, size = "", { locked = false } = {}) {
  closeModal();
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div id="modal-root" class="modal-backdrop" data-locked="${locked ? "true" : "false"}">
      <section class="modal ${size}" role="dialog" aria-modal="true">${content}</section>
    </div>`,
  );
  document.querySelector("#modal-root")?.addEventListener("click", (event) => {
    if (event.target.id === "modal-root" && event.currentTarget.dataset.locked !== "true") closeModal();
  });
}

function closeModal() {
  document.querySelector("#modal-root")?.remove();
}

function topbar({ editor = false } = {}) {
  const email = state.session?.user?.email ?? "";
  const supabaseHost = connectionHostname(state.connection);
  const deepseekLabel = state.deepseek ? deepSeekModelLabel(state.deepseek.model) : "DeepSeek neconfigurat";
  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">M</div>
        <span>${escapeHtml(APP_CONFIG.appName)}</span>
      </div>
      <div class="top-actions">
        ${editor ? '<button id="back-dashboard" class="btn btn-ghost btn-sm">← Proiecte</button>' : ""}
        <button id="change-deepseek" class="btn btn-ghost btn-sm" title="Cheia este păstrată numai până închizi fila">✦ ${escapeHtml(deepseekLabel)}</button>
        <button id="change-supabase" class="btn btn-ghost btn-sm" title="Schimbă proiectul Supabase">◉ ${escapeHtml(supabaseHost)}</button>
        <span class="user-pill">${escapeHtml(email)}</span>
        <button id="logout" class="btn btn-ghost btn-sm">Deconectare</button>
      </div>
    </header>`;
}
function attachTopbarListeners() {
  document.querySelector("#logout")?.addEventListener("click", async () => {
    try {
      await flushActiveEdits();
      clearDeepSeekSession();
      state.deepseek = null;
      await signOut();
    } catch (error) {
      toast(error.message || "Nu am putut face deconectarea.", "error");
    }
  });

  document.querySelector("#change-deepseek")?.addEventListener("click", () => {
    showDeepSeekSettingsModal();
  });

  document.querySelector("#change-supabase")?.addEventListener("click", async () => {
    try {
      await flushActiveEdits();
      clearDeepSeekSession();
      state.deepseek = null;
      await signOut();
    } catch {
      state.session = null;
      renderAuth();
    }
  });

  document.querySelector("#back-dashboard")?.addEventListener("click", async () => {
    await flushActiveEdits();
    state.currentProject = null;
    state.chunks = [];
    state.chapters = [];
    state.concepts = [];
    state.projectView = "translation";
    state.selectedConceptId = null;
    state.knowledgeSetupError = null;
    window.location.hash = "";
    await loadDashboard();
  });
}
function renderAuth() {
  const isSignup = state.authMode === "signup";
  const connection = state.connection ?? loadSavedConnection() ?? {
    supabaseUrl: "",
    supabasePublishableKey: "",
  };
  const deepseek = state.deepseek ?? loadDeepSeekSession() ?? {
    apiKey: "",
    model: "deepseek-v4-flash",
  };
  const rememberConnection = hasRememberedConnection();

  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-visual">
        <div class="brand-mark">M</div>
        <h1>Traducere automată medicală, cu controlul datelor tale.</h1>
        <p>PDF-ul este extras și împărțit local. Segmentele sunt traduse automat prin DeepSeek, apoi salvate în proiectul tău Supabase.</p>
        <div class="auth-points">
          <span>✓ Cheia DeepSeek nu ajunge în GitHub, Render sau baza de date</span>
          <span>✓ Este păstrată numai în sessionStorage, până închizi fila</span>
          <span>✓ Traducere secvențială, reluare după erori și autosalvare</span>
        </div>
      </section>
      <section class="auth-panel">
        <form id="auth-form" class="auth-card auth-card-wide">
          <h2>${isSignup ? "Creează cont" : "Conectare și configurare"}</h2>
          <p>Introdu conexiunea Supabase, cheia DeepSeek și contul de utilizator.</p>
          <div id="auth-message"></div>
          <div class="form-grid">
            <fieldset class="connection-fieldset">
              <legend>1. Conexiune Supabase</legend>
              <div class="form-row">
                <label for="supabase-url">Supabase Project URL</label>
                <input id="supabase-url" class="input" type="url" inputmode="url" autocomplete="off" placeholder="https://abcxyz.supabase.co" value="${escapeHtml(connection.supabaseUrl)}" required />
              </div>
              <div class="form-row">
                <label for="supabase-key">Supabase Publishable Key</label>
                <div class="secret-input-row">
                  <input id="supabase-key" class="input" type="password" autocomplete="off" placeholder="sb_publishable_..." value="${escapeHtml(connection.supabasePublishableKey)}" required />
                  <button class="btn btn-ghost btn-sm toggle-secret" data-target="supabase-key" type="button">Arată</button>
                </div>
                <span class="help">Folosește numai cheia <strong>Publishable</strong> sau cheia veche <strong>anon</strong>. Nu introduce <code>sb_secret_…</code> sau <code>service_role</code>.</span>
              </div>
              <label class="checkbox-row">
                <input id="remember-connection" type="checkbox" ${rememberConnection ? "checked" : ""} />
                <span>Ține minte URL-ul și cheia Publishable Supabase în acest browser.</span>
              </label>
            </fieldset>

            <fieldset class="connection-fieldset">
              <legend>2. DeepSeek — numai pentru fila curentă</legend>
              <div class="form-row">
                <label for="deepseek-key">DeepSeek API Key</label>
                <div class="secret-input-row">
                  <input id="deepseek-key" class="input" type="password" autocomplete="off" spellcheck="false" placeholder="Cheia API DeepSeek" value="${escapeHtml(deepseek.apiKey)}" required />
                  <button class="btn btn-ghost btn-sm toggle-secret" data-target="deepseek-key" type="button">Arată</button>
                </div>
                <span class="help">Cheia este păstrată în <code>sessionStorage</code>: supraviețuiește unui refresh, dar este ștearsă când închizi fila sau te deconectezi. Nu este scrisă în Supabase.</span>
              </div>
              <div class="form-row">
                <label for="deepseek-model">Model</label>
                <select id="deepseek-model" class="select">
                  <option value="deepseek-v4-flash" ${deepseek.model === "deepseek-v4-flash" ? "selected" : ""}>DeepSeek V4 Flash — recomandat</option>
                  <option value="deepseek-v4-pro" ${deepseek.model === "deepseek-v4-pro" ? "selected" : ""}>DeepSeek V4 Pro — mai scump</option>
                </select>
              </div>
              <div class="warning-box">Cheia există temporar în browser și este transmisă criptat funcției Supabase pentru fiecare segment. Nu folosi aplicația pe un calculator public sau cu extensii de browser în care nu ai încredere.</div>
            </fieldset>

            <fieldset class="connection-fieldset">
              <legend>3. Cont utilizator</legend>
              <div class="form-row">
                <label for="auth-email">Email</label>
                <input id="auth-email" class="input" type="email" autocomplete="email" required />
              </div>
              <div class="form-row">
                <label for="auth-password">Parolă</label>
                <input id="auth-password" class="input" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" minlength="6" required />
              </div>
            </fieldset>

            <button id="auth-submit" class="btn btn-primary" type="submit">${isSignup ? "Conectează și creează contul" : "Conectează și intră"}</button>
          </div>
          <div class="auth-secondary-actions">
            <button id="toggle-auth" class="btn btn-ghost btn-sm" type="button">${isSignup ? "Am deja cont" : "Creează cont"}</button>
            ${!isSignup ? '<button id="forgot-password" class="btn btn-ghost btn-sm" type="button">Am uitat parola</button>' : ""}
            <button id="forget-connection" class="btn btn-ghost btn-sm" type="button">Șterge datele Supabase salvate</button>
          </div>
        </form>
      </section>
    </main>`;

  document.querySelectorAll(".toggle-secret").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.querySelector(`#${button.dataset.target}`);
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      button.textContent = visible ? "Arată" : "Ascunde";
    });
  });

  document.querySelector("#toggle-auth")?.addEventListener("click", () => {
    state.authMode = isSignup ? "signin" : "signup";
    renderAuth();
  });

  document.querySelector("#forgot-password")?.addEventListener("click", showResetPasswordModal);
  document.querySelector("#forget-connection")?.addEventListener("click", () => {
    clearSavedConnection();
    state.connection = null;
    renderAuth();
    toast("Datele conexiunii Supabase au fost șterse din browser.", "success");
  });

  document.querySelector("#auth-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = document.querySelector("#auth-submit");
    const email = document.querySelector("#auth-email").value.trim();
    const password = document.querySelector("#auth-password").value;
    const message = document.querySelector("#auth-message");
    message.innerHTML = "";
    setButtonLoading(submit, true, isSignup ? "Se creează…" : "Se autentifică…");

    try {
      const nextConnection = validateConnection({
        supabaseUrl: document.querySelector("#supabase-url").value,
        supabasePublishableKey: document.querySelector("#supabase-key").value,
      });
      const deepseekConfig = validateDeepSeekConfig({
        apiKey: document.querySelector("#deepseek-key").value,
        model: document.querySelector("#deepseek-model").value,
      });
      const remember = document.querySelector("#remember-connection").checked;

      if (!sameConnection(state.connection, nextConnection) || !authSubscription) {
        await initializeSupabaseConnection(nextConnection);
      }

      state.connection = saveConnection(nextConnection, remember);
      state.deepseek = saveDeepSeekSession(deepseekConfig);

      if (isSignup) {
        const result = await signUp(email, password);
        if (!result.session) {
          message.innerHTML = '<div class="success-box">Cont creat. Verifică emailul pentru confirmare, apoi autentifică-te.</div>';
        }
      } else {
        const result = await signIn(email, password);
        if (result.session) await handleAuthenticatedSession(result.session);
      }
    } catch (error) {
      message.innerHTML = `<div class="error-box">${escapeHtml(error.message || "Autentificarea a eșuat.")}</div>`;
    } finally {
      setButtonLoading(submit, false);
    }
  });
}

function showDeepSeekSettingsModal({ required = false } = {}) {
  const current = state.deepseek ?? loadDeepSeekSession() ?? {
    apiKey: "",
    model: "deepseek-v4-flash",
  };

  showModal(`
    <div class="modal-head">
      <h3>${required ? "Conectează DeepSeek" : "Configurare DeepSeek"}</h3>
      ${required ? "" : '<button id="close-modal" class="btn btn-icon btn-ghost">×</button>'}
    </div>
    <form id="deepseek-settings-form">
      <div class="modal-body form-grid">
        <div id="deepseek-settings-message"></div>
        <div class="form-row">
          <label for="settings-deepseek-key">DeepSeek API Key</label>
          <div class="secret-input-row">
            <input id="settings-deepseek-key" class="input" type="password" autocomplete="off" spellcheck="false" value="${escapeHtml(current.apiKey)}" required />
            <button id="toggle-deepseek-settings-key" class="btn btn-ghost btn-sm" type="button">Arată</button>
          </div>
          <span class="help">Cheia este păstrată numai în sessionStorage, până închizi fila. Nu este salvată în baza de date.</span>
        </div>
        <div class="form-row">
          <label for="settings-deepseek-model">Model</label>
          <select id="settings-deepseek-model" class="select">
            <option value="deepseek-v4-flash" ${current.model === "deepseek-v4-flash" ? "selected" : ""}>DeepSeek V4 Flash — recomandat</option>
            <option value="deepseek-v4-pro" ${current.model === "deepseek-v4-pro" ? "selected" : ""}>DeepSeek V4 Pro</option>
          </select>
        </div>
        <div class="warning-box">În timpul traducerii, cheia este transmisă prin HTTPS către funcția Edge din proiectul tău Supabase, care o redirecționează către DeepSeek fără să o scrie în baza de date.</div>
      </div>
      <div class="modal-footer">
        ${required ? "" : '<button id="remove-deepseek-key" class="btn btn-danger" type="button" style="margin-right:auto">Șterge cheia temporară</button>'}
        ${required ? "" : '<button id="cancel-deepseek-settings" class="btn btn-ghost" type="button">Renunță</button>'}
        <button id="save-deepseek-settings" class="btn btn-primary" type="submit">Salvează pentru fila curentă</button>
      </div>
    </form>`, "modal-sm");

  document.querySelector("#close-modal")?.addEventListener("click", closeModal);
  document.querySelector("#cancel-deepseek-settings")?.addEventListener("click", closeModal);
  document.querySelector("#toggle-deepseek-settings-key")?.addEventListener("click", () => {
    const input = document.querySelector("#settings-deepseek-key");
    const button = document.querySelector("#toggle-deepseek-settings-key");
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    button.textContent = visible ? "Arată" : "Ascunde";
  });

  document.querySelector("#remove-deepseek-key")?.addEventListener("click", () => {
    if (state.ai.running) {
      toast("Oprește mai întâi traducerea automată.", "error");
      return;
    }
    clearDeepSeekSession();
    state.deepseek = null;
    closeModal();
    toast("Cheia DeepSeek a fost ștearsă din fila curentă.", "success");
    if (state.session) showDeepSeekSettingsModal({ required: true });
  });

  document.querySelector("#deepseek-settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.querySelector("#deepseek-settings-message");
    try {
      state.deepseek = saveDeepSeekSession({
        apiKey: document.querySelector("#settings-deepseek-key").value,
        model: document.querySelector("#settings-deepseek-model").value,
      });
      closeModal();
      toast(`${deepSeekModelLabel(state.deepseek.model)} este configurat pentru fila curentă.`, "success");
      if (state.currentProject) renderEditor();
      else if (state.session) await loadDashboard();
    } catch (error) {
      message.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
    }
  });
}

function renderDeepSeekGate(session) {
  state.session = session;
  app.innerHTML = `
    <main class="setup-page">
      <section class="setup-card">
        <div class="brand-mark">M</div>
        <h1>Mai lipsește cheia DeepSeek</h1>
        <p class="setup-steps">Sesiunea Supabase este activă, dar această filă nu are o cheie DeepSeek temporară. Cheia nu va fi salvată în GitHub, Render sau Supabase.</p>
        <button id="open-deepseek-gate" class="btn btn-primary">Introdu cheia DeepSeek</button>
        <button id="gate-logout" class="btn btn-ghost" style="margin-left:8px">Deconectare</button>
      </section>
    </main>`;
  document.querySelector("#open-deepseek-gate")?.addEventListener("click", () => showDeepSeekSettingsModal({ required: true }));
  document.querySelector("#gate-logout")?.addEventListener("click", async () => {
    clearDeepSeekSession();
    state.deepseek = null;
    await signOut();
  });
  showDeepSeekSettingsModal({ required: true });
}

function showResetPasswordModal() {
  showModal(`
    <div class="modal-head">
      <h3>Resetare parolă</h3>
      <button id="close-modal" class="btn btn-icon btn-ghost">×</button>
    </div>
    <form id="reset-form">
      <div class="modal-body form-grid">
        <div id="reset-message"></div>
        <div class="form-row">
          <label for="reset-email">Adresa de email</label>
          <input id="reset-email" class="input" type="email" required />
          <span class="help">Supabase va trimite un link de resetare. Domeniul onrender.com trebuie adăugat în Redirect URLs.</span>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" type="button" id="cancel-reset">Renunță</button>
        <button class="btn btn-primary" type="submit" id="send-reset">Trimite linkul</button>
      </div>
    </form>`, "modal-sm");

  document.querySelector("#close-modal")?.addEventListener("click", closeModal);
  document.querySelector("#cancel-reset")?.addEventListener("click", closeModal);
  document.querySelector("#reset-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector("#send-reset");
    const message = document.querySelector("#reset-message");
    setButtonLoading(button, true, "Se trimite…");
    try {
      await resetPassword(document.querySelector("#reset-email").value.trim(), `${window.location.origin}${window.location.pathname}`);
      message.innerHTML = '<div class="success-box">Emailul de resetare a fost solicitat. Verifică inboxul și spamul.</div>';
    } catch (error) {
      message.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
    } finally {
      setButtonLoading(button, false);
    }
  });
}

function showUpdatePasswordModal() {
  showModal(`
    <div class="modal-head"><h3>Alege o parolă nouă</h3></div>
    <form id="update-password-form">
      <div class="modal-body form-grid">
        <div id="password-message"></div>
        <div class="form-row">
          <label for="new-password">Parolă nouă</label>
          <input id="new-password" class="input" type="password" minlength="8" required />
        </div>
      </div>
      <div class="modal-footer"><button id="save-password" class="btn btn-primary" type="submit">Salvează parola</button></div>
    </form>`, "modal-sm");

  document.querySelector("#update-password-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector("#save-password");
    const message = document.querySelector("#password-message");
    setButtonLoading(button, true, "Se salvează…");
    try {
      await updatePassword(document.querySelector("#new-password").value);
      closeModal();
      toast("Parola a fost actualizată.", "success");
    } catch (error) {
      message.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
    } finally {
      setButtonLoading(button, false);
    }
  });
}

async function loadDashboard() {
  app.innerHTML = `${topbar()}<main class="container"><div class="empty-state"><span class="loader loader-dark"></span> Se încarcă proiectele…</div></main>`;
  attachTopbarListeners();

  try {
    [state.projects, state.glossary] = await Promise.all([listProjects(), listGlossary()]);
    renderDashboard();
  } catch (error) {
    app.innerHTML = `${topbar()}<main class="container"><div class="error-box">${escapeHtml(error.message)}</div></main>`;
    attachTopbarListeners();
  }
}

function renderDashboard() {
  const totalChunks = state.projects.reduce((sum, project) => sum + project.chunkCount, 0);
  const translatedChunks = state.projects.reduce((sum, project) => sum + project.translatedCount, 0);
  const approvedChunks = state.projects.reduce((sum, project) => sum + project.approvedCount, 0);

  const projectCards = state.projects.length
    ? state.projects.map((project) => {
      const progress = percentage(project.translatedCount, project.chunkCount);
      return `
        <article class="project-card">
          <h3 class="project-title">${escapeHtml(project.title)}</h3>
          <div class="project-meta">
            <span>${escapeHtml(project.source_filename || "PDF")}</span>
            <span>•</span>
            <span>${project.page_count || "?"} pagini</span>
            <span>•</span>
            <span>${project.chunkCount} segmente</span>
          </div>
          <div class="progress-track"><div class="progress-bar" style="width:${progress}%"></div></div>
          <div class="project-footer">
            <small>${project.translatedCount}/${project.chunkCount} traduse · ${project.approvedCount} aprobate</small>
            <div style="display:flex;gap:7px">
              <button class="btn btn-primary btn-sm open-project" data-id="${project.id}">Deschide</button>
              <button class="btn btn-danger btn-sm delete-project" data-id="${project.id}" title="Șterge proiectul">Șterge</button>
            </div>
          </div>
          <div class="help" style="margin-top:9px">Actualizat ${escapeHtml(formatDateShort(project.updated_at))}</div>
        </article>`;
    }).join("")
    : `<div class="empty-state" style="grid-column:1/-1">
        <h3>Nu ai încă proiecte</h3>
        <p>Încarcă primul PDF, extrage textul local și lasă DeepSeek să traducă automat toate segmentele.</p>
        <button id="empty-create" class="btn btn-primary">Creează primul proiect</button>
      </div>`;

  app.innerHTML = `
    <div class="app-shell">
      ${topbar()}
      <main class="container">
        <section class="hero">
          <div class="hero-main">
            <h1>Traduceri medicale automate, cu progres salvat.</h1>
            <p>PDF-ul este împărțit local în segmente, DeepSeek le traduce secvențial, iar fiecare rezultat este salvat imediat în Supabase.</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px">
              <button id="create-project" class="btn btn-primary">＋ Proiect nou</button>
              <button id="import-backup" class="btn btn-ghost">Importă backup JSON</button>
              <button id="manage-glossary" class="btn btn-ghost">Glosar (${state.glossary.length})</button>
            </div>
          </div>
          <div class="hero-card">
            <div class="metric"><span>Proiecte</span><strong>${state.projects.length}</strong></div>
            <div class="metric"><span>Segmente traduse</span><strong>${translatedChunks}/${totalChunks}</strong></div>
            <div class="metric"><span>Segmente aprobate</span><strong>${approvedChunks}</strong></div>
          </div>
        </section>

        <div class="section-head">
          <div><h2>Proiectele tale</h2><p>Fiecare proiect este vizibil numai contului care l-a creat.</p></div>
        </div>
        <section class="projects-grid">${projectCards}</section>
      </main>
    </div>`;

  attachTopbarListeners();
  document.querySelector("#create-project")?.addEventListener("click", showCreateProjectModal);
  document.querySelector("#empty-create")?.addEventListener("click", showCreateProjectModal);
  document.querySelector("#manage-glossary")?.addEventListener("click", showGlossaryModal);
  document.querySelector("#import-backup")?.addEventListener("click", triggerBackupImport);

  document.querySelectorAll(".open-project").forEach((button) => {
    button.addEventListener("click", () => openProject(button.dataset.id));
  });

  document.querySelectorAll(".delete-project").forEach((button) => {
    button.addEventListener("click", () => confirmDeleteProject(button.dataset.id));
  });
}

function showCreateProjectModal() {
  const defaultChunkSize = Number(APP_CONFIG.defaultChunkSize || 2500);
  showModal(`
    <div class="modal-head">
      <h3>Proiect nou</h3>
      <button id="close-modal" class="btn btn-icon btn-ghost">×</button>
    </div>
    <form id="create-project-form">
      <div class="modal-body form-grid">
        <div id="create-status"></div>
        <div class="form-row">
          <label for="project-file">Fișier PDF</label>
          <input id="project-file" class="input" type="file" accept="application/pdf,.pdf" required />
          <span class="help">Extragerea se face local în browser. PDF-urile scanate necesită OCR, care nu este inclus în această versiune.</span>
        </div>
        <div class="form-row">
          <label for="project-title">Titlul proiectului</label>
          <input id="project-title" class="input" type="text" placeholder="Se completează automat din numele fișierului" />
        </div>
        <div class="form-row">
          <label for="chunk-size">Dimensiunea segmentului: <strong id="chunk-size-label">${defaultChunkSize}</strong> caractere</label>
          <input id="chunk-size" type="range" min="500" max="8000" step="250" value="${defaultChunkSize}" />
          <span class="help">2.000–3.500 de caractere este o zonă bună pentru traducerea automată. Segmentele mai mari reduc repetarea promptului, dar durează mai mult per apel.</span>
        </div>
        <div class="form-row">
          <label for="system-prompt">Promptul standard</label>
          <textarea id="system-prompt" class="textarea" style="min-height:210px">${escapeHtml(DEFAULT_SYSTEM_PROMPT)}</textarea>
        </div>
        <label class="checkbox-row">
          <input id="auto-translate-after-create" type="checkbox" checked />
          <span>Începe automat traducerea tuturor segmentelor imediat după crearea proiectului, folosind ${escapeHtml(deepSeekModelLabel(state.deepseek?.model || "deepseek-v4-flash"))}.</span>
        </label>
        <label class="checkbox-row">
          <input id="upload-pdf" type="checkbox" ${APP_CONFIG.uploadOriginalPdfByDefault ? "checked" : ""} />
          <span>Salvează și PDF-ul original în Supabase Storage. Dacă rămâne debifat, PDF-ul nu părăsește browserul; textul extras și traducerile sunt totuși salvate în baza de date.</span>
        </label>
      </div>
      <div class="modal-footer">
        <button id="cancel-create" class="btn btn-ghost" type="button">Renunță</button>
        <button id="submit-create" class="btn btn-primary" type="submit">Extrage și creează proiectul</button>
      </div>
    </form>`);

  const fileInput = document.querySelector("#project-file");
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    const title = document.querySelector("#project-title");
    if (file && !title.value.trim()) title.value = file.name.replace(/\.pdf$/i, "");
  });

  const range = document.querySelector("#chunk-size");
  range.addEventListener("input", () => {
    document.querySelector("#chunk-size-label").textContent = range.value;
  });

  document.querySelector("#close-modal")?.addEventListener("click", closeModal);
  document.querySelector("#cancel-create")?.addEventListener("click", closeModal);
  document.querySelector("#create-project-form")?.addEventListener("submit", handleCreateProject);
}

async function handleCreateProject(event) {
  event.preventDefault();
  const button = document.querySelector("#submit-create");
  const status = document.querySelector("#create-status");
  const file = document.querySelector("#project-file").files?.[0];
  const title = document.querySelector("#project-title").value.trim() || file?.name.replace(/\.pdf$/i, "") || "Document medical";
  const chunkSize = Number(document.querySelector("#chunk-size").value);
  const systemPrompt = document.querySelector("#system-prompt").value.trim();
  const uploadPdf = document.querySelector("#upload-pdf").checked;
  const autoTranslate = document.querySelector("#auto-translate-after-create").checked;

  setButtonLoading(button, true, "Se extrage PDF-ul…");
  status.innerHTML = '<div class="info-box">Pornesc extragerea locală a textului…</div>';

  try {
    const extraction = await extractPdf(file, ({ current, total }) => {
      status.innerHTML = `<div class="info-box">Extrag pagina ${current} din ${total}…</div>`;
    });

    if (extraction.likelyScanned) {
      throw new Error("PDF-ul pare scanat sau conține prea puțin text selectabil. Această versiune nu include OCR.");
    }

    const chunks = buildChunks(extraction.pages, chunkSize);
    if (!chunks.length) throw new Error("Nu am găsit text care să poată fi împărțit în segmente.");

    status.innerHTML = `<div class="info-box">Am obținut ${chunks.length} segmente. Le salvez în Supabase…</div>`;
    const project = await createProject({
      userId: state.session.user.id,
      title,
      file,
      pageCount: extraction.pageCount,
      chunkSize,
      systemPrompt,
      chunks,
      uploadPdf,
    });

    closeModal();
    toast(`Proiect creat: ${chunks.length} segmente.`, "success");
    await openProject(project.id);
    if (autoTranslate) {
      await startAutoTranslation({ onlyUntranslated: true, autoStarted: true });
    }
  } catch (error) {
    status.innerHTML = `<div class="error-box">${escapeHtml(error.message || "Crearea proiectului a eșuat.")}</div>`;
  } finally {
    setButtonLoading(button, false);
  }
}

function triggerBackupImport() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const project = await importBackup({ userId: state.session.user.id, backup });
      toast("Backup importat cu succes.", "success");
      await openProject(project.id);
    } catch (error) {
      toast(error.message || "Importul a eșuat.", "error", 5000);
    }
  });
  input.click();
}

function showGlossaryModal() {
  const items = state.glossary.length
    ? state.glossary.map((entry) => `
      <div class="glossary-item">
        <strong>${escapeHtml(entry.source_term)}</strong>
        <span>${escapeHtml(entry.preferred_translation)}${entry.note ? ` · ${escapeHtml(entry.note)}` : ""}</span>
        <button class="btn btn-danger btn-sm remove-glossary" data-id="${entry.id}">Șterge</button>
      </div>`).join("")
    : '<div class="empty-state"><h3>Glosarul este gol</h3><p>Adaugă termenii pe care vrei să îi incluzi automat în prompt.</p></div>';

  showModal(`
    <div class="modal-head">
      <h3>Glosar medical</h3>
      <button id="close-modal" class="btn btn-icon btn-ghost">×</button>
    </div>
    <div class="modal-body">
      <form id="glossary-form" class="form-grid">
        <div id="glossary-message"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="form-row"><label for="source-term">Termen sursă</label><input id="source-term" class="input" required placeholder="guidewire" /></div>
          <div class="form-row"><label for="preferred-term">Traducere preferată</label><input id="preferred-term" class="input" required placeholder="guidewire / ghid metalic" /></div>
        </div>
        <div class="form-row"><label for="term-note">Notă opțională</label><input id="term-note" class="input" placeholder="Nu se traduce în protocoale PCI" /></div>
        <div><button id="add-term" class="btn btn-primary" type="submit">Adaugă termenul</button></div>
      </form>
      <div class="glossary-list">${items}</div>
    </div>`);

  document.querySelector("#close-modal")?.addEventListener("click", closeModal);
  document.querySelector("#glossary-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector("#add-term");
    const message = document.querySelector("#glossary-message");
    setButtonLoading(button, true, "Se adaugă…");
    try {
      await addGlossaryEntry({
        userId: state.session.user.id,
        sourceTerm: document.querySelector("#source-term").value.trim(),
        preferredTranslation: document.querySelector("#preferred-term").value.trim(),
        note: document.querySelector("#term-note").value.trim(),
      });
      state.glossary = await listGlossary();
      showGlossaryModal();
      toast("Termen adăugat în glosar.", "success");
    } catch (error) {
      message.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
    } finally {
      setButtonLoading(button, false);
    }
  });

  document.querySelectorAll(".remove-glossary").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await deleteGlossaryEntry(button.dataset.id);
        state.glossary = await listGlossary();
        showGlossaryModal();
      } catch (error) {
        toast(error.message, "error");
      }
    });
  });
}

async function confirmDeleteProject(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;

  showModal(`
    <div class="modal-head"><h3>Ștergi proiectul?</h3><button id="close-modal" class="btn btn-icon btn-ghost">×</button></div>
    <div class="modal-body">
      <div class="warning-box">Proiectul <strong>${escapeHtml(project.title)}</strong>, segmentele și traducerile sale vor fi șterse definitiv.</div>
    </div>
    <div class="modal-footer">
      <button id="cancel-delete" class="btn btn-ghost">Renunță</button>
      <button id="confirm-delete" class="btn btn-danger">Șterge definitiv</button>
    </div>`, "modal-sm");

  document.querySelector("#close-modal")?.addEventListener("click", closeModal);
  document.querySelector("#cancel-delete")?.addEventListener("click", closeModal);
  document.querySelector("#confirm-delete")?.addEventListener("click", async () => {
    const button = document.querySelector("#confirm-delete");
    setButtonLoading(button, true, "Se șterge…");
    try {
      await deleteProject(project);
      closeModal();
      toast("Proiectul a fost șters.", "success");
      await loadDashboard();
    } catch (error) {
      toast(error.message, "error");
      setButtonLoading(button, false);
    }
  });
}

async function openProject(projectId) {
  app.innerHTML = `${topbar({ editor: true })}<main class="container-wide"><div class="empty-state"><span class="loader loader-dark"></span> Se încarcă proiectul…</div></main>`;
  attachTopbarListeners();

  try {
    const [project, chunks, glossary, knowledge] = await Promise.all([
      getProject(projectId),
      getProjectChunks(projectId),
      listGlossary(),
      getProjectKnowledge(projectId).catch((error) => ({ chapters: [], concepts: [], setupError: error })),
    ]);
    state.currentProject = project;
    state.chunks = chunks;
    state.glossary = glossary;
    state.chapters = knowledge.chapters;
    state.concepts = knowledge.concepts;
    state.knowledgeSetupError = knowledge.setupError || null;
    state.currentIndex = Math.max(0, state.chunks.findIndex((chunk) => chunk.status !== "approved"));
    if (state.currentIndex < 0) state.currentIndex = 0;
    state.chunkSearch = "";
    state.knowledgeSearch = "";
    state.projectView = "translation";
    state.selectedConceptId = state.concepts[0]?.id ?? null;
    state.collapsedChapters = new Set();
    window.location.hash = `project=${projectId}`;
    renderEditor();
  } catch (error) {
    toast(error.message || "Nu am putut deschide proiectul.", "error");
    await loadDashboard();
  }
}

function relevantGlossaryForChunk(chunk) {
  const source = (chunk?.source_text || "").toLocaleLowerCase("en");
  return state.glossary.filter((entry) => source.includes(entry.source_term.toLocaleLowerCase("en")));
}

function buildCopyPrompt(project, chunk) {
  const relevant = relevantGlossaryForChunk(chunk);
  const glossaryBlock = relevant.length
    ? `\n\nGLOSAR OBLIGATORIU PENTRU ACEST SEGMENT:\n${relevant.map((entry) => `- ${entry.source_term} → ${entry.preferred_translation}${entry.note ? ` (${entry.note})` : ""}`).join("\n")}`
    : "";

  return `${project.system_prompt || DEFAULT_SYSTEM_PROMPT}${glossaryBlock}\n\nCONTEXT: ${pagesLabel(chunk.page_start, chunk.page_end)}\n\n--- TEXT DE TRADUS ---\n${chunk.source_text}`;
}

function buildDeepSeekUserPrompt(chunk) {
  const relevant = relevantGlossaryForChunk(chunk);
  const glossaryBlock = relevant.length
    ? `GLOSAR OBLIGATORIU PENTRU ACEST SEGMENT:\n${relevant.map((entry) => `- ${entry.source_term} → ${entry.preferred_translation}${entry.note ? ` (${entry.note})` : ""}`).join("\n")}\n\n`
    : "";

  return `${glossaryBlock}CONTEXT: ${pagesLabel(chunk.page_start, chunk.page_end)}\n\n--- TEXT DE TRADUS ---\n${chunk.source_text}`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function addUsage(usage = {}) {
  state.ai.usage.prompt_tokens += Number(usage.prompt_tokens || 0);
  state.ai.usage.completion_tokens += Number(usage.completion_tokens || 0);
  state.ai.usage.total_tokens += Number(usage.total_tokens || 0);
}

async function translateChunkWithRetry(chunk, maxAttempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await invokeDeepSeekTranslation({
        apiKey: state.deepseek.apiKey,
        model: state.deepseek.model,
        systemPrompt: state.currentProject.system_prompt || DEFAULT_SYSTEM_PROMPT,
        userPrompt: buildDeepSeekUserPrompt(chunk),
      });
    } catch (error) {
      lastError = error;
      const retryable = !error.status || [408, 429, 500, 502, 503, 504].includes(Number(error.status));
      if (!retryable || attempt === maxAttempts || state.ai.stopRequested) break;
      await sleep(attempt === 1 ? 1600 : 4200);
    }
  }

  throw lastError;
}

function showAutoTranslationProgressModal() {
  showModal(`
    <div class="modal-head">
      <h3>Traducere automată DeepSeek</h3>
      <span class="badge primary">${escapeHtml(deepSeekModelLabel(state.deepseek.model))}</span>
    </div>
    <div class="modal-body form-grid">
      <div id="ai-progress-message" class="info-box">Pregătesc segmentele…</div>
      <div class="progress-track ai-progress-track"><div id="ai-progress-bar" class="progress-bar" style="width:0%"></div></div>
      <div class="ai-progress-grid">
        <div><span>Finalizate</span><strong id="ai-progress-count">0 / ${state.ai.total}</strong></div>
        <div><span>Erori</span><strong id="ai-error-count">0</strong></div>
        <div><span>Tokeni</span><strong id="ai-token-count">0</strong></div>
      </div>
      <div class="warning-box">Nu închide fila cât timp rulează traducerea. Poți opri procesul după segmentul curent; rezultatele deja salvate rămân în Supabase.</div>
    </div>
    <div class="modal-footer">
      <button id="stop-auto-translation" class="btn btn-danger" type="button">Oprește după segmentul curent</button>
    </div>`, "modal-sm", { locked: true });

  document.querySelector("#stop-auto-translation")?.addEventListener("click", () => {
    state.ai.stopRequested = true;
    const button = document.querySelector("#stop-auto-translation");
    button.disabled = true;
    button.textContent = "Se oprește…";
    const message = document.querySelector("#ai-progress-message");
    if (message) message.textContent = "Oprirea a fost solicitată. Aștept finalizarea segmentului curent…";
  });
}

function updateAutoTranslationProgress({ message } = {}) {
  const progress = state.ai.total ? Math.round((state.ai.completed / state.ai.total) * 100) : 0;
  const bar = document.querySelector("#ai-progress-bar");
  const count = document.querySelector("#ai-progress-count");
  const errors = document.querySelector("#ai-error-count");
  const tokens = document.querySelector("#ai-token-count");
  const messageElement = document.querySelector("#ai-progress-message");
  if (bar) bar.style.width = `${progress}%`;
  if (count) count.textContent = `${state.ai.completed} / ${state.ai.total}`;
  if (errors) errors.textContent = String(state.ai.failed.length);
  if (tokens) tokens.textContent = new Intl.NumberFormat("ro-RO").format(state.ai.usage.total_tokens);
  if (messageElement && message) messageElement.textContent = message;
}

function showAutoTranslationResult({ stopped = false } = {}) {
  const failed = state.ai.failed.length;
  const success = state.ai.completed - failed;
  const failureList = failed
    ? `<div class="error-box"><strong>${failed} segmente nu au fost traduse:</strong><br>${state.ai.failed.slice(0, 8).map((item) => `Segment ${item.position + 1}: ${escapeHtml(item.message)}`).join("<br>")}${failed > 8 ? `<br>…și încă ${failed - 8}` : ""}</div>`
    : '<div class="success-box">Toate segmentele selectate au fost traduse și salvate.</div>';

  showModal(`
    <div class="modal-head"><h3>${stopped ? "Traducere oprită" : "Traducere finalizată"}</h3><button id="close-ai-result" class="btn btn-icon btn-ghost">×</button></div>
    <div class="modal-body form-grid">
      ${failureList}
      <div class="ai-progress-grid">
        <div><span>Reușite</span><strong>${success}</strong></div>
        <div><span>Erori</span><strong>${failed}</strong></div>
        <div><span>Tokeni</span><strong>${new Intl.NumberFormat("ro-RO").format(state.ai.usage.total_tokens)}</strong></div>
      </div>
      ${stopped ? '<div class="warning-box">Procesul a fost oprit după segmentul curent. Îl poți relua oricând cu „Traduce automat toate netraduse”.</div>' : ""}
    </div>
    <div class="modal-footer">
      ${failed ? '<button id="retry-ai-failures" class="btn btn-accent" type="button">Reîncearcă segmentele cu eroare</button>' : ""}
      <button id="done-ai-result" class="btn btn-primary" type="button">Închide</button>
    </div>`, "modal-sm");

  const closeResult = () => {
    closeModal();
    renderEditor();
  };
  document.querySelector("#close-ai-result")?.addEventListener("click", closeResult);
  document.querySelector("#done-ai-result")?.addEventListener("click", closeResult);
  document.querySelector("#retry-ai-failures")?.addEventListener("click", async () => {
    const indices = state.ai.failed.map((item) => item.index);
    closeModal();
    await startAutoTranslation({ indices, onlyUntranslated: false });
  });
}

async function startAutoTranslation({ indices = null, onlyUntranslated = true, autoStarted = false } = {}) {
  if (state.ai.running) {
    toast("O traducere automată este deja în curs.", "error");
    return;
  }

  state.deepseek = loadDeepSeekSession();
  if (!state.deepseek) {
    showDeepSeekSettingsModal({ required: true });
    return;
  }

  await flushActiveEdits();

  const candidateIndices = Array.isArray(indices)
    ? indices.filter((index) => Number.isInteger(index) && state.chunks[index])
    : state.chunks.map((_, index) => index);
  const targets = candidateIndices.filter((index) => {
    const chunk = state.chunks[index];
    return !onlyUntranslated || !chunk.translated_text?.trim();
  });

  if (!targets.length) {
    toast("Nu există segmente netraduse.", "success");
    return;
  }

  state.ai = {
    running: true,
    stopRequested: false,
    completed: 0,
    total: targets.length,
    currentPosition: null,
    failed: [],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
  showAutoTranslationProgressModal();

  for (const index of targets) {
    if (state.ai.stopRequested) break;
    const chunk = state.chunks[index];
    state.ai.currentPosition = chunk.position;
    updateAutoTranslationProgress({
      message: `Traduc segmentul ${chunk.position + 1} din ${state.chunks.length} · ${pagesLabel(chunk.page_start, chunk.page_end)}…`,
    });

    try {
      const response = await translateChunkWithRetry(chunk);
      const saved = await updateChunk(chunk.id, {
        translated_text: response.translation.trim(),
        status: "draft",
      });
      Object.assign(chunk, saved, { _dirty: false });
      addUsage(response.usage);
    } catch (error) {
      state.ai.failed.push({
        index,
        position: chunk.position,
        status: error.status || 0,
        message: error.message || "Eroare necunoscută",
      });

      if ([401, 402, 403].includes(Number(error.status))) {
        state.ai.stopRequested = true;
      }
    } finally {
      state.ai.completed += 1;
      updateAutoTranslationProgress();
    }
  }

  const stopped = state.ai.stopRequested && state.ai.completed < state.ai.total;
  state.ai.running = false;
  state.ai.currentPosition = null;
  renderEditor();
  showAutoTranslationResult({ stopped });

  if (autoStarted && !state.ai.failed.length && !stopped) {
    toast("Traducerea automată a proiectului s-a încheiat.", "success");
  }
}

const KNOWLEDGE_SYSTEM_PROMPT = `Ești un arhitect de cunoștințe medicale. Analizezi un singur segment dintr-un curs sau manual medical și îl transformi într-o structură pentru un wiki personal.

Returnează EXCLUSIV un obiect JSON valid, fără Markdown, fără blocuri de cod și fără explicații, în forma:
{
  "chapter_title": "titlul capitolului în limba română sau __CONTINUE__",
  "chapter_summary": "rezumat fidel în maximum două fraze",
  "concepts": [
    {
      "title": "titlul clar al conceptului",
      "summary": "rezumat fidel al conceptului în una până la trei fraze",
      "tags": ["tag1", "tag2"]
    }
  ]
}

REGULI:
1. Folosește numai informațiile prezente în segment. Nu completa din cunoștințe externe.
2. Titlurile și rezumatele trebuie să fie în limba română, păstrând termenii medicali consacrați și abrevierile.
3. Dacă segmentul continuă clar capitolul precedent și nu începe un capitol nou, folosește exact "__CONTINUE__".
4. Identifică între 1 și 6 concepte utile pentru învățare. Nu crea concepte duplicate sau excesiv de generale.
5. Fiecare tag trebuie să fie scurt. Folosește maximum 5 tag-uri pentru un concept.
6. Păstrează cifrele, clasificările, pragurile, indicațiile și relațiile clinice importante în rezumate.
7. Răspunsul trebuie să poată fi procesat direct cu JSON.parse().`;

function projectViewTabs() {
  const translatedCount = state.chunks.filter((item) => item.translated_text?.trim()).length;
  return `<nav class="project-tabs" aria-label="Vizualizarea proiectului">
    <button class="project-tab ${state.projectView === "translation" ? "active" : ""}" data-project-view="translation">
      <span>Traducere</span><small>${translatedCount}/${state.chunks.length}</small>
    </button>
    <button class="project-tab ${state.projectView === "chapters" ? "active" : ""}" data-project-view="chapters">
      <span>Capitole</span><small>${state.chapters.length} capitole · ${state.concepts.length} concepte</small>
    </button>
  </nav>`;
}

function attachProjectViewTabs() {
  document.querySelectorAll("[data-project-view]").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextView = button.dataset.projectView;
      if (!nextView || nextView === state.projectView) return;
      await flushActiveEdits();
      state.projectView = nextView;
      if (nextView === "chapters" && !state.selectedConceptId) {
        state.selectedConceptId = state.concepts[0]?.id ?? null;
      }
      renderEditor();
    });
  });
}

function normalizeKnowledgeTitle(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ro")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanKnowledgeText(value, maxLength = 4000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function parseKnowledgeJson(rawText) {
  let text = String(rawText || "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) text = text.slice(firstBrace, lastBrace + 1);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`DeepSeek nu a returnat JSON valid pentru structura capitolelor. Fragment: ${text.slice(0, 260)}`);
  }

  const chapterTitle = cleanKnowledgeText(parsed?.chapter_title, 300);
  const chapterSummary = cleanKnowledgeText(parsed?.chapter_summary, 1200);
  const concepts = Array.isArray(parsed?.concepts)
    ? parsed.concepts
      .map((concept) => ({
        title: cleanKnowledgeText(concept?.title, 300),
        summary: cleanKnowledgeText(concept?.summary, 1800),
        tags: Array.isArray(concept?.tags)
          ? [...new Set(concept.tags.map((tag) => cleanKnowledgeText(tag, 80)).filter(Boolean))].slice(0, 5)
          : [],
      }))
      .filter((concept) => concept.title)
      .slice(0, 8)
    : [];

  if (!chapterTitle) throw new Error("DeepSeek nu a identificat titlul capitolului.");
  if (!concepts.length) throw new Error("DeepSeek nu a identificat niciun concept în segment.");

  return {
    chapter_title: chapterTitle,
    chapter_summary: chapterSummary,
    concepts,
  };
}

function buildKnowledgeUserPrompt(chunk, previousChapterTitle, strictRetry = false) {
  const workingText = chunk.translated_text?.trim() || chunk.source_text?.trim() || "";
  return `${strictRetry ? "ATENȚIE: răspunsul anterior nu a putut fi procesat. Returnează numai JSON valid, fără niciun caracter înainte sau după obiect.\n\n" : ""}CAPITOL PRECEDENT IDENTIFICAT: ${previousChapterTitle || "niciunul — acesta este primul segment"}
SEGMENT: ${chunk.position + 1}
PAGINI SURSĂ: ${pagesLabel(chunk.page_start, chunk.page_end)}
LIMBA TEXTULUI: ${chunk.translated_text?.trim() ? "română" : "textul sursă; rezultatul trebuie totuși redactat în română"}

TEXT DE ANALIZAT:
${workingText}`;
}

async function extractChunkKnowledgeWithRetry(chunk, previousChapterTitle, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await invokeDeepSeekTranslation({
        apiKey: state.deepseek.apiKey,
        model: state.deepseek.model,
        systemPrompt: KNOWLEDGE_SYSTEM_PROMPT,
        userPrompt: buildKnowledgeUserPrompt(chunk, previousChapterTitle, attempt > 1),
      });
      return {
        structure: parseKnowledgeJson(response.translation),
        usage: response.usage || null,
      };
    } catch (error) {
      lastError = error;
      const retryable = !error.status || [408, 429, 500, 502, 503, 504].includes(Number(error.status));
      if (!retryable || attempt === maxAttempts || state.knowledge.stopRequested) break;
      await sleep(attempt === 1 ? 900 : 2200);
    }
  }
  throw lastError;
}

function appendUniqueSummary(existing, addition, limit = 1800) {
  const current = cleanKnowledgeText(existing, limit);
  const next = cleanKnowledgeText(addition, limit);
  if (!next || current.includes(next)) return current;
  if (!current) return next;
  return `${current} ${next}`.slice(0, limit);
}

function mergeChunkKnowledge(accumulator, structure, chunk) {
  const continuation = /^(__CONTINUE__|continuare|același capitol|acelasi capitol)$/i.test(structure.chapter_title);
  const previousChapter = accumulator.at(-1) ?? null;
  const requestedTitle = continuation
    ? (previousChapter?.title || "Introducere")
    : structure.chapter_title;
  const title = requestedTitle || previousChapter?.title || `Capitol ${accumulator.length + 1}`;
  const sameAsPrevious = previousChapter && normalizeKnowledgeTitle(previousChapter.title) === normalizeKnowledgeTitle(title);

  const chapter = sameAsPrevious
    ? previousChapter
    : (() => {
      const created = {
        title,
        summary: "",
        position: accumulator.length,
        page_start: chunk.page_start ?? null,
        page_end: chunk.page_end ?? null,
        concepts: [],
      };
      accumulator.push(created);
      return created;
    })();

  chapter.summary = appendUniqueSummary(chapter.summary, structure.chapter_summary, 2200);
  if (chunk.page_start) chapter.page_start = chapter.page_start ? Math.min(chapter.page_start, chunk.page_start) : chunk.page_start;
  if (chunk.page_end) chapter.page_end = chapter.page_end ? Math.max(chapter.page_end, chunk.page_end) : chunk.page_end;

  for (const candidate of structure.concepts) {
    const key = normalizeKnowledgeTitle(candidate.title);
    let concept = chapter.concepts.find((item) => normalizeKnowledgeTitle(item.title) === key);
    if (!concept) {
      concept = {
        title: candidate.title,
        summary: candidate.summary,
        tags: [...candidate.tags],
        position: chapter.concepts.length,
        page_start: chunk.page_start ?? null,
        page_end: chunk.page_end ?? null,
        source_chunk_ids: [chunk.id],
      };
      chapter.concepts.push(concept);
      continue;
    }

    concept.summary = appendUniqueSummary(concept.summary, candidate.summary, 2200);
    concept.tags = [...new Set([...(concept.tags || []), ...candidate.tags])].slice(0, 8);
    if (!concept.source_chunk_ids.includes(chunk.id)) concept.source_chunk_ids.push(chunk.id);
    if (chunk.page_start) concept.page_start = concept.page_start ? Math.min(concept.page_start, chunk.page_start) : chunk.page_start;
    if (chunk.page_end) concept.page_end = concept.page_end ? Math.max(concept.page_end, chunk.page_end) : chunk.page_end;
  }

  return chapter.title;
}

function showKnowledgeProgressModal() {
  showModal(`
    <div class="modal-head">
      <h3>Generez capitolele și conceptele</h3>
      <span class="badge primary">${escapeHtml(deepSeekModelLabel(state.deepseek.model))}</span>
    </div>
    <div class="modal-body form-grid">
      <div id="knowledge-progress-message" class="info-box">Pregătesc segmentele…</div>
      <div class="progress-track ai-progress-track"><div id="knowledge-progress-bar" class="progress-bar" style="width:0%"></div></div>
      <div class="ai-progress-grid">
        <div><span>Analizate</span><strong id="knowledge-progress-count">0 / ${state.knowledge.total}</strong></div>
        <div><span>Erori</span><strong id="knowledge-error-count">0</strong></div>
        <div><span>Tokeni</span><strong id="knowledge-token-count">0</strong></div>
      </div>
      <div class="info-box">Structura este construită segment cu segment. DeepSeek vede textul tradus când există, iar în rest folosește textul original. Informația nu este completată din surse externe.</div>
    </div>
    <div class="modal-footer">
      <button id="stop-knowledge-generation" class="btn btn-danger" type="button">Oprește după segmentul curent</button>
    </div>`, "modal-sm", { locked: true });

  document.querySelector("#stop-knowledge-generation")?.addEventListener("click", () => {
    state.knowledge.stopRequested = true;
    const button = document.querySelector("#stop-knowledge-generation");
    button.disabled = true;
    button.textContent = "Se oprește…";
  });
}

function updateKnowledgeProgress(message = "") {
  const progress = state.knowledge.total
    ? Math.round((state.knowledge.completed / state.knowledge.total) * 100)
    : 0;
  const totalTokens = state.knowledge.usage.total_tokens || 0;
  const bar = document.querySelector("#knowledge-progress-bar");
  const count = document.querySelector("#knowledge-progress-count");
  const errors = document.querySelector("#knowledge-error-count");
  const tokens = document.querySelector("#knowledge-token-count");
  const messageElement = document.querySelector("#knowledge-progress-message");
  if (bar) bar.style.width = `${progress}%`;
  if (count) count.textContent = `${state.knowledge.completed} / ${state.knowledge.total}`;
  if (errors) errors.textContent = String(state.knowledge.failed.length);
  if (tokens) tokens.textContent = new Intl.NumberFormat("ro-RO").format(totalTokens);
  if (messageElement && message) messageElement.textContent = message;
}

async function startKnowledgeGeneration() {
  if (state.knowledgeSetupError) {
    toast("Rulează mai întâi fișierul supabase/phase1_chapters.sql în SQL Editor.", "error", 7000);
    return;
  }

  if (state.knowledge.running || state.ai.running) {
    toast("Există deja un proces DeepSeek în desfășurare.", "error");
    return;
  }

  state.deepseek = loadDeepSeekSession();
  if (!state.deepseek) {
    showDeepSeekSettingsModal({ required: true });
    return;
  }

  if (state.chapters.length && !window.confirm("Regenerarea va înlocui structura actuală de capitole și concepte. Continui?")) return;
  await flushActiveEdits();

  const targets = state.chunks.filter((chunk) => chunk.translated_text?.trim() || chunk.source_text?.trim());
  if (!targets.length) {
    toast("Proiectul nu conține text care să poată fi analizat.", "error");
    return;
  }

  state.knowledge = {
    running: true,
    stopRequested: false,
    completed: 0,
    total: targets.length,
    failed: [],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
  showKnowledgeProgressModal();

  const generatedChapters = [];
  let previousChapterTitle = "";

  for (const chunk of targets) {
    if (state.knowledge.stopRequested) break;
    updateKnowledgeProgress(`Analizez segmentul ${chunk.position + 1} din ${state.chunks.length} · ${pagesLabel(chunk.page_start, chunk.page_end)}…`);

    try {
      const result = await extractChunkKnowledgeWithRetry(chunk, previousChapterTitle);
      previousChapterTitle = mergeChunkKnowledge(generatedChapters, result.structure, chunk);
      const usage = result.usage || {};
      state.knowledge.usage.prompt_tokens += Number(usage.prompt_tokens || 0);
      state.knowledge.usage.completion_tokens += Number(usage.completion_tokens || 0);
      state.knowledge.usage.total_tokens += Number(usage.total_tokens || 0);
    } catch (error) {
      state.knowledge.failed.push({
        position: chunk.position,
        message: error.message || "Eroare necunoscută",
      });
      if ([401, 402, 403].includes(Number(error.status))) state.knowledge.stopRequested = true;
    } finally {
      state.knowledge.completed += 1;
      updateKnowledgeProgress();
    }
  }

  if (!generatedChapters.length) {
    state.knowledge.running = false;
    closeModal();
    const details = state.knowledge.failed[0]?.message || "Nu a fost generat niciun capitol.";
    toast(details, "error", 7000);
    return;
  }

  try {
    updateKnowledgeProgress("Salvez structura în Supabase…");
    const saved = await replaceProjectKnowledge(state.currentProject.id, generatedChapters);
    state.chapters = saved.chapters;
    state.concepts = saved.concepts;
    state.knowledgeSetupError = null;
    state.selectedConceptId = state.concepts[0]?.id ?? null;
    state.collapsedChapters = new Set();
    state.knowledge.running = false;
    closeModal();
    renderEditor();

    if (state.knowledge.failed.length) {
      const firstErrors = state.knowledge.failed.slice(0, 4)
        .map((item) => `Segment ${item.position + 1}: ${item.message}`)
        .join("\n");
      toast(`Structura a fost salvată, dar ${state.knowledge.failed.length} segmente au fost omise. ${firstErrors}`, "error", 9000);
    } else {
      toast(`Am generat ${state.chapters.length} capitole și ${state.concepts.length} concepte.`, "success", 5000);
    }
  } catch (error) {
    state.knowledge.running = false;
    closeModal();
    toast(error.message || "Nu am putut salva structura capitolelor.", "error", 7000);
  }
}

function conceptsForChapter(chapterId) {
  return state.concepts
    .filter((concept) => concept.chapter_id === chapterId)
    .sort((a, b) => a.position - b.position);
}

function selectedKnowledgeConcept() {
  return state.concepts.find((concept) => concept.id === state.selectedConceptId) ?? state.concepts[0] ?? null;
}

const CONCEPT_EDITOR_ALLOWED_TAGS = new Set([
  "P", "BR", "H2", "H3", "STRONG", "B", "EM", "I", "U", "S",
  "UL", "OL", "LI", "BLOCKQUOTE", "A", "MARK",
]);

const CONCEPT_HIGHLIGHT_TYPES = new Set(["important", "definition", "example", "review"]);

function sanitizeConceptHtml(rawHtml) {
  const template = document.createElement("template");
  template.innerHTML = String(rawHtml || "");

  const cleanNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || "");
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();

    const sourceTag = node.tagName.toUpperCase();
    const normalizedTag = sourceTag === "DIV" ? "P" : sourceTag === "H1" ? "H2" : sourceTag;
    const fragment = document.createDocumentFragment();

    if (!CONCEPT_EDITOR_ALLOWED_TAGS.has(normalizedTag)) {
      [...node.childNodes].forEach((child) => fragment.appendChild(cleanNode(child)));
      return fragment;
    }

    const element = document.createElement(normalizedTag.toLowerCase());
    if (normalizedTag === "A") {
      const href = String(node.getAttribute("href") || "").trim();
      if (/^(https?:|mailto:|#)/i.test(href)) {
        element.setAttribute("href", href);
        if (/^https?:/i.test(href)) {
          element.setAttribute("target", "_blank");
          element.setAttribute("rel", "noopener noreferrer");
        }
      }
    }

    if (normalizedTag === "MARK") {
      const highlight = String(node.getAttribute("data-highlight") || "").trim().toLowerCase();
      if (!CONCEPT_HIGHLIGHT_TYPES.has(highlight)) {
        [...node.childNodes].forEach((child) => fragment.appendChild(cleanNode(child)));
        return fragment;
      }
      element.setAttribute("data-highlight", highlight);
    }

    [...node.childNodes].forEach((child) => element.appendChild(cleanNode(child)));
    return element;
  };

  const wrapper = document.createElement("div");
  [...template.content.childNodes].forEach((node) => wrapper.appendChild(cleanNode(node)));
  return wrapper.innerHTML.trim();
}

function plainTextToConceptHtml(value) {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return "<p><br></p>";

  const lines = text.split("\n");
  const output = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];

  const inline = (line) => escapeHtml(line)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+?)\*/g, "<em>$1</em>");

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length || !listType) return;
    output.push(`<${listType}>${listItems.map((item) => `<li>${inline(item)}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^#{1,3}\s+(.+)$/);
    const bullet = line.match(/^[-•]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    const quote = line.match(/^>\s?(.+)$/);

    if (heading) {
      flushParagraph();
      flushList();
      output.push(`<${heading[0].startsWith("###") ? "h3" : "h2"}>${inline(heading[1])}</${heading[0].startsWith("###") ? "h3" : "h2"}>`);
    } else if (bullet || ordered) {
      flushParagraph();
      const nextType = bullet ? "ul" : "ol";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((bullet || ordered)[1]);
    } else if (quote) {
      flushParagraph();
      flushList();
      output.push(`<blockquote>${inline(quote[1])}</blockquote>`);
    } else {
      flushList();
      paragraph.push(line);
    }
  }

  flushParagraph();
  flushList();
  return sanitizeConceptHtml(output.join(""));
}

function conceptOriginalText(concept, sourceChunks = []) {
  if (concept?.content_original?.trim()) return concept.content_original;
  const fromChunks = sourceChunks
    .map((chunk) => chunk.translated_text?.trim() || chunk.source_text?.trim() || "")
    .filter(Boolean)
    .join("\n\n");
  return fromChunks || concept?.summary || "";
}

function conceptEditorHtml(concept, sourceChunks = []) {
  if (concept?.content_edited?.trim()) return sanitizeConceptHtml(concept.content_edited);
  return plainTextToConceptHtml(conceptOriginalText(concept, sourceChunks));
}

function conceptWordCount(html) {
  const holder = document.createElement("div");
  holder.innerHTML = sanitizeConceptHtml(html);
  const text = holder.textContent?.trim() || "";
  return text ? text.split(/\s+/).length : 0;
}

function conceptHighlightCounts(html) {
  const holder = document.createElement("div");
  holder.innerHTML = sanitizeConceptHtml(html);
  const counts = { important: 0, definition: 0, example: 0, review: 0 };
  holder.querySelectorAll("mark[data-highlight]").forEach((mark) => {
    const type = mark.dataset.highlight;
    if (Object.prototype.hasOwnProperty.call(counts, type)) counts[type] += 1;
  });
  return counts;
}

function conceptHighlightTotal(html) {
  return Object.values(conceptHighlightCounts(html)).reduce((sum, value) => sum + value, 0);
}

function conceptHasNotes(concept) {
  const holder = document.createElement("div");
  holder.innerHTML = sanitizeConceptHtml(concept?.personal_notes || "");
  return Boolean(holder.textContent?.trim());
}

function notesEditorHtml(concept) {
  return sanitizeConceptHtml(concept?.personal_notes || "");
}

function closestEditorBlock(node, editor) {
  let current = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  while (current && current !== editor) {
    if (["P", "H2", "H3", "LI", "BLOCKQUOTE"].includes(current.tagName)) return current;
    current = current.parentElement;
  }
  return editor;
}

function unwrapNode(node) {
  const parent = node?.parentNode;
  if (!parent) return;
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  parent.removeChild(node);
  parent.normalize();
}

function applyConceptHighlight(editor, type) {
  if (!CONCEPT_HIGHLIGHT_TYPES.has(type)) return false;
  restoreConceptEditorSelection(editor);
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) {
    toast("Selectează mai întâi textul pe care vrei să-l evidențiezi.", "error");
    return false;
  }

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return false;
  const startBlock = closestEditorBlock(range.startContainer, editor);
  const endBlock = closestEditorBlock(range.endContainer, editor);
  if (startBlock !== endBlock) {
    toast("Pentru un highlight curat, selectează text dintr-un singur paragraf sau element de listă.", "error", 5200);
    return false;
  }

  const fragment = range.extractContents();
  fragment.querySelectorAll?.("mark[data-highlight]").forEach(unwrapNode);
  const mark = document.createElement("mark");
  mark.dataset.highlight = type;
  mark.appendChild(fragment);
  range.insertNode(mark);

  selection.removeAllRanges();
  const newRange = document.createRange();
  newRange.selectNodeContents(mark);
  selection.addRange(newRange);
  conceptEditorSelection = newRange.cloneRange();
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function clearConceptHighlight(editor) {
  restoreConceptEditorSelection(editor);
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return false;

  const marks = [...editor.querySelectorAll("mark[data-highlight]")].filter((mark) => {
    try {
      return range.intersectsNode(mark);
    } catch {
      return false;
    }
  });

  const ancestor = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer.closest?.("mark[data-highlight]")
    : range.startContainer.parentElement?.closest("mark[data-highlight]");
  if (ancestor && editor.contains(ancestor) && !marks.includes(ancestor)) marks.push(ancestor);

  if (!marks.length) {
    toast("Selecția nu conține niciun highlight.", "error", 2600);
    return false;
  }
  marks.forEach(unwrapNode);
  conceptEditorSelection = null;
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function setConceptSaveState(label, className = "") {
  const element = document.querySelector("#concept-save-state");
  if (!element) return;
  element.textContent = label;
  element.className = `save-state ${className}`;
}

function formatConceptEditorTimestamp(value) {
  if (!value) return "niciodată";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "necunoscut";
  return date.toLocaleString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function persistConceptById(conceptId, { quiet = false } = {}) {
  const concept = state.concepts.find((item) => item.id === conceptId);
  if (!concept || !concept._editorDirty) return concept;

  if (concept.id === state.selectedConceptId) setConceptSaveState("Se salvează…", "saving");

  try {
    const sanitized = sanitizeConceptHtml(concept.content_edited || "");
    const saved = await saveConceptEditor(concept.id, sanitized);
    if (!saved) throw new Error("Supabase nu a returnat conceptul salvat.");
    Object.assign(concept, saved, { _editorDirty: false });
    if (concept.id === state.selectedConceptId) {
      setConceptSaveState("Salvat", "saved");
      const revision = document.querySelector("#concept-revision");
      const lastSaved = document.querySelector("#concept-last-saved");
      if (revision) revision.textContent = `revizia ${Number(concept.manual_revision || 0)}`;
      if (lastSaved) lastSaved.textContent = `ultima salvare: ${formatConceptEditorTimestamp(concept.editor_updated_at)}`;
    }
    if (!quiet) toast("Concept salvat.", "success", 1800);
    return concept;
  } catch (error) {
    if (concept.id === state.selectedConceptId) setConceptSaveState("Eroare la salvare", "");
    toast(error.message || "Nu am putut salva conceptul.", "error");
    throw error;
  }
}

function setConceptNotesSaveState(label, className = "") {
  const element = document.querySelector("#concept-notes-save-state");
  if (!element) return;
  element.textContent = label;
  element.className = `save-state ${className}`;
}

async function persistConceptNotesById(conceptId, { quiet = false } = {}) {
  const concept = state.concepts.find((item) => item.id === conceptId);
  if (!concept || !concept._notesDirty) return concept;

  if (concept.id === state.selectedConceptId) setConceptNotesSaveState("Se salvează…", "saving");
  try {
    const sanitized = sanitizeConceptHtml(concept.personal_notes || "");
    const saved = await saveConceptNotes(concept.id, sanitized);
    if (!saved) throw new Error("Supabase nu a returnat notițele salvate.");
    Object.assign(concept, saved, { _notesDirty: false });
    if (concept.id === state.selectedConceptId) {
      setConceptNotesSaveState("Salvat", "saved");
      const revision = document.querySelector("#concept-notes-revision");
      const lastSaved = document.querySelector("#concept-notes-last-saved");
      if (revision) revision.textContent = `revizia ${Number(concept.notes_revision || 0)}`;
      if (lastSaved) lastSaved.textContent = `ultima salvare: ${formatConceptEditorTimestamp(concept.notes_updated_at)}`;
    }
    if (!quiet) toast("Notițe salvate.", "success", 1800);
    return concept;
  } catch (error) {
    if (concept.id === state.selectedConceptId) setConceptNotesSaveState("Eroare la salvare", "");
    toast(error.message || "Nu am putut salva notițele.", "error");
    throw error;
  }
}

async function flushCurrentConcept() {
  conceptSaveDebounced?.cancel?.();
  conceptNotesSaveDebounced?.cancel?.();
  const dirtyConcepts = state.concepts.filter((concept) => concept._editorDirty);
  for (const concept of dirtyConcepts) {
    await persistConceptById(concept.id, { quiet: true });
  }
  const dirtyNotes = state.concepts.filter((concept) => concept._notesDirty);
  for (const concept of dirtyNotes) {
    await persistConceptNotesById(concept.id, { quiet: true });
  }
}

async function flushActiveEdits() {
  await flushCurrentChunk();
  await flushCurrentConcept();
}

function storeConceptEditorSelection(editor) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (editor.contains(range.commonAncestorContainer)) conceptEditorSelection = range.cloneRange();
}

function restoreConceptEditorSelection(editor) {
  if (!conceptEditorSelection) {
    editor.focus();
    return;
  }
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(conceptEditorSelection);
}

function runConceptEditorCommand(editor, command, value = null) {
  restoreConceptEditorSelection(editor);
  document.execCommand(command, false, value);
  storeConceptEditorSelection(editor);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

function renderKnowledgeView() {
  const project = state.currentProject;
  if (!project) return;

  const query = state.knowledgeSearch.toLocaleLowerCase("ro").trim();
  const visibleChapters = state.chapters.map((chapter) => {
    const chapterConcepts = conceptsForChapter(chapter.id);
    if (!query) return { chapter, concepts: chapterConcepts };
    const matchingConcepts = chapterConcepts.filter((concept) => {
      const haystack = `${concept.title} ${concept.summary} ${(concept.tags || []).join(" ")} ${concept.personal_notes || ""} ${concept.content_edited || ""}`.toLocaleLowerCase("ro");
      return haystack.includes(query);
    });
    const chapterMatches = `${chapter.title} ${chapter.summary}`.toLocaleLowerCase("ro").includes(query);
    return chapterMatches || matchingConcepts.length
      ? { chapter, concepts: chapterMatches ? chapterConcepts : matchingConcepts }
      : null;
  }).filter(Boolean);

  const visibleConceptIds = new Set(visibleChapters.flatMap((entry) => entry.concepts.map((concept) => concept.id)));
  if (state.selectedConceptId && !visibleConceptIds.has(state.selectedConceptId) && query) {
    state.selectedConceptId = visibleChapters[0]?.concepts[0]?.id ?? null;
  }
  if (!state.selectedConceptId && !query) state.selectedConceptId = state.concepts[0]?.id ?? null;

  const selected = query && !visibleConceptIds.has(state.selectedConceptId)
    ? null
    : selectedKnowledgeConcept();
  const selectedChapter = selected ? state.chapters.find((chapter) => chapter.id === selected.chapter_id) : null;

  const tree = visibleChapters.map(({ chapter, concepts }) => {
    const collapsed = state.collapsedChapters.has(chapter.id);
    const items = concepts.map((concept) => `
      <button class="concept-tree-item ${concept.id === selected?.id ? "active" : ""}" data-concept-id="${concept.id}">
        <span class="concept-tree-dot ${concept.content_edited?.trim() ? "edited" : ""} ${conceptHasNotes(concept) ? "has-notes" : ""}"></span>
        <span><strong>${escapeHtml(concept.title)}</strong><small>${escapeHtml(pagesLabel(concept.page_start, concept.page_end))}${concept.content_edited?.trim() ? " · editat" : ""}${conceptHasNotes(concept) ? " · notițe" : ""}${conceptHighlightTotal(concept.content_edited || "") ? ` · ${conceptHighlightTotal(concept.content_edited || "")} highlights` : ""}</small></span>
      </button>`).join("");
    return `<section class="knowledge-tree-chapter">
      <button class="knowledge-chapter-row" data-toggle-chapter="${chapter.id}" aria-expanded="${!collapsed}">
        <span class="chapter-chevron">${collapsed ? "›" : "⌄"}</span>
        <span><strong>${escapeHtml(chapter.title)}</strong><small>${concepts.length} concepte · ${escapeHtml(pagesLabel(chapter.page_start, chapter.page_end))}</small></span>
      </button>
      <div class="concept-tree-list ${collapsed ? "collapsed" : ""}">${items || '<div class="help" style="padding:8px 12px">Niciun concept găsit.</div>'}</div>
    </section>`;
  }).join("");

  const sourceChunks = selected
    ? (selected.source_chunk_ids || [])
      .map((chunkId) => state.chunks.find((chunk) => chunk.id === chunkId))
      .filter(Boolean)
      .sort((a, b) => a.position - b.position)
    : [];

  const phase2Ready = !selected || Object.prototype.hasOwnProperty.call(selected, "content_edited");
  const phase3Ready = !selected || Object.prototype.hasOwnProperty.call(selected, "personal_notes");
  const setupMessage = state.knowledgeSetupError
    ? `<div class="error-box"><strong>Schema pentru capitole nu este instalată.</strong><br>Rulează fișierele <code>phase1_chapters.sql</code>, <code>phase2_concept_editor.sql</code> și <code>phase3_notes_highlights.sql</code> în Supabase SQL Editor, apoi reîncarcă pagina.</div>`
    : !phase2Ready
      ? `<div class="error-box"><strong>Editorul Fazei 2 nu este instalat în Supabase.</strong><br>Rulează o singură dată fișierul <code>supabase/phase2_concept_editor.sql</code>, apoi reîncarcă pagina.</div>`
      : !phase3Ready
        ? `<div class="error-box"><strong>Faza 3 nu este instalată în Supabase.</strong><br>Rulează o singură dată fișierul <code>supabase/phase3_notes_highlights.sql</code>, apoi reîncarcă pagina. Editorul principal rămâne funcțional.</div>`
        : "";

  const editorHtml = selected ? conceptEditorHtml(selected, sourceChunks) : "";
  const notesHtml = selected ? notesEditorHtml(selected) : "";
  const wordCount = selected ? conceptWordCount(editorHtml) : 0;
  const highlightCounts = conceptHighlightCounts(editorHtml);
  const lastEdited = formatConceptEditorTimestamp(selected?.editor_updated_at);
  const lastNotesEdited = formatConceptEditorTimestamp(selected?.notes_updated_at);

  const conceptContent = selected ? `
    <article class="knowledge-concept-card">
      <div class="knowledge-breadcrumb">${escapeHtml(selectedChapter?.title || "Capitol")}</div>
      <div class="knowledge-concept-head">
        <div>
          <h2>${escapeHtml(selected.title)}</h2>
          <p>${escapeHtml(selected.summary || "Nu există încă un rezumat pentru acest concept.")}</p>
        </div>
        <span class="badge primary">${escapeHtml(pagesLabel(selected.page_start, selected.page_end))}</span>
      </div>
      ${(selected.tags || []).length ? `<div class="knowledge-tags">${selected.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
    </article>

    <section class="concept-editor-card">
      <header class="concept-editor-header">
        <div>
          <h3>Editorul conceptului</h3>
          <p>Versiunea ta este salvată separat de textul extras din PDF.</p>
        </div>
        <div class="concept-editor-meta">
          <span id="concept-word-count">${wordCount} cuvinte</span>
          <span id="concept-revision">revizia ${Number(selected.manual_revision || 0)}</span>
          <span id="concept-last-saved">ultima salvare: ${escapeHtml(lastEdited)}</span>
          <span id="concept-save-state" class="save-state saved">Salvat</span>
        </div>
      </header>

      <div class="concept-toolbar" role="toolbar" aria-label="Formatarea conceptului">
        <button type="button" class="editor-tool" data-editor-command="undo" title="Undo">↶</button>
        <button type="button" class="editor-tool" data-editor-command="redo" title="Redo">↷</button>
        <span class="toolbar-separator"></span>
        <button type="button" class="editor-tool text-tool" data-editor-block="p">Text</button>
        <button type="button" class="editor-tool text-tool" data-editor-block="h2">Titlu</button>
        <button type="button" class="editor-tool text-tool" data-editor-block="h3">Subtitlu</button>
        <span class="toolbar-separator"></span>
        <button type="button" class="editor-tool" data-editor-command="bold" title="Bold"><strong>B</strong></button>
        <button type="button" class="editor-tool" data-editor-command="italic" title="Italic"><em>I</em></button>
        <button type="button" class="editor-tool" data-editor-command="underline" title="Subliniat"><u>U</u></button>
        <button type="button" class="editor-tool" data-editor-command="strikeThrough" title="Tăiat"><s>S</s></button>
        <span class="toolbar-separator"></span>
        <button type="button" class="editor-tool highlight-tool highlight-important" data-highlight-type="important" title="Marchează ca important">Important</button>
        <button type="button" class="editor-tool highlight-tool highlight-definition" data-highlight-type="definition" title="Marchează o definiție">Definiție</button>
        <button type="button" class="editor-tool highlight-tool highlight-example" data-highlight-type="example" title="Marchează un exemplu">Exemplu</button>
        <button type="button" class="editor-tool highlight-tool highlight-review" data-highlight-type="review" title="Marchează pentru revizuire">De revăzut</button>
        <button type="button" class="editor-tool" id="clear-concept-highlight" title="Elimină highlight-ul selectat">Fără highlight</button>
        <span class="toolbar-separator"></span>
        <button type="button" class="editor-tool" data-editor-command="insertUnorderedList" title="Listă cu puncte">• Listă</button>
        <button type="button" class="editor-tool" data-editor-command="insertOrderedList" title="Listă numerotată">1. Listă</button>
        <button type="button" class="editor-tool" data-editor-block="blockquote" title="Citat">❝</button>
        <button type="button" class="editor-tool" id="concept-add-link" title="Adaugă link">🔗</button>
        <button type="button" class="editor-tool" data-editor-command="unlink" title="Elimină linkul">⛓</button>
        <button type="button" class="editor-tool" data-editor-command="removeFormat" title="Șterge formatarea">Tx</button>
      </div>

      <div class="highlight-summary" aria-label="Rezumat highlights">
        <span class="highlight-count important"><i></i>Important <strong id="highlight-count-important">${highlightCounts.important}</strong></span>
        <span class="highlight-count definition"><i></i>Definiții <strong id="highlight-count-definition">${highlightCounts.definition}</strong></span>
        <span class="highlight-count example"><i></i>Exemple <strong id="highlight-count-example">${highlightCounts.example}</strong></span>
        <span class="highlight-count review"><i></i>De revăzut <strong id="highlight-count-review">${highlightCounts.review}</strong></span>
      </div>

      <div id="concept-editor" class="concept-rich-editor ${phase2Ready ? "" : "disabled"}" contenteditable="${phase2Ready ? "true" : "false"}" spellcheck="true" data-placeholder="Scrie și structurează aici conceptul…">${editorHtml}</div>

      <footer class="concept-editor-footer">
        <div class="help">Autosave după aproximativ o secundă. HTML-ul este curățat înainte de salvare.</div>
        <div class="concept-editor-actions">
          <button id="copy-concept-text" class="btn btn-ghost btn-sm" type="button">Copiază textul</button>
          <button id="reset-concept-content" class="btn btn-ghost btn-sm" type="button" ${phase2Ready ? "" : "disabled"}>Revino la textul sursă</button>
          <button id="save-concept-now" class="btn btn-primary btn-sm" type="button" ${phase2Ready ? "" : "disabled"}>Salvează acum</button>
        </div>
      </footer>
    </section>

    <section class="concept-notes-card">
      <header class="concept-notes-header">
        <div>
          <h3>Notițele mele</h3>
          <p>Observații personale, întrebări și completări — separate de conținutul conceptului.</p>
        </div>
        <div class="concept-editor-meta">
          <span id="concept-notes-revision">revizia ${Number(selected.notes_revision || 0)}</span>
          <span id="concept-notes-last-saved">ultima salvare: ${escapeHtml(lastNotesEdited)}</span>
          <span id="concept-notes-save-state" class="save-state saved">Salvat</span>
        </div>
      </header>
      <div class="notes-toolbar" role="toolbar" aria-label="Formatarea notițelor">
        <button type="button" class="editor-tool notes-tool" data-notes-command="bold" title="Bold"><strong>B</strong></button>
        <button type="button" class="editor-tool notes-tool" data-notes-command="italic" title="Italic"><em>I</em></button>
        <button type="button" class="editor-tool notes-tool" data-notes-command="underline" title="Subliniat"><u>U</u></button>
        <span class="toolbar-separator"></span>
        <button type="button" class="editor-tool notes-tool" data-notes-command="insertUnorderedList">• Listă</button>
        <button type="button" class="editor-tool notes-tool" data-notes-command="insertOrderedList">1. Listă</button>
        <button type="button" class="editor-tool notes-tool" id="concept-notes-add-link" title="Adaugă link">🔗</button>
        <button type="button" class="editor-tool notes-tool" data-notes-command="removeFormat">Tx</button>
      </div>
      <div id="concept-notes-editor" class="concept-notes-editor ${phase3Ready ? "" : "disabled"}" contenteditable="${phase3Ready ? "true" : "false"}" spellcheck="true" data-placeholder="Adaugă aici notițe, întrebări, corelații clinice sau lucruri de verificat…">${notesHtml}</div>
      <footer class="concept-editor-footer">
        <div class="help">Notițele au autosave separat și nu sunt suprascrise la regenerarea structurii.</div>
        <div class="concept-editor-actions">
          <button id="clear-concept-notes" class="btn btn-ghost btn-sm" type="button" ${phase3Ready ? "" : "disabled"}>Golește notițele</button>
          <button id="save-concept-notes-now" class="btn btn-primary btn-sm" type="button" ${phase3Ready ? "" : "disabled"}>Salvează notițele</button>
        </div>
      </footer>
    </section>

    <section class="knowledge-sources">
      <div class="section-head compact"><div><h3>Fragmente asociate</h3><p>${sourceChunks.length} segmente legate de acest concept.</p></div>
        <button id="open-concept-source" class="btn btn-ghost btn-sm" ${sourceChunks.length ? "" : "disabled"}>Deschide primul segment sursă</button>
      </div>
      ${sourceChunks.map((chunk) => `
        <article class="knowledge-source-card">
          <header>
            <strong>Segment ${chunk.position + 1}</strong>
            <span>${escapeHtml(pagesLabel(chunk.page_start, chunk.page_end))}</span>
          </header>
          <div class="knowledge-source-grid">
            <div><h4>Traducere</h4><pre>${escapeHtml(chunk.translated_text || "Acest segment nu este încă tradus.")}</pre></div>
            <details><summary>Text original</summary><pre>${escapeHtml(chunk.source_text || "")}</pre></details>
          </div>
        </article>`).join("") || '<div class="empty-state"><p>Conceptul nu are fragmente asociate.</p></div>'}
    </section>` : `
      <div class="empty-state knowledge-empty">
        ${setupMessage}
        <h3>${state.knowledgeSetupError ? "Activează schema pentru Fazele 1–3" : state.chapters.length ? "Nu există concepte în această selecție" : "Construiește structura cursului"}</h3>
        <p>${state.knowledgeSetupError ? "Traducerea existentă continuă să funcționeze; trebuie adăugate tabelele pentru capitole și coloanele editorului/notițelor." : state.chapters.length ? "Schimbă termenul de căutare sau regenerează structura." : "DeepSeek va analiza segmentele pe rând și va crea o navigare pe capitole și concepte."}</p>
        <button id="generate-knowledge-empty" class="btn btn-accent" ${state.knowledgeSetupError ? "disabled" : ""}>✦ Generează capitolele cu DeepSeek</button>
      </div>`;

  app.innerHTML = `
    <div class="app-shell">
      ${topbar({ editor: true })}
      <main class="container-wide">
        <section class="editor-header">
          <div>
            <div class="editor-title-line">
              <h1>${escapeHtml(project.title)}</h1>
              <span class="badge primary">Faza 3 · Notes & Highlights</span>
            </div>
            <div class="editor-subtitle">${state.chapters.length} capitole · ${state.concepts.length} concepte · editor, notițe și highlights cu autosave</div>
          </div>
          <div class="editor-actions">
            <button id="generate-knowledge" class="btn btn-accent btn-sm" ${state.knowledge.running || state.ai.running || state.knowledgeSetupError ? "disabled" : ""}>✦ ${state.chapters.length ? "Regenerează structura" : "Generează structura"}</button>
            <button id="project-settings" class="btn btn-ghost btn-sm">Setări</button>
            <button id="export-project" class="btn btn-ghost btn-sm">Exportă</button>
          </div>
        </section>
        ${projectViewTabs()}
        ${setupMessage && selected ? setupMessage : ""}
        <section class="knowledge-layout">
          <aside class="knowledge-sidebar">
            <div class="sidebar-search">
              <input id="knowledge-search" class="input" value="${escapeHtml(state.knowledgeSearch)}" placeholder="Caută capitole sau concepte…" />
            </div>
            <div class="knowledge-tree">${tree || '<div class="help" style="padding:16px">Nu există rezultate.</div>'}</div>
          </aside>
          <main class="knowledge-main">${conceptContent}</main>
        </section>
      </main>
    </div>`;

  attachTopbarListeners();
  attachProjectViewTabs();
  document.querySelector("#project-settings")?.addEventListener("click", showProjectSettingsModal);
  document.querySelector("#export-project")?.addEventListener("click", showExportModal);
  document.querySelector("#generate-knowledge")?.addEventListener("click", startKnowledgeGeneration);
  document.querySelector("#generate-knowledge-empty")?.addEventListener("click", startKnowledgeGeneration);

  if (!conceptSaveDebounced) {
    conceptSaveDebounced = debounce((conceptId) => persistConceptById(conceptId, { quiet: true }), 950);
  }
  if (!conceptNotesSaveDebounced) {
    conceptNotesSaveDebounced = debounce((conceptId) => persistConceptNotesById(conceptId, { quiet: true }), 1050);
  }

  document.querySelectorAll("[data-concept-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      await flushCurrentConcept();
      state.selectedConceptId = button.dataset.conceptId;
      conceptEditorSelection = null;
      conceptNotesSelection = null;
      renderEditor();
    });
  });

  document.querySelectorAll("[data-toggle-chapter]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.toggleChapter;
      if (state.collapsedChapters.has(id)) state.collapsedChapters.delete(id);
      else state.collapsedChapters.add(id);
      renderEditor();
    });
  });

  document.querySelector("#knowledge-search")?.addEventListener("input", (event) => {
    state.knowledgeSearch = event.target.value;
    const caret = event.target.selectionStart;
    renderEditor();
    const input = document.querySelector("#knowledge-search");
    input?.focus();
    input?.setSelectionRange(caret, caret);
  });

  const editor = document.querySelector("#concept-editor");
  if (editor && selected && phase2Ready) {
    const markDirty = () => {
      selected.content_edited = editor.innerHTML;
      selected._editorDirty = true;
      setConceptSaveState("Modificări nesalvate", "saving");
      const words = document.querySelector("#concept-word-count");
      if (words) words.textContent = `${conceptWordCount(editor.innerHTML)} cuvinte`;
      const counts = conceptHighlightCounts(editor.innerHTML);
      Object.entries(counts).forEach(([type, count]) => {
        const counter = document.querySelector(`#highlight-count-${type}`);
        if (counter) counter.textContent = String(count);
      });
      conceptSaveDebounced(selected.id);
    };

    editor.addEventListener("input", markDirty);
    editor.addEventListener("keyup", () => storeConceptEditorSelection(editor));
    editor.addEventListener("mouseup", () => storeConceptEditorSelection(editor));
    editor.addEventListener("focus", () => storeConceptEditorSelection(editor));

    document.querySelectorAll(".editor-tool").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
    });

    document.querySelectorAll("[data-editor-command]").forEach((button) => {
      button.addEventListener("click", () => runConceptEditorCommand(editor, button.dataset.editorCommand));
    });

    document.querySelectorAll("[data-editor-block]").forEach((button) => {
      button.addEventListener("click", () => runConceptEditorCommand(editor, "formatBlock", button.dataset.editorBlock));
    });

    document.querySelectorAll("[data-highlight-type]").forEach((button) => {
      button.addEventListener("click", () => applyConceptHighlight(editor, button.dataset.highlightType));
    });
    document.querySelector("#clear-concept-highlight")?.addEventListener("click", () => clearConceptHighlight(editor));

    document.querySelector("#concept-add-link")?.addEventListener("click", () => {
      const url = window.prompt("Introdu adresa linkului (https://… sau mailto:…):", "https://");
      if (!url) return;
      if (!/^(https?:|mailto:)/i.test(url.trim())) {
        toast("Linkul trebuie să înceapă cu https://, http:// sau mailto:.", "error");
        return;
      }
      runConceptEditorCommand(editor, "createLink", url.trim());
    });

    document.querySelector("#save-concept-now")?.addEventListener("click", async () => {
      selected.content_edited = editor.innerHTML;
      selected._editorDirty = true;
      conceptSaveDebounced.cancel?.();
      await persistConceptById(selected.id);
    });

    document.querySelector("#reset-concept-content")?.addEventListener("click", () => {
      if (!window.confirm("Înlocuiești versiunea editată cu textul extras din fragmentele sursă?")) return;
      editor.innerHTML = plainTextToConceptHtml(conceptOriginalText(selected, sourceChunks));
      conceptEditorSelection = null;
      markDirty();
      editor.focus();
    });

    document.querySelector("#copy-concept-text")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(editor.innerText || "");
        toast("Textul conceptului a fost copiat.", "success", 1800);
      } catch {
        toast("Browserul nu a permis accesul la clipboard.", "error");
      }
    });
  }

  const notesEditor = document.querySelector("#concept-notes-editor");
  if (notesEditor && selected && phase3Ready) {
    const markNotesDirty = () => {
      selected.personal_notes = notesEditor.innerHTML;
      selected._notesDirty = true;
      setConceptNotesSaveState("Modificări nesalvate", "saving");
      conceptNotesSaveDebounced(selected.id);
    };

    const storeNotesSelection = () => {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (notesEditor.contains(range.commonAncestorContainer)) conceptNotesSelection = range.cloneRange();
    };

    const runNotesCommand = (command, value = null) => {
      if (conceptNotesSelection) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(conceptNotesSelection);
      } else {
        notesEditor.focus();
      }
      document.execCommand(command, false, value);
      storeNotesSelection();
      notesEditor.dispatchEvent(new Event("input", { bubbles: true }));
    };

    notesEditor.addEventListener("input", markNotesDirty);
    notesEditor.addEventListener("keyup", storeNotesSelection);
    notesEditor.addEventListener("mouseup", storeNotesSelection);
    notesEditor.addEventListener("focus", storeNotesSelection);

    document.querySelectorAll(".notes-tool").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
    });
    document.querySelectorAll("[data-notes-command]").forEach((button) => {
      button.addEventListener("click", () => runNotesCommand(button.dataset.notesCommand));
    });
    document.querySelector("#concept-notes-add-link")?.addEventListener("click", () => {
      const url = window.prompt("Introdu adresa linkului (https://… sau mailto:…):", "https://");
      if (!url) return;
      if (!/^(https?:|mailto:)/i.test(url.trim())) {
        toast("Linkul trebuie să înceapă cu https://, http:// sau mailto:.", "error");
        return;
      }
      runNotesCommand("createLink", url.trim());
    });
    document.querySelector("#save-concept-notes-now")?.addEventListener("click", async () => {
      selected.personal_notes = notesEditor.innerHTML;
      selected._notesDirty = true;
      conceptNotesSaveDebounced.cancel?.();
      await persistConceptNotesById(selected.id);
    });
    document.querySelector("#clear-concept-notes")?.addEventListener("click", () => {
      if (!window.confirm("Ștergi toate notițele personale pentru acest concept?")) return;
      notesEditor.innerHTML = "";
      conceptNotesSelection = null;
      markNotesDirty();
      notesEditor.focus();
    });
  }

  document.querySelector("#open-concept-source")?.addEventListener("click", async () => {
    const firstChunk = sourceChunks[0];
    if (!firstChunk) return;
    await flushCurrentConcept();
    state.currentIndex = firstChunk.position;
    state.projectView = "translation";
    renderEditor();
  });
}

function renderEditor() {
  if (state.projectView === "chapters") renderKnowledgeView();
  else renderTranslationView();
}


function renderTranslationView() {
  const project = state.currentProject;
  const chunk = state.chunks[state.currentIndex];
  if (!project || !chunk) {
    app.innerHTML = `${topbar({ editor: true })}<main class="container"><div class="error-box">Proiectul nu conține segmente.</div></main>`;
    attachTopbarListeners();
    return;
  }

  const translatedCount = state.chunks.filter((item) => item.translated_text?.trim()).length;
  const approvedCount = state.chunks.filter((item) => item.status === "approved").length;
  const progress = percentage(translatedCount, state.chunks.length);
  const filteredChunks = state.chunks.filter((item) => {
    if (!state.chunkSearch) return true;
    const haystack = `${item.source_text} ${item.translated_text}`.toLocaleLowerCase("ro");
    return haystack.includes(state.chunkSearch.toLocaleLowerCase("ro"));
  });

  const sidebarItems = filteredChunks.map((item) => {
    const active = item.id === chunk.id;
    const snippet = item.source_text.replace(/\s+/g, " ").slice(0, 62);
    return `<button class="chunk-item ${active ? "active" : ""}" data-index="${item.position}">
      <span class="chunk-number">${item.position + 1}</span>
      <span class="chunk-label"><strong>${escapeHtml(snippet || "Segment fără text")}</strong><small>${escapeHtml(pagesLabel(item.page_start, item.page_end))}</small></span>
      <span class="status-dot ${item.status}" title="${CHUNK_STATUS[item.status] || item.status}"></span>
    </button>`;
  }).join("");

  const statusBadge = chunk.status === "approved"
    ? '<span class="badge success">✓ Aprobat</span>'
    : chunk.translated_text?.trim()
      ? '<span class="badge warning">Traducere neaprobată</span>'
      : '<span class="badge">Netradus</span>';

  app.innerHTML = `
    <div class="app-shell">
      ${topbar({ editor: true })}
      <main class="container-wide">
        <section class="editor-header">
          <div>
            <div class="editor-title-line">
              <h1>${escapeHtml(project.title)}</h1>
              ${statusBadge}
              <span class="badge primary">${progress}% tradus</span>
            </div>
            <div class="editor-subtitle">${escapeHtml(project.source_filename || "PDF")} · ${project.page_count || "?"} pagini · ${translatedCount}/${state.chunks.length} traduse · ${approvedCount} aprobate</div>
          </div>
          <div class="editor-actions">
            ${project.source_pdf_path ? '<button id="open-original" class="btn btn-ghost btn-sm">PDF original</button>' : ""}
            <button id="auto-translate-all" class="btn btn-accent btn-sm" ${state.ai.running ? "disabled" : ""}>✦ Traduce automat toate netraduse</button>
            <button id="project-settings" class="btn btn-ghost btn-sm">Setări proiect</button>
            <button id="export-project" class="btn btn-primary btn-sm">Exportă</button>
          </div>
        </section>

        ${projectViewTabs()}

        <section class="editor-grid">
          <aside class="chunk-sidebar">
            <div class="sidebar-head">
              <input id="chunk-search" class="input" value="${escapeHtml(state.chunkSearch)}" placeholder="Caută în segmente…" />
              <div class="progress-track"><div class="progress-bar" style="width:${progress}%"></div></div>
              <span class="help">${filteredChunks.length} din ${state.chunks.length} segmente</span>
            </div>
            <div class="sidebar-list">${sidebarItems || '<div class="help" style="padding:12px">Niciun rezultat.</div>'}</div>
          </aside>

          <div class="editor-main">
            <div class="editor-toolbar">
              <div class="toolbar-group">
                <button id="translate-current" class="btn btn-accent btn-sm" ${state.ai.running ? "disabled" : ""}>✦ Traduce segmentul</button>
                <button id="copy-prompt" class="btn btn-primary btn-sm">📋 Copiază prompt + segment</button>
                <button id="paste-translation" class="btn btn-ghost btn-sm">Lipește din clipboard</button>
                <button id="clear-translation" class="btn btn-ghost btn-sm">Golește</button>
              </div>
              <div class="toolbar-group">
                <span id="save-state" class="save-state saved">Salvat</span>
                <button id="toggle-approve" class="btn ${chunk.status === "approved" ? "btn-ghost" : "btn-accent"} btn-sm">${chunk.status === "approved" ? "Retrage aprobarea" : "Aprobă segmentul"}</button>
              </div>
            </div>

            <div class="translation-panels">
              <section class="editor-panel">
                <div class="panel-head"><strong>Sursă</strong><small>${escapeHtml(pagesLabel(chunk.page_start, chunk.page_end))} · ${chunk.source_text.length} caractere</small></div>
                <textarea id="source-text" class="code-editor readonly" readonly>${escapeHtml(chunk.source_text)}</textarea>
              </section>
              <section class="editor-panel">
                <div class="panel-head"><strong>Traducere Markdown</strong><small>${chunk.translated_text?.length || 0} caractere</small></div>
                <textarea id="translated-text" class="code-editor" placeholder="Traducerea DeepSeek va apărea aici automat; poți continua să o editezi manual…">${escapeHtml(chunk.translated_text || "")}</textarea>
              </section>
            </div>

            <div class="editor-nav">
              <button id="prev-chunk" class="btn btn-ghost" ${state.currentIndex === 0 ? "disabled" : ""}>← Înapoi</button>
              <div class="nav-center"><strong>Segment ${state.currentIndex + 1} / ${state.chunks.length}</strong><br />${escapeHtml(pagesLabel(chunk.page_start, chunk.page_end))}</div>
              <button id="next-chunk" class="btn btn-accent" ${state.currentIndex === state.chunks.length - 1 ? "disabled" : ""}>Salvează și următorul →</button>
            </div>
          </div>
        </section>
      </main>
    </div>`;

  attachTopbarListeners();
  attachProjectViewTabs();
  attachEditorListeners();
}

function setSaveState(label, className = "") {
  const element = document.querySelector("#save-state");
  if (!element) return;
  element.textContent = label;
  element.className = `save-state ${className}`;
}

async function persistCurrentChunk({ quiet = false } = {}) {
  const chunk = state.chunks[state.currentIndex];
  if (!chunk || !chunk._dirty) return;
  setSaveState("Se salvează…", "saving");

  try {
    const saved = await updateChunk(chunk.id, {
      translated_text: chunk.translated_text || "",
      status: chunk.status,
    });
    Object.assign(chunk, saved, { _dirty: false });
    setSaveState("Salvat", "saved");
    if (!quiet) toast("Segment salvat.", "success", 1800);
  } catch (error) {
    setSaveState("Eroare la salvare", "");
    toast(error.message || "Nu am putut salva segmentul.", "error");
    throw error;
  }
}

async function flushCurrentChunk() {
  saveDebounced?.cancel?.();
  if (state.currentProject) await persistCurrentChunk({ quiet: true });
}

async function goToChunk(index) {
  if (index < 0 || index >= state.chunks.length) return;
  await flushActiveEdits();
  state.currentIndex = index;
  renderEditor();
}

function attachEditorListeners() {
  const chunk = state.chunks[state.currentIndex];
  const textarea = document.querySelector("#translated-text");

  saveDebounced = debounce(() => persistCurrentChunk({ quiet: true }), 850);

  document.querySelector("#auto-translate-all")?.addEventListener("click", async () => {
    await startAutoTranslation({ onlyUntranslated: true });
  });

  document.querySelector("#translate-current")?.addEventListener("click", async () => {
    if (chunk.translated_text?.trim() && !window.confirm("Acest segment are deja o traducere. O înlocuiești cu o traducere nouă DeepSeek?")) return;
    await startAutoTranslation({ indices: [state.currentIndex], onlyUntranslated: false });
  });

  textarea?.addEventListener("input", () => {
    chunk.translated_text = textarea.value;
    if (chunk.status === "approved") chunk.status = "draft";
    else chunk.status = textarea.value.trim() ? "draft" : "pending";
    chunk._dirty = true;
    setSaveState("Modificări nesalvate", "saving");
    saveDebounced();
  });

  document.querySelector("#copy-prompt")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(buildCopyPrompt(state.currentProject, chunk));
      toast("Promptul și segmentul au fost copiate.", "success", 1800);
    } catch {
      toast("Clipboard-ul nu a putut fi accesat. Folosește HTTPS sau copiază manual textul sursă.", "error");
    }
  });

  document.querySelector("#paste-translation")?.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      textarea.value = text;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      toast("Textul din clipboard a fost lipit.", "success", 1800);
    } catch {
      toast("Browserul nu a permis citirea clipboard-ului. Folosește Ctrl+V în editor.", "error");
      textarea.focus();
    }
  });

  document.querySelector("#clear-translation")?.addEventListener("click", () => {
    if (!textarea.value || window.confirm("Golești traducerea acestui segment?")) {
      textarea.value = "";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  document.querySelector("#toggle-approve")?.addEventListener("click", async () => {
    if (chunk.status !== "approved" && !textarea.value.trim()) {
      toast("Lipește mai întâi traducerea.", "error");
      return;
    }
    chunk.translated_text = textarea.value;
    chunk.status = chunk.status === "approved" ? "draft" : "approved";
    chunk._dirty = true;
    await persistCurrentChunk({ quiet: true });
    renderEditor();
  });

  document.querySelector("#prev-chunk")?.addEventListener("click", () => goToChunk(state.currentIndex - 1));
  document.querySelector("#next-chunk")?.addEventListener("click", () => goToChunk(state.currentIndex + 1));

  document.querySelectorAll(".chunk-item").forEach((button) => {
    button.addEventListener("click", () => goToChunk(Number(button.dataset.index)));
  });

  document.querySelector("#chunk-search")?.addEventListener("input", (event) => {
    state.chunkSearch = event.target.value;
    const caret = event.target.selectionStart;
    renderEditor();
    const search = document.querySelector("#chunk-search");
    search?.focus();
    search?.setSelectionRange(caret, caret);
  });

  document.querySelector("#export-project")?.addEventListener("click", showExportModal);
  document.querySelector("#project-settings")?.addEventListener("click", showProjectSettingsModal);
  document.querySelector("#open-original")?.addEventListener("click", async () => {
    try {
      const url = await getOriginalPdfUrl(state.currentProject.source_pdf_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

function showExportModal() {
  const hasTranslations = state.chunks.some((chunk) => chunk.translated_text?.trim());
  showModal(`
    <div class="modal-head"><h3>Exportă proiectul</h3><button id="close-modal" class="btn btn-icon btn-ghost">×</button></div>
    <div class="modal-body form-grid">
      ${hasTranslations ? "" : '<div class="warning-box">Nu există încă segmente traduse. Backup-ul JSON poate fi exportat oricum.</div>'}
      <label class="checkbox-row"><input id="approved-only" type="checkbox" /><span>Include numai segmentele aprobate în documentul final.</span></label>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
        <button id="export-md" class="btn btn-ghost" ${hasTranslations ? "" : "disabled"}>Descarcă Markdown</button>
        <button id="export-html" class="btn btn-ghost" ${hasTranslations ? "" : "disabled"}>Descarcă HTML</button>
        <button id="print-pdf" class="btn btn-primary" ${hasTranslations ? "" : "disabled"}>Tipărește / Salvează PDF</button>
        <button id="export-json" class="btn btn-accent">Backup JSON complet</button>
      </div>
      <div class="info-box">Pentru PDF, browserul deschide versiunea formatată. Alege <strong>Print / Tipărire → Save as PDF</strong>. Este mai stabil pentru diacritice decât generarea PDF direct în JavaScript.</div>
    </div>`);

  document.querySelector("#close-modal")?.addEventListener("click", closeModal);
  const options = () => ({ approvedOnly: document.querySelector("#approved-only")?.checked });

  document.querySelector("#export-md")?.addEventListener("click", () => exportMarkdown(state.currentProject, state.chunks, options()));
  document.querySelector("#export-html")?.addEventListener("click", () => exportHtml(state.currentProject, state.chunks, options()));
  document.querySelector("#print-pdf")?.addEventListener("click", () => {
    try {
      openPrintView(state.currentProject, state.chunks, options());
    } catch (error) {
      toast(error.message, "error");
    }
  });
  document.querySelector("#export-json")?.addEventListener("click", () => exportBackup(state.currentProject, state.chunks));
}

function showProjectSettingsModal() {
  const project = state.currentProject;
  showModal(`
    <div class="modal-head"><h3>Setări proiect</h3><button id="close-modal" class="btn btn-icon btn-ghost">×</button></div>
    <form id="project-settings-form">
      <div class="modal-body form-grid">
        <div id="settings-message"></div>
        <div class="form-row"><label for="settings-title">Titlu</label><input id="settings-title" class="input" value="${escapeHtml(project.title)}" required /></div>
        <div class="form-row"><label for="settings-prompt">Prompt standard</label><textarea id="settings-prompt" class="textarea" style="min-height:240px">${escapeHtml(project.system_prompt || DEFAULT_SYSTEM_PROMPT)}</textarea></div>
        <label class="checkbox-row"><input id="project-completed" type="checkbox" ${project.status === "completed" ? "checked" : ""} /><span>Marchează proiectul ca finalizat.</span></label>
        <div class="warning-box">Schimbarea dimensiunii segmentelor după creare nu este automată, pentru a nu pierde traducerile existente.</div>
      </div>
      <div class="modal-footer">
        <button id="delete-current-project" class="btn btn-danger" type="button" style="margin-right:auto">Șterge proiectul</button>
        <button id="cancel-settings" class="btn btn-ghost" type="button">Renunță</button>
        <button id="save-settings" class="btn btn-primary" type="submit">Salvează</button>
      </div>
    </form>`);

  document.querySelector("#close-modal")?.addEventListener("click", closeModal);
  document.querySelector("#cancel-settings")?.addEventListener("click", closeModal);
  document.querySelector("#delete-current-project")?.addEventListener("click", async () => {
    closeModal();
    state.projects = await listProjects();
    await confirmDeleteProject(project.id);
  });

  document.querySelector("#project-settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector("#save-settings");
    const message = document.querySelector("#settings-message");
    setButtonLoading(button, true, "Se salvează…");
    try {
      const updated = await updateProject(project.id, {
        title: document.querySelector("#settings-title").value.trim(),
        system_prompt: document.querySelector("#settings-prompt").value.trim(),
        status: document.querySelector("#project-completed").checked ? "completed" : "pending",
      });
      state.currentProject = updated;
      closeModal();
      renderEditor();
      toast("Setările proiectului au fost salvate.", "success");
    } catch (error) {
      message.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
    } finally {
      setButtonLoading(button, false);
    }
  });
}

async function handleAuthenticatedSession(session) {
  state.session = session;
  if (!session) {
    state.projects = [];
    state.currentProject = null;
    state.chunks = [];
    state.chapters = [];
    state.concepts = [];
    state.projectView = "translation";
    state.selectedConceptId = null;
    state.knowledgeSetupError = null;
    renderAuth();
    return;
  }

  state.deepseek = loadDeepSeekSession();
  if (!state.deepseek) {
    renderDeepSeekGate(session);
    return;
  }

  const hashMatch = window.location.hash.match(/^#project=([a-f0-9-]+)$/i);
  if (hashMatch) await openProject(hashMatch[1]);
  else await loadDashboard();
}

async function initializeSupabaseConnection(connection) {
  authSubscription?.unsubscribe?.();
  authSubscription = null;
  initSupabase(connection);
  state.connection = connection;

  const { data } = onAuthChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      state.session = session;
      showUpdatePasswordModal();
      return;
    }
    if (event === "SIGNED_IN" && state.session?.user?.id === session?.user?.id) return;
    if (event === "TOKEN_REFRESHED") {
      state.session = session;
      return;
    }
    await handleAuthenticatedSession(session);
  });
  authSubscription = data?.subscription;
}

async function start() {
  ensureToastRegion();
  const savedConnection = loadSavedConnection();
  if (!savedConnection) {
    renderAuth();
    return;
  }

  try {
    await initializeSupabaseConnection(savedConnection);
    const session = await getSession();
    await handleAuthenticatedSession(session);
  } catch (error) {
    state.connection = savedConnection;
    renderAuth();
    toast(error.message || "Conexiunea Supabase nu a putut fi inițializată. Verifică datele și încearcă din nou.", "error");
  }
}

window.addEventListener("beforeunload", (event) => {
  saveDebounced?.cancel?.();
  conceptSaveDebounced?.cancel?.();
  const hasDirtyConcept = state.concepts.some((concept) => concept._editorDirty);
  if (state.ai.running || state.knowledge.running || hasDirtyConcept) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("hashchange", async () => {
  if (!state.session) return;
  const match = window.location.hash.match(/^#project=([a-f0-9-]+)$/i);
  if (match && state.currentProject?.id !== match[1]) await openProject(match[1]);
  if (!match && state.currentProject) {
    await flushActiveEdits();
    state.currentProject = null;
    await loadDashboard();
  }
});

start();
