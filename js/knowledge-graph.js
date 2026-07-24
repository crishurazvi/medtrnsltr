import { normalizeWikiTitle } from "./wiki-links.js";

const VIS_CDN = "https://cdn.jsdelivr.net/npm/vis-network@10.1.0/standalone/umd/vis-network.min.js";
let visPromise;

export function ensureVisNetwork() {
  if (window.vis?.Network && window.vis?.DataSet) return Promise.resolve(window.vis);
  if (visPromise) return visPromise;
  visPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${VIS_CDN}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.vis), { once: true });
      existing.addEventListener("error", () => reject(new Error("Vis Network nu a putut fi încărcat.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = VIS_CDN;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.addEventListener("load", () => resolve(window.vis), { once: true });
    script.addEventListener("error", () => reject(new Error("Vis Network nu a putut fi încărcat de pe CDN.")), { once: true });
    document.head.appendChild(script);
  });
  return visPromise;
}

function resolveLinkTarget(link, concepts, projectsById) {
  if (link.target_concept_id && concepts.some((concept) => concept.id === link.target_concept_id)) {
    return link.target_concept_id;
  }
  const targetNormalized = normalizeWikiTitle(link.target_title);
  const hint = normalizeWikiTitle(link.target_project_hint);
  const matches = concepts.filter((concept) => {
    if (normalizeWikiTitle(concept.title) !== targetNormalized) return false;
    if (!hint) return true;
    return normalizeWikiTitle(projectsById.get(concept.project_id)?.title) === hint;
  });
  if (!matches.length) return null;
  const sameProject = matches.find((concept) => concept.project_id === link.source_project_id);
  return (sameProject || matches[0]).id;
}

export function buildGraphModel(graphData, {
  theme = "light",
  search = "",
  showChapters = true,
  showLecture = true,
} = {}) {
  const projects = graphData?.projects || [];
  const chapters = graphData?.chapters || [];
  const concepts = graphData?.concepts || [];
  const links = graphData?.links || [];
  const lectureSections = graphData?.lecture_sections || [];
  const projectsById = new Map(projects.map((item) => [item.id, item]));
  const chaptersById = new Map(chapters.map((item) => [item.id, item]));
  const conceptsById = new Map(concepts.map((item) => [item.id, item]));
  const lectureById = new Map(lectureSections.map((item) => [item.id, item]));
  const query = String(search || "").toLocaleLowerCase("ro").trim();

  const explicitEdges = [];
  const linkedConceptIds = new Set();
  const linkedLectureIds = new Set();
  const unresolved = new Map();

  links.forEach((link) => {
    const targetId = resolveLinkTarget(link, concepts, projectsById);
    const sourceNodeId = link.source_concept_id
      ? `concept:${link.source_concept_id}`
      : link.source_lecture_section_id
        ? `lecture:${link.source_lecture_section_id}`
        : null;
    if (!sourceNodeId) return;

    let targetNodeId;
    if (targetId) {
      targetNodeId = `concept:${targetId}`;
      linkedConceptIds.add(targetId);
    } else {
      const unresolvedKey = `${normalizeWikiTitle(link.target_project_hint)}::${normalizeWikiTitle(link.target_title)}`;
      targetNodeId = `unresolved:${unresolvedKey}`;
      unresolved.set(targetNodeId, {
        id: targetNodeId,
        label: link.target_title || "Legătură nerezolvată",
        type: "unresolved",
        projectHint: link.target_project_hint || "",
      });
    }

    if (link.source_concept_id) linkedConceptIds.add(link.source_concept_id);
    if (link.source_lecture_section_id) linkedLectureIds.add(link.source_lecture_section_id);
    explicitEdges.push({
      id: `link:${link.id}`,
      from: sourceNodeId,
      to: targetNodeId,
      arrows: "to",
      type: "wiki-link",
      title: `[[${link.target_project_hint ? `${link.target_project_hint}::` : ""}${link.target_title}]]`,
    });
  });

  const nodeMatches = (item, projectTitle = "") => !query || [
    item.title,
    item.summary,
    projectTitle,
    ...(item.tags || []),
  ].join(" ").toLocaleLowerCase("ro").includes(query);

  const visibleConceptIds = new Set(concepts
    .filter((concept) => nodeMatches(concept, projectsById.get(concept.project_id)?.title))
    .map((concept) => concept.id));
  if (!query) concepts.forEach((concept) => visibleConceptIds.add(concept.id));

  const visibleChapterIds = new Set(chapters
    .filter((chapter) => {
      if (!showChapters) return false;
      if (nodeMatches(chapter, projectsById.get(chapter.project_id)?.title)) return true;
      return concepts.some((concept) => concept.chapter_id === chapter.id && visibleConceptIds.has(concept.id));
    })
    .map((chapter) => chapter.id));

  const nodes = [];
  chapters.forEach((chapter) => {
    if (!visibleChapterIds.has(chapter.id)) return;
    nodes.push({
      id: `chapter:${chapter.id}`,
      label: chapter.title,
      title: `${projectsById.get(chapter.project_id)?.title || ""}\n${chapter.summary || ""}`,
      group: "chapter",
      type: "chapter",
      raw: chapter,
      project: projectsById.get(chapter.project_id) || null,
      shape: "box",
      margin: 12,
    });
  });

  concepts.forEach((concept) => {
    if (!visibleConceptIds.has(concept.id)) return;
    nodes.push({
      id: `concept:${concept.id}`,
      label: concept.title,
      title: `${projectsById.get(concept.project_id)?.title || ""}\n${concept.summary || ""}`,
      group: "concept",
      type: "concept",
      raw: concept,
      project: projectsById.get(concept.project_id) || null,
      chapter: chaptersById.get(concept.chapter_id) || null,
      shape: "dot",
      value: 2 + links.filter((link) => link.source_concept_id === concept.id || link.target_concept_id === concept.id).length,
    });
  });

  if (showLecture) {
    lectureSections.forEach((section) => {
      if (!linkedLectureIds.has(section.id)) return;
      if (query && !nodeMatches(section, projectsById.get(section.project_id)?.title)) return;
      nodes.push({
        id: `lecture:${section.id}`,
        label: section.title,
        title: `${projectsById.get(section.project_id)?.title || ""}\nSecțiune Lecture Mode`,
        group: "lecture",
        type: "lecture",
        raw: section,
        project: projectsById.get(section.project_id) || null,
        shape: "ellipse",
      });
    });
  }

  unresolved.forEach((node) => nodes.push({
    ...node,
    group: "unresolved",
    shape: "diamond",
    title: node.projectHint ? `Nerezolvat în proiectul ${node.projectHint}` : "Conceptul nu a fost găsit",
  }));

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = explicitEdges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  if (showChapters) {
    concepts.forEach((concept) => {
      const from = `chapter:${concept.chapter_id}`;
      const to = `concept:${concept.id}`;
      if (nodeIds.has(from) && nodeIds.has(to)) {
        edges.push({
          id: `contains:${concept.id}`,
          from,
          to,
          type: "contains",
          dashes: true,
          width: 1,
        });
      }
    });
  }

  return { nodes, edges, theme, projectsById, conceptsById, lectureById };
}

export function graphThemeOptions(theme = "light") {
  const dark = theme === "dark";
  return {
    groups: {
      chapter: {
        color: { background: dark ? "#173b46" : "#dff5f1", border: dark ? "#4cc9b7" : "#0f766e" },
        font: { color: dark ? "#e6fffb" : "#123f3a", size: 16, face: "Inter, system-ui, sans-serif", bold: true },
      },
      concept: {
        color: { background: dark ? "#263449" : "#e8efff", border: dark ? "#8ba9ff" : "#4f6fbd" },
        font: { color: dark ? "#eef3ff" : "#1e315f", size: 14, face: "Inter, system-ui, sans-serif" },
      },
      lecture: {
        color: { background: dark ? "#49391d" : "#fff3cf", border: dark ? "#f0b94b" : "#c88713" },
        font: { color: dark ? "#fff2c8" : "#5a3b00", size: 13 },
      },
      unresolved: {
        color: { background: dark ? "#4b2630" : "#ffe5e8", border: dark ? "#ff8795" : "#bd394b" },
        font: { color: dark ? "#ffe8ec" : "#6f1523", size: 12 },
      },
    },
    edges: {
      color: { color: dark ? "#718096" : "#9aa9bb", highlight: dark ? "#63d6c5" : "#0f766e" },
      font: { color: dark ? "#d5deea" : "#42526a", strokeWidth: 4, strokeColor: dark ? "#0f1720" : "#ffffff" },
      smooth: { enabled: true, type: "dynamic" },
    },
  };
}

export async function createKnowledgeGraph(container, graphData, options = {}) {
  const vis = await ensureVisNetwork();
  const model = buildGraphModel(graphData, options);
  const nodes = new vis.DataSet(model.nodes);
  const edges = new vis.DataSet(model.edges);
  const network = new vis.Network(container, { nodes, edges }, {
    autoResize: true,
    layout: { improvedLayout: true, randomSeed: 42 },
    interaction: {
      hover: true,
      navigationButtons: true,
      keyboard: { enabled: true, bindToWindow: false },
      tooltipDelay: 220,
    },
    physics: {
      enabled: true,
      solver: "forceAtlas2Based",
      stabilization: { enabled: true, iterations: 260, updateInterval: 30 },
      forceAtlas2Based: { gravitationalConstant: -55, centralGravity: 0.012, springLength: 115, springConstant: 0.075, avoidOverlap: 0.65 },
    },
    nodes: { borderWidth: 1.5, shadow: true, scaling: { min: 10, max: 28 } },
    ...graphThemeOptions(options.theme),
  });
  return { network, model, nodes, edges };
}

export function updateKnowledgeGraphTheme(network, theme) {
  network?.setOptions(graphThemeOptions(theme));
  network?.redraw();
}
