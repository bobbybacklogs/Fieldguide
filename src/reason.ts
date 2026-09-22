import type { CrawlResult } from "./crawl.js";
import type { HitchChat } from "./hitch.js";
import type { DocKind, ProjectModel } from "./types.js";
import { GENERATED_BANNER, README_MARKER } from "./types.js";

const EXCERPT_BUDGET = 48_000;
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
    const slice = body.length > 8_000 ? `${body.slice(0, 8_000)}\n/* … truncated … */` : body;
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

${excerpts || "(no product source excerpts)"}`;
}

export const SYSTEM_PROMPT = `You are Fieldguide. You write CURRENT-STATE documentation for a software checkout.

The inventory JSON is the fact base. Source excerpts are supporting evidence. Do not invent features, routes, scripts, or vendor integrations that are not in the inventory or excerpts. Copy is not proof. Unused helpers are gaps.

Write four Markdown documents:

1. readme — professional product README with badges if package/license/github exist, quick start from real scripts, honest feature list, layout, license. First line MUST be exactly: <!-- fieldguide:readme -->
2. map — Feature Map titled "Feature Map — {displayName}". Include the evidence-grade table (Proven (verify), Code-inspected, Unverified (env-gated), Gap), naming table, sections with claim/grade/evidence tables, explicit out-of-scope. Not a roadmap.
3. agent — AGENT.md for coding agents: product, docs of record (docs/FEATURE_MAP.md and the verify skill path), default verify command, layout, do-not-claim, how to update the map when behavior drifts.
4. skill — YAML frontmatter with name: verify-{slug} and a description. Default no-secrets verify command. Stage table. Smoke coverage mapped to Feature Map rows. Out of default scope. Failure handling. Cleanup. Link the map as ../../../docs/FEATURE_MAP.md.

Return JSON only:
{"reasoning":"short chain of what the repo actually is","readme":"...","map":"...","agent":"...","skill":"..."}

reasoning is for yourself; the four docs are what get written.`;

export function parseReasonedDocs(raw: string): ReasonedDocs {
  const json = extractJsonObject(raw);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "";
  const docs: Partial<Record<DocKind, string>> = {};
  for (const kind of ["readme", "map", "agent", "skill"] as const) {
    const value = parsed[kind];
    if (typeof value === "string" && value.trim()) {
      docs[kind] = normalizeDoc(kind, value);
    }
  }
  if (!docs.map || !docs.agent || !docs.skill || !docs.readme) {
    throw new Error("ModelHitch JSON is missing one of readme, map, agent, skill.");
  }
  if (!docs.skill.includes("name: verify-")) {
    throw new Error("ModelHitch skill is missing YAML name: verify-<slug>.");
  }
  if (!docs.map.includes("Feature Map")) {
    throw new Error("ModelHitch map is missing a Feature Map heading.");
  }
  return { reasoning, docs };
}

export async function reasonDocs(
  model: ProjectModel,
  sources: CrawlResult["sources"],
  hitch: HitchChat,
): Promise<ReasonedDocs> {
  const user = buildReasonPrompt(model, sourceExcerpts(sources));
  const raw = await hitch.complete([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ]);
  return parseReasonedDocs(raw);
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

function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? raw.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("ModelHitch did not return a JSON object.");
  }
  return candidate.slice(start, end + 1);
}

function normalizeDoc(kind: DocKind, value: string): string {
  let text = value.trim();
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
