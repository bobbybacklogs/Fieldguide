import type { CrawlResult } from "./crawl.js";
import type { HitchChat } from "./hitch.js";
import type { DocKind, ProjectModel } from "./types.js";
import { GENERATED_BANNER, README_MARKER } from "./types.js";

const EXCERPT_BUDGET = 36_000;
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
}

export function slimInventory(model: ProjectModel): Record<string, unknown> {
  return {
    displayName: model.displayName,
    slug: model.slug,
    packageName: model.packageName,
    description: model.description,
    version: model.version,
    license: model.license,
    github: model.github,
    binNames: model.binNames,
    packageManager: model.packageManager,
    scripts: model.scripts,
    stack: model.stack,
    treeTop: model.treeTop,
    sourceFiles: model.sourceFiles.slice(0, 80),
    routes: model.routes,
    envHits: model.envHits,
    integrations: model.integrations,
    naming: model.naming,
    defaultVerify: model.defaultVerify,
    sections: model.sections,
    hasTests: model.hasTests,
    testFiles: model.testFiles.slice(0, 20),
    ciFiles: model.ciFiles,
  };
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
    const slice = body.length > 6_000 ? `${body.slice(0, 6_000)}\n/* … truncated … */` : body;
    if (used + slice.length > EXCERPT_BUDGET) break;
    chunks.push(`--- ${rel} ---\n${slice}`);
    used += slice.length;
  }
  return chunks.join("\n\n");
}

export function buildReasonPrompt(model: ProjectModel, excerpts: string): string {
  return `Inventory (ground truth — do not invent files, routes, scripts, or env keys that are not here):

${JSON.stringify(slimInventory(model), null, 2)}

Source excerpts:

${excerpts || "(no product source excerpts)"}

Write the four documents now using the marker format from the system instructions.`;
}

export const SYSTEM_PROMPT = `You are Fieldguide. You write CURRENT-STATE documentation for a software checkout.

The inventory JSON is the fact base. Source excerpts are supporting evidence. Do not invent features, routes, scripts, or vendor integrations that are not in the inventory or excerpts. Copy is not proof. Unused helpers are gaps.

Write four Markdown documents:

1. README — professional product README with badges if package/license/github exist, quick start from real scripts, honest feature list, layout, license. First line MUST be exactly: <!-- fieldguide:readme -->
2. MAP — Feature Map titled "Feature Map — {displayName}". Include the evidence-grade table (Proven (verify), Code-inspected, Unverified (env-gated), Gap), naming table, sections with claim/grade/evidence tables, explicit out-of-scope. Not a roadmap.
3. AGENT — AGENT.md for coding agents: product, docs of record (docs/FEATURE_MAP.md and the verify skill path), default verify command, layout, do-not-claim, how to update the map when behavior drifts.
4. SKILL — YAML frontmatter with name: verify-{slug} and a description. Default no-secrets verify command. Stage table. Smoke coverage mapped to Feature Map rows. Out of default scope. Failure handling. Cleanup. Link the map as ../../../docs/FEATURE_MAP.md.

Reply with this exact marker format (plain text, not JSON, not a single code fence wrapping everything):

<<<REASONING>>>
one short paragraph of what the repo actually is
<<<README>>>
markdown
<<<MAP>>>
markdown
<<<AGENT>>>
markdown
<<<SKILL>>>
markdown

Do not omit markers. Do not put the documents inside a JSON object.`;

const RETRY_PROMPT = `Your previous reply could not be parsed. Reply again with ONLY this marker format and no JSON:

<<<REASONING>>>
...
<<<README>>>
...
<<<MAP>>>
...
<<<AGENT>>>
...
<<<SKILL>>>
...`;

export function parseReasonedDocs(raw: string): ReasonedDocs {
  const delimited = parseDelimited(raw);
  if (delimited) return finish(delimited);

  const fromJson = parseJsonDocs(raw);
  if (fromJson) return finish(fromJson);

  throw new ReasonParseError(
    "ModelHitch reply was not parseable as Fieldguide markers or JSON.",
    snippet(raw),
  );
}

export async function reasonDocs(
  model: ProjectModel,
  sources: CrawlResult["sources"],
  hitch: HitchChat,
): Promise<ReasonedDocs> {
  const user = buildReasonPrompt(model, sourceExcerpts(sources));
  const firstMessages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: user },
  ];
  const first = await hitch.complete(firstMessages);
  try {
    return parseReasonedDocs(first);
  } catch (error) {
    const second = await hitch.complete([
      ...firstMessages,
      { role: "assistant", content: first },
      { role: "user", content: RETRY_PROMPT },
    ]);
    try {
      return parseReasonedDocs(second);
    } catch {
      const preview = error instanceof ReasonParseError ? error.preview : snippet(first);
      throw new ReasonParseError(
        "ModelHitch did not return parseable docs after a retry. Try a stronger model, or pass --no-llm for inventory templates.",
        preview,
      );
    }
  }
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

function parseDelimited(raw: string): ReasonedDocs | null {
  const reasoning = section(raw, "REASONING");
  const docs: Partial<Record<DocKind, string>> = {
    readme: section(raw, "README"),
    map: section(raw, "MAP"),
    agent: section(raw, "AGENT"),
    skill: section(raw, "SKILL"),
  };
  if (!docs.readme || !docs.map || !docs.agent || !docs.skill) return null;
  return { reasoning: reasoning ?? "", docs };
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
    if (value) docs[kind] = normalizeDoc(kind, value);
  }
  if (!docs.map || !docs.agent || !docs.skill || !docs.readme) {
    throw new ReasonParseError("Parsed docs are missing readme, map, agent, or skill.", "");
  }
  if (!docs.skill.includes("name: verify-")) {
    throw new ReasonParseError("Skill is missing YAML name: verify-<slug>.", snippet(docs.skill));
  }
  if (!docs.map.includes("Feature Map")) {
    throw new ReasonParseError("Map is missing a Feature Map heading.", snippet(docs.map));
  }
  return { reasoning: parsed.reasoning, docs };
}

function normalizeDoc(kind: DocKind, value: string): string {
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
    case "agent":
    case "skill":
      return text;
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

function snippet(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 480);
}
