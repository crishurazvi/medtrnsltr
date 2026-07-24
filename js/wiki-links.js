const WIKI_LINK_PATTERN = /\[\[([^\[\]\n]{1,500})\]\]/g;

export function normalizeWikiTitle(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ro")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseWikiReference(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;

  const pipeIndex = raw.indexOf("|");
  const targetPart = (pipeIndex >= 0 ? raw.slice(0, pipeIndex) : raw).trim();
  const alias = (pipeIndex >= 0 ? raw.slice(pipeIndex + 1) : "").trim();
  if (!targetPart) return null;

  const scopeIndex = targetPart.indexOf("::");
  const projectHint = (scopeIndex >= 0 ? targetPart.slice(0, scopeIndex) : "").trim();
  const targetTitle = (scopeIndex >= 0 ? targetPart.slice(scopeIndex + 2) : targetPart).trim();
  if (!targetTitle) return null;

  return {
    raw,
    targetTitle: targetTitle.slice(0, 300),
    projectHint: projectHint.slice(0, 300),
    displayText: (alias || targetTitle).slice(0, 300),
    normalizedTitle: normalizeWikiTitle(targetTitle),
    normalizedProjectHint: normalizeWikiTitle(projectHint),
  };
}

export function extractWikiLinksFromText(value) {
  const text = String(value || "");
  const links = [];
  const seen = new Set();
  WIKI_LINK_PATTERN.lastIndex = 0;

  let match;
  while ((match = WIKI_LINK_PATTERN.exec(text))) {
    const parsed = parseWikiReference(match[1]);
    if (!parsed) continue;
    const key = `${parsed.normalizedProjectHint}::${parsed.normalizedTitle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(parsed);
  }
  return links;
}

export function extractWikiLinksFromHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  return extractWikiLinksFromText(template.content.textContent || "");
}

function shouldSkipTextNode(node) {
  const parent = node.parentElement;
  return Boolean(parent?.closest("a, code, pre, textarea, script, style"));
}

export function decorateWikiLinksInHtml(html, { sourceProjectId = "" } = {}) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    if (!shouldSkipTextNode(walker.currentNode) && WIKI_LINK_PATTERN.test(walker.currentNode.textContent || "")) {
      nodes.push(walker.currentNode);
    }
    WIKI_LINK_PATTERN.lastIndex = 0;
  }

  nodes.forEach((textNode) => {
    const text = textNode.textContent || "";
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    WIKI_LINK_PATTERN.lastIndex = 0;
    let match;

    while ((match = WIKI_LINK_PATTERN.exec(text))) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      const parsed = parseWikiReference(match[1]);
      if (!parsed) {
        fragment.appendChild(document.createTextNode(match[0]));
      } else {
        const anchor = document.createElement("a");
        anchor.href = "#";
        anchor.className = "internal-wiki-link";
        anchor.dataset.wikiLink = "true";
        anchor.dataset.wikiTarget = parsed.targetTitle;
        anchor.dataset.wikiProjectHint = parsed.projectHint;
        anchor.dataset.wikiSourceProject = sourceProjectId || "";
        anchor.textContent = parsed.displayText;
        anchor.title = parsed.projectHint
          ? `Deschide ${parsed.targetTitle} din ${parsed.projectHint}`
          : `Deschide conceptul ${parsed.targetTitle}`;
        fragment.appendChild(anchor);
      }
      lastIndex = match.index + match[0].length;
    }
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    textNode.replaceWith(fragment);
  });

  return template.innerHTML;
}

export function serializeWikiLinksForRpc(links) {
  return (links || []).map((link) => ({
    target_title: String(link.targetTitle || "").slice(0, 300),
    project_hint: String(link.projectHint || "").slice(0, 300),
  }));
}
