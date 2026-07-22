import {
  addGlossaryEntry,
  createProject,
  deleteGlossaryEntry,
  deleteProject,
  getOriginalPdfUrl,
  getProject,
  getProjectChunks,
  getSession,
  importBackup,
  initSupabase,
  invokeDeepSeekTranslation,
  listGlossary,
  listProjects,
  onAuthChange,
  resetPassword,
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
      await flushCurrentChunk();
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
      await flushCurrentChunk();
      clearDeepSeekSession();
      state.deepseek = null;
      await signOut();
    } catch {
      state.session = null;
      renderAuth();
    }
  });

  document.querySelector("#back-dashboard")?.addEventListener("click", async () => {
    await flushCurrentChunk();
    state.currentProject = null;
    state.chunks = [];
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
    [state.currentProject, state.chunks, state.glossary] = await Promise.all([
      getProject(projectId),
      getProjectChunks(projectId),
      listGlossary(),
    ]);
    state.currentIndex = Math.max(0, state.chunks.findIndex((chunk) => chunk.status !== "approved"));
    if (state.currentIndex < 0) state.currentIndex = 0;
    state.chunkSearch = "";
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

  await flushCurrentChunk();

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

function renderEditor() {
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
  await flushCurrentChunk();
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
  if (state.ai.running) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("hashchange", async () => {
  if (!state.session) return;
  const match = window.location.hash.match(/^#project=([a-f0-9-]+)$/i);
  if (match && state.currentProject?.id !== match[1]) await openProject(match[1]);
  if (!match && state.currentProject) {
    await flushCurrentChunk();
    state.currentProject = null;
    await loadDashboard();
  }
});

start();
