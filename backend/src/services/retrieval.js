import { KnowledgeResource, Protocol } from "../models/index.js";

function terms(text = "") {
  return [...new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 4))].slice(0, 40);
}

export async function searchHospitalKnowledge({ hospitalId, query = "", protocolId = null, limit = 6 }) {
  const resources = await KnowledgeResource.find({ hospitalId, active: true }).lean();
  const protocol = protocolId ? await Protocol.findOne({ _id: protocolId, hospitalId, active: true }).lean() : null;
  const queryTerms = terms(query);

  const ranked = resources.map((resource) => {
    const haystack = `${resource.title} ${resource.content} ${(resource.tags || []).join(" ")}`.toLowerCase();
    const score = queryTerms.reduce((n, term) => n + (haystack.includes(term) ? 1 : 0), 0);
    return { ...resource, score };
  }).sort((a, b) => b.score - a.score || String(a.createdAt).localeCompare(String(b.createdAt)));

  const selected = ranked.filter((x) => x.score > 0).slice(0, limit);
  if (protocol) {
    selected.unshift({
      _id: protocol._id,
      title: protocol.name,
      content: protocol.sourceText || "",
      sourceReference: `Protocol ${protocol.name} v${protocol.version || "1.0"}`,
      score: 999,
    });
  }

  return selected.slice(0, limit + 1).map((x) => ({
    title: x.title,
    content: x.content,
    sourceReference: x.sourceReference || `KnowledgeResource:${x._id}`,
    score: x.score,
  }));
}
