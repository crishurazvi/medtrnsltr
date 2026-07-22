export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDateShort(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium" }).format(new Date(value));
}

export function debounce(fn, wait = 700) {
  let timeout;
  const debounced = (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(timeout);
  return debounced;
}

export function downloadText(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function sanitizeFilename(value = "document") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "document";
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function chunkArray(items, size = 100) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

export function percentage(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

export function pluralizeChunks(count) {
  return `${count} ${count === 1 ? "segment" : "segmente"}`;
}

export function pagesLabel(start, end) {
  if (!start) return "Pagini necunoscute";
  return start === end ? `Pagina ${start}` : `Paginile ${start}–${end}`;
}

export function setButtonLoading(button, loading, label = "Se procesează…") {
  if (!button) return;
  if (loading) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="loader"></span> ${label}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
  }
}
