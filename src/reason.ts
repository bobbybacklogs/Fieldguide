import type { CrawlResult } from "./crawl.js";
import type { HitchChat } from "./hitch.js";
import type { DocKind, ProjectModel } from "./types.js";
import { GENERATED_BANNER, README_MARKER } from "./types.js";

const EXCERPT_BUDGET = 24_000;
const PRIORITY_FILES = [
  "package.json",
  "metadata.json",
  "src/cli.ts",
  "src/index.ts",
  "src/generate.ts",
  "server.ts",
  "src/server.ts",
  ".env.example",
];

const DOC_KINDS: DocKind[] = ["readme", "map", "agent", "skill"];

export class ReasonParseError extends Error {
  readonly preview: string;
  constructor(message: string, preview: string) {
    super(message);
    this.name = "ReasonParseError";
    this.preview = preview;
  }
}

export interface ReasonedDocs {
  reasoning: string;
  docs: Partial<Record<DocKind, string>>;
  sourced?: Partial<Record<DocKind, "model" | "template">>;
}

export function slimInventory(model: ProjectModel): Record<string, unknown> {
  return {
    displayName: model.displayName,
    slug: model.slug,
    packageName: model.packageName,
    description: model.description,
    scripts: model.scripts,
    stack: model.stack.map((layer) => layer.label),
    routes: model.routes,
    envHits: model.envHits.map((hit) => hit.key),
    defaultVerify: model.defaultVerify.command,
  };
}

export function formatInventoryMarkdown(model: ProjectModel): string {
  const scripts = Object.entries(model.scripts)
    .slice(0, 12)
    .map(([name, command]) => `- ${name}: ${command}`)
    .join("\n");
  const routes = model.routes
    .slice(0, 20)
    .map((route) => `- ${route.method} ${route.path} (${route.file})`)
    .join("\n");
  const env = model.envHits
    .slice(0, 20)
    .map((hit) => `- ${hit.key}${hit.inExample ? " (in .env.example)" : ""}`)
    .join("\n");
  const stack = model.stack.map((layer) => layer.label).join(", ") || "unknown";
  return [
    `Project: ${model.displayName}`,
    `Package: ${model.packageName ?? "none"}`,
    `Slug: ${model.slug}`,
    `Description: ${model.description}`,
    `License: ${model.license ?? "unknown"}`,
    `Bin: ${model.binNames.join(", ") || "none"}`,
    `Stack: ${stack}`,
    `Verify: ${model.defaultVerify.command ?? "none"}`,
    `Layout: ${model.treeTop.join(", ")}`,
    "",
    "Scripts:",
    scripts || "- none",
    "",
    "HTTP routes in source:",
    routes || "- none",
    "",
    "Env keys:",
    env || "- none",
    "",
    "Integrations:",
    model.integrations.map((item) => `- ${item.label} [${item.grade}] ${item.evidence.join("; ")}`).join("\n") ||
      "- none",
  ].join("\n");
}

export function sourceExcerpts(sources: CrawlResult["sources"]): string {
  const preferred = PRIORITY_FILES.filter((rel) => sources.has(rel));
  const rest = [...sources.keys()]
    .filter((rel) => !preferred.includes(rel))
    .filter((rel) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/.test(rel))
    .filter((rel) => !rel.startsWith("test/") && !rel.includes(".test."));
  const ordered = [...preferred, ...rest];
  let used = 0;
  const chunks: string[] = [];
  for (const rel of ordered) {
    const body = sources.get(rel);
    if (!body) continue;
    const slice = body.length > 4_000 ? `${body.slice(0, 4_000)}\n/* truncated */` : body;
    if (used + slice.length > EXCERPT_BUDGET) break;
    chunks.push(`FILE ${rel}\n${slice}`);
    used += slice.length;
  }
  return chunks.join("\n\n");
}

export function parseReasonedDocs(raw: string): ReasonedDocs {
  const delimited = parseDelimited(raw);
  if (delimited) return finish(delimited);

  const fromJson = parseJsonDocs(raw);
  if (fromJson) return finish(fromJson);

  throw new ReasonParseError("Reply was not a complete Fieldguide document set.", snippet(raw));
}

export async function reasonDocs(
  model: ProjectModel,
  sources: CrawlResult["sources"],
  hitch: HitchChat,
): Promise<ReasonedDocs> {
  const inventory = formatInventoryMarkdown(model);
  const excerpts = sourceExcerpts(sources);
  const context = `${inventory}\n\nSource excerpts:\n${excerpts || "(none)"}`;

  let combined: ReasonedDocs | null = null;
  const first = await hitch.complete([
    { role: "system", content: COMBINED_SYSTEM },
    { role: "user", content: `${context}\n\nWrite all four documents using the <<<README>>> markers.` },
  ]);
  try {
    combined = parseReasonedDocs(first);
  } catch {
    combined = null;
  }

  const docs: Partial<Record<DocKind, string>> = { ...combined?.docs };
  const sourced: NonNullable<ReasonedDocs["sourced"]> = {};
  for (const kind of DOC_KINDS) {
    if (docs[kind]) sourced[kind] = "model";
  }

  let reasoning = combined?.reasoning?.trim() ?? "";
  if (!reasoning) {
    reasoning = await oneShot(
      hitch,
      "Write one short paragraph stating what this repository actually is today. Plain prose. No markdown headings. No JSON.",
      context,
    );
  }

  for (const kind of DOC_KINDS) {
    if (docs[kind]) continue;
    const drafted = await oneShot(hitch, docInstruction(kind, model), context);
    const extracted = extractMarkdownDocument(drafted, kind, model.slug);
    if (extracted) {
      docs[kind] = normalizeDoc(kind, extracted, model.slug);
      sourced[kind] = "model";
    }
  }

  return { reasoning: reasoning.trim(), docs, sourced };
}

export function extractMarkdownDocument(raw: string, kind: DocKind, slug: string): string | null {
  let text = raw.trim();
  if (!text) return null;

  const fenced = text.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
  if (fenced?.[1] && !text.includes("```json")) {
    text = fenced[1].trim();
  }

  if (text.startsWith("{") || text.includes('"readme"') || text.includes('"map"')) {
    const parsed = parseJsonDocs(text);
    const fromKind = parsed?.docs[kind];
    if (fromKind) text = fromKind;
  }

  const marked = section(text, markerName(kind));
  if (marked) text = marked;

  const start = text.search(/^(#{1,3} |---)/m);
  if (start > 0 && start < 600) text = text.slice(start).trim();

  text = text.trim();
  if (kind === "skill") text = ensureSkillFrontmatter(text, slug);
  if (kind === "map" && !/Feature Map/i.test(text) && /^#/m.test(text)) {
    text = `# Feature Map — project\n\n${text}`;
  }
  const looksLikeDoc = /^(#|---)/m.test(text) || /Feature Map/i.test(text);
  if (!looksLikeDoc) return null;
  return text;
}

export function bodyForKind(kind: DocKind, reasoned: ReasonedDocs | null, fallback: string): string {
  const fromModel = reasoned?.docs[kind];
  switch (kind) {
    case "readme":
    case "map":
    case "agent":
    case "skill":
      return fromModel ?? fallback;
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

const COMBINED_SYSTEM = `You write current-state project documentation.

Rules:
- Do not invent files, routes, scripts, or integrations.
- Output Markdown documents, never a JSON object.
- Use these markers, each once:

<<<REASONING>>>
short paragraph
<<<README>>>
markdown
<<<MAP>>>
markdown
<<<AGENT>>>
markdown
<<<SKILL>>>
markdown`;

async function oneShot(hitch: HitchChat, instruction: string, context: string): Promise<string> {
  return hitch.complete([
    {
      role: "system",
      content:
        "You write a single Markdown document. Output only Markdown (or a short prose paragraph when asked). Never wrap the answer in a JSON object. Never preface with Sure or Here is.",
    },
    { role: "user", content: `${context}\n\n${instruction}` },
  ]);
}

function docInstruction(kind: DocKind, model: ProjectModel): string {
  switch (kind) {
    case "readme":
      return `Write README.md for ${model.displayName}. First line: <!-- fieldguide:readme -->. Include purpose, install, commands from the inventory, layout, license. Markdown only.`;
    case "map":
      return `Write docs/FEATURE_MAP.md for ${model.displayName}. Title must include "Feature Map". Include evidence-grade table (Proven (verify), Code-inspected, Unverified (env-gated), Gap), naming, honest claims, out of scope. Markdown only.`;
    case "agent":
      return `Write AGENT.md for coding agents working on ${model.displayName}. Include docs of record, default verify command, layout, do-not-claim. Markdown only.`;
    case "skill":
      return `Write a verify skill. Start with YAML frontmatter:\n---\nname: verify-${model.slug}\ndescription: use this when verifying ${model.displayName} still matches its Feature Map\n---\nThen default no-secrets command, stage table, failure handling. Link ../../../docs/FEATURE_MAP.md. Markdown only.`;
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

function markerName(kind: DocKind): string {
  switch (kind) {
    case "readme":
      return "README";
    case "map":
      return "MAP";
    case "agent":
      return "AGENT";
    case "skill":
      return "SKILL";
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

function parseDelimited(raw: string): ReasonedDocs | null {
  const docs: Partial<Record<DocKind, string>> = {
    readme: section(raw, "README"),
    map: section(raw, "MAP"),
    agent: section(raw, "AGENT"),
    skill: section(raw, "SKILL"),
  };
  if (!docs.readme || !docs.map || !docs.agent || !docs.skill) return null;
  return { reasoning: section(raw, "REASONING") ?? "", docs };
}

function section(raw: string, name: string): string | undefined {
  const re = new RegExp(`<<<${name}>>>\\s*([\\s\\S]*?)(?=<<<[A-Z]+>>>|$)`, "i");
  const match = raw.match(re);
  const value = match?.[1]?.trim();
  return value || undefined;
}

function parseJsonDocs(raw: string): ReasonedDocs | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const docs: Partial<Record<DocKind, string>> = {};
  for (const kind of DOC_KINDS) {
    const value = parsed[kind];
    if (typeof value === "string" && value.trim()) docs[kind] = value;
  }
  if (!docs.readme || !docs.map || !docs.agent || !docs.skill) return null;
  const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "";
  return { reasoning, docs };
}

function extractJsonObject(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? raw.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

function finish(parsed: ReasonedDocs): ReasonedDocs {
  const docs: Partial<Record<DocKind, string>> = {};
  for (const kind of DOC_KINDS) {
    const value = parsed.docs[kind];
    if (value) docs[kind] = normalizeDoc(kind, value, "project");
  }
  if (!docs.map || !docs.agent || !docs.skill || !docs.readme) {
    throw new ReasonParseError("Parsed docs are missing readme, map, agent, or skill.", "");
  }
  return { reasoning: parsed.reasoning, docs };
}

function normalizeDoc(kind: DocKind, value: string, slug: string): string {
  let text = value.trim();
  if (text.startsWith("```") && text.endsWith("```")) {
    text = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  }
  switch (kind) {
    case "readme":
      if (!text.includes(README_MARKER)) text = `${README_MARKER}\n${text}`;
      return text;
    case "map":
      if (!text.includes("Generated by Fieldguide")) text = `${GENERATED_BANNER}\n\n${text}`;
      return text;
    case "skill":
      return ensureSkillFrontmatter(text, slug);
    case "agent":
      return text;
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

function ensureSkillFrontmatter(text: string, slug: string): string {
  if (/^---[\s\S]*name:\s*verify-/.test(text)) return text;
  return `---\nname: verify-${slug}\ndescription: "use this when verifying the project still matches its Feature Map"\n---\n\n${text}`;
}

function snippet(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 480);
}
