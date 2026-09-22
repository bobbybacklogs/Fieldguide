import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { crawl } from "./crawl.js";
import { renderAgent, renderReadme, readmeShouldWrite } from "./docs-readme-agent.js";
import { renderFeatureMap, renderSkill } from "./docs-map-skill.js";
import { createHitchChat } from "./hitch.js";
import { inferProject, outputPathFor } from "./infer.js";
import { bodyForKind, reasonDocs, type ReasonedDocs } from "./reason.js";
import type { DocKind, GenerateOptions, ProjectModel, WriteResult } from "./types.js";
import { readText } from "./util.js";

export async function analyze(root: string): Promise<ProjectModel> {
  const crawled = await crawl(root);
  return inferProject(root, crawled);
}

export function renderDoc(kind: DocKind, model: ProjectModel): string {
  switch (kind) {
    case "readme":
      return renderReadme(model);
    case "map":
      return renderFeatureMap(model);
    case "agent":
      return renderAgent(model);
    case "skill":
      return renderSkill(model);
    default: {
      const _never: never = kind;
      throw new Error(`Unhandled doc kind: ${_never}`);
    }
  }
}

export async function generateDocs(options: GenerateOptions): Promise<{
  model: ProjectModel;
  results: WriteResult[];
  reasoning?: string;
  lane?: { provider: string; model: string };
}> {
  const crawled = await crawl(options.root);
  const model = inferProject(options.root, crawled);
  const useLlm = options.llm !== false;
  let reasoned: ReasonedDocs | null = null;
  let lane: { provider: string; model: string } | undefined;

  if (useLlm) {
    const hitch =
      options.chat ??
      (await createHitchChat({
        provider: options.provider,
        model: options.model,
      }));
    lane = hitch.lane;
    reasoned = await reasonDocs(model, crawled.sources, hitch);
  }

  const results: WriteResult[] = [];

  for (const kind of options.kinds) {
    const rel = outputPathFor(kind, model);
    const abs = join(options.root, rel);
    const body = bodyForKind(kind, reasoned, renderDoc(kind, model));

    if (kind === "readme") {
      const existing = readText(abs);
      const gate = readmeShouldWrite(existing, options.force);
      if (!gate.ok) {
        results.push({ kind, rel, status: "skipped", reason: gate.reason });
        continue;
      }
    }

    if (options.dryRun) {
      results.push({ kind, rel, status: "dry-run", body });
      continue;
    }

    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, `${body.trim()}\n`, "utf8");
    results.push({ kind, rel, status: "wrote", body });
  }

  return { model, results, reasoning: reasoned?.reasoning, lane };
}

export const ALL_KINDS: DocKind[] = ["readme", "map", "agent", "skill"];

export function parseKinds(raw: string | undefined): DocKind[] {
  if (!raw) return [...ALL_KINDS];
  const parts = raw.split(",").map((part) => part.trim().toLowerCase());
  const kinds: DocKind[] = [];
  for (const part of parts) {
    if (part === "readme" || part === "map" || part === "agent" || part === "skill") {
      kinds.push(part);
      continue;
    }
    throw new Error(`Unknown --only value "${part}". Use readme,map,agent,skill.`);
  }
  return kinds;
}
