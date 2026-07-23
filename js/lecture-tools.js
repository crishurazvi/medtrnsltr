function normalizeTitle(value) {
  return String(value || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*|__|~~|==|\*/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function slugify(value) {
  return normalizeTitle(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ro")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "sectiune";
}

export function fingerprintText(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}-${text.length}`;
}

function firstMeaningfulLine(markdown) {
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)]|>)\s*/, "").trim())
    .find(Boolean) || "Document";
}

/**
 * Construiește secțiuni persistabile exclusiv din traducerile Markdown.
 * Headerele Markdown pornesc secțiuni noi; fragmentele fără header continuă
 * secțiunea precedentă, astfel încât limitele artificiale dintre chunk-uri să
 * nu devină automat pagini noi.
 */
export function buildLectureSourceSections(chunks = []) {
  const sections = [];
  const keyCounts = new Map();
  let current = null;

  const makeKey = (title, prefix = "h") => {
    const base = `${prefix}:${slugify(title)}`;
    const occurrence = (keyCounts.get(base) || 0) + 1;
    keyCounts.set(base, occurrence);
    return `${base}:${occurrence}`;
  };

  const startSection = ({ title, level, markdown, chunkId, prefix = "h" }) => {
    current = {
      section_key: makeKey(title, prefix),
      position: sections.length,
      title: normalizeTitle(title) || "Secțiune fără titlu",
      heading_level: Number(level || 0),
      source_markdown: String(markdown || "").trim(),
      source_chunk_ids: chunkId ? [chunkId] : [],
    };
    sections.push(current);
  };

  const appendToCurrent = (markdown, chunkId) => {
    const text = String(markdown || "").trim();
    if (!text) return;
    if (!current) {
      startSection({
        title: firstMeaningfulLine(text).slice(0, 90) || "Document",
        level: 0,
        markdown: text,
        chunkId,
        prefix: "intro",
      });
      return;
    }
    current.source_markdown = `${current.source_markdown}\n\n${text}`.trim();
    if (chunkId && !current.source_chunk_ids.includes(chunkId)) current.source_chunk_ids.push(chunkId);
  };

  [...chunks]
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
    .forEach((chunk) => {
      const markdown = String(chunk.translated_text || "").replace(/\r\n?/g, "\n").trim();
      if (!markdown) return;

      const lines = markdown.split("\n");
      let buffer = [];
      let foundHeading = false;

      const flushContinuation = () => {
        const text = buffer.join("\n").trim();
        if (text) appendToCurrent(text, chunk.id);
        buffer = [];
      };

      lines.forEach((line) => {
        const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
        if (!heading) {
          buffer.push(line);
          return;
        }

        foundHeading = true;
        flushContinuation();
        const title = normalizeTitle(heading[2]) || `Secțiune ${sections.length + 1}`;
        startSection({
          title,
          level: heading[1].length,
          markdown: line,
          chunkId: chunk.id,
          prefix: `h${heading[1].length}`,
        });
      });

      const tail = buffer.join("\n").trim();
      if (tail) appendToCurrent(tail, chunk.id);
      if (!foundHeading && !current) appendToCurrent(markdown, chunk.id);
    });

  return sections.map((section, index) => ({
    ...section,
    position: index,
    source_fingerprint: fingerprintText(section.source_markdown),
  }));
}

export function lectureSectionsNeedSync(persisted = [], generated = []) {
  if (persisted.length !== generated.length) return true;
  const byKey = new Map(persisted.map((section) => [section.section_key, section]));
  return generated.some((section) => {
    const saved = byKey.get(section.section_key);
    return !saved
      || saved.source_fingerprint !== section.source_fingerprint
      || Number(saved.position) !== Number(section.position);
  });
}
