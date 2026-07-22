import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@5/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@5/build/pdf.worker.min.mjs";

function normalizePageText(items) {
  const lines = [];
  let currentLine = "";
  let lastY = null;

  for (const item of items) {
    if (!("str" in item)) continue;
    const text = item.str ?? "";
    const y = Array.isArray(item.transform) ? Math.round(item.transform[5]) : null;

    const startsNewLine =
      item.hasEOL ||
      (lastY !== null && y !== null && Math.abs(y - lastY) > 3);

    if (startsNewLine && currentLine.trim()) {
      lines.push(currentLine.trim());
      currentLine = "";
    }

    if (text) {
      const needsSpace = currentLine && !currentLine.endsWith(" ") && !/^[,.;:!?%)\]}]/.test(text);
      currentLine += `${needsSpace ? " " : ""}${text}`;
    }

    if (item.hasEOL && currentLine.trim()) {
      lines.push(currentLine.trim());
      currentLine = "";
    }

    if (y !== null) lastY = y;
  }

  if (currentLine.trim()) lines.push(currentLine.trim());

  return lines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdf(file, onProgress = () => {}) {
  if (!file || file.type !== "application/pdf") {
    throw new Error("Selectează un fișier PDF valid.");
  }

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent({ normalizeWhitespace: true });
    const text = normalizePageText(content.items);
    pages.push({ pageNumber, text });
    onProgress({ current: pageNumber, total: pdf.numPages });
  }

  const totalCharacters = pages.reduce((sum, page) => sum + page.text.length, 0);
  return {
    pageCount: pdf.numPages,
    pages,
    totalCharacters,
    likelyScanned: totalCharacters < Math.max(200, pdf.numPages * 40),
  };
}

function splitLargeParagraph(text, maxLength) {
  const parts = [];
  let remaining = text.trim();

  while (remaining.length > maxLength) {
    let splitAt = -1;
    const candidate = remaining.slice(0, maxLength + 1);

    const sentenceMatches = [...candidate.matchAll(/[.!?]\s+/g)];
    if (sentenceMatches.length) {
      const match = sentenceMatches.at(-1);
      splitAt = match.index + match[0].length;
    }

    if (splitAt < Math.floor(maxLength * 0.55)) {
      splitAt = candidate.lastIndexOf(" ");
    }

    if (splitAt < Math.floor(maxLength * 0.35)) {
      splitAt = maxLength;
    }

    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) parts.push(remaining);
  return parts;
}

export function buildChunks(pages, maxLength = 2500) {
  const safeLength = Math.min(12000, Math.max(500, Number(maxLength) || 2500));
  const units = [];

  for (const page of pages) {
    const paragraphs = page.text
      .split(/\n{2,}/)
      .map((value) => value.trim())
      .filter(Boolean);

    const sourceUnits = paragraphs.length ? paragraphs : [page.text.trim()].filter(Boolean);
    for (const paragraph of sourceUnits) {
      const splitParts = paragraph.length > safeLength
        ? splitLargeParagraph(paragraph, safeLength)
        : [paragraph];
      splitParts.forEach((text) => units.push({ page: page.pageNumber, text }));
    }
  }

  const chunks = [];
  let currentText = "";
  let pageStart = null;
  let pageEnd = null;

  const flush = () => {
    if (!currentText.trim()) return;
    chunks.push({
      text: currentText.trim(),
      pageStart,
      pageEnd,
    });
    currentText = "";
    pageStart = null;
    pageEnd = null;
  };

  for (const unit of units) {
    const separator = currentText ? "\n\n" : "";
    const projectedLength = currentText.length + separator.length + unit.text.length;

    if (currentText && projectedLength > safeLength) flush();

    if (!currentText) pageStart = unit.page;
    pageEnd = unit.page;
    currentText += `${currentText ? "\n\n" : ""}${unit.text}`;
  }

  flush();
  return chunks;
}
