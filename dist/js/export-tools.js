import { marked } from "https://cdn.jsdelivr.net/npm/marked@16/+esm";
import DOMPurify from "https://cdn.jsdelivr.net/npm/dompurify@3/+esm";
import { PCR_PRINT_STYLE } from "./constants.js";
import { downloadText, escapeHtml, sanitizeFilename } from "./utils.js";

export function buildCombinedMarkdown(project, chunks, { approvedOnly = false, includePageMarkers = true } = {}) {
  const selected = approvedOnly
    ? chunks.filter((chunk) => chunk.status === "approved" && chunk.translated_text?.trim())
    : chunks.filter((chunk) => chunk.translated_text?.trim());

  const body = selected.map((chunk) => {
    const marker = includePageMarkers && chunk.page_start
      ? `<!-- Pagini sursă: ${chunk.page_start}${chunk.page_end && chunk.page_end !== chunk.page_start ? `–${chunk.page_end}` : ""} -->\n\n`
      : "";
    return `${marker}${chunk.translated_text.trim()}`;
  }).join("\n\n");

  return `# ${project.title}\n\n${body}`.trim() + "\n";
}

export function exportMarkdown(project, chunks, options = {}) {
  const markdown = buildCombinedMarkdown(project, chunks, options);
  downloadText(`${sanitizeFilename(project.title)}.md`, markdown, "text/markdown;charset=utf-8");
}

export function exportBackup(project, chunks) {
  const backup = {
    format: "medtranslate-studio-backup",
    version: 1,
    exported_at: new Date().toISOString(),
    project: {
      title: project.title,
      source_filename: project.source_filename,
      page_count: project.page_count,
      chunk_size: project.chunk_size,
      system_prompt: project.system_prompt,
      status: project.status,
    },
    chunks: chunks.map((chunk) => ({
      position: chunk.position,
      page_start: chunk.page_start,
      page_end: chunk.page_end,
      source_text: chunk.source_text,
      translated_text: chunk.translated_text,
      status: chunk.status,
      notes: chunk.notes,
    })),
  };

  downloadText(
    `${sanitizeFilename(project.title)}_backup.json`,
    JSON.stringify(backup, null, 2),
    "application/json;charset=utf-8",
  );
}

export function buildHtmlDocument(project, chunks, { approvedOnly = false } = {}) {
  marked.setOptions({ gfm: true, breaks: false });
  const markdown = buildCombinedMarkdown(project, chunks, {
    approvedOnly,
    includePageMarkers: false,
  });
  const safeBody = DOMPurify.sanitize(marked.parse(markdown));

  return `<!doctype html>
<html lang="ro">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(project.title)}</title>
  <style>${PCR_PRINT_STYLE}</style>
</head>
<body>
  <div class="print-toolbar">
    <button onclick="window.print()">Tipărește / Salvează PDF</button>
    <button onclick="window.close()">Închide</button>
  </div>
  <div class="document-header">TRADUCERE MEDICALĂ · MEDTRANSLATE STUDIO</div>
  ${safeBody}
</body>
</html>`;
}

export function exportHtml(project, chunks, options = {}) {
  const html = buildHtmlDocument(project, chunks, options);
  downloadText(`${sanitizeFilename(project.title)}.html`, html, "text/html;charset=utf-8");
}

export function openPrintView(project, chunks, options = {}) {
  const html = buildHtmlDocument(project, chunks, options);
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    throw new Error("Browserul a blocat fereastra de tipărire. Permite ferestrele pop-up pentru acest site.");
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}
