import { README_MARKER } from "./types.js";
import type { ProjectModel } from "./types.js";
import { bullet, fence, mdTable } from "./util.js";
import { installCommand, outputPathFor, skillRelPath } from "./infer.js";

export function renderReadme(model: ProjectModel): string {
  const badges = buildBadges(model);
  const stack = model.stack.map((layer) => layer.label).join(" · ") || "Inferred stack unavailable";
  const usage = usageBlock(model);
  const tree = model.treeTop.slice(0, 16).map((item) => `    ${item}`).join("\n");
  const scripts = Object.entries(model.scripts)
    .slice(0, 8)
    .map(([name, command]) => `- \`${name}\` — \`${command}\``);
  const features = model.sections
    .filter((section) => section.id !== "identity")
    .slice(0, 6)
    .map((section) => {
      const proven = section.claims.some((claim) => claim.grade === "Proven (verify)");
      const suffix = proven ? " (covered by the default verify path)" : "";
      return `- **${section.title}**${suffix}`;
    });

  return `${README_MARKER}
# ${model.displayName}

${badges}

${model.description}

${stack}

## Quick start

${fence("bash", usage)}

## What this repo is

${model.displayName} is documented as a **current-state** product, not a roadmap. The files Fieldguide (or this checkout) treats as source of truth:

| Doc | Path | Role |
| --- | --- | --- |
| Feature Map | \`docs/FEATURE_MAP.md\` | What the product actually does today, with evidence grades |
| Agent instructions | \`AGENT.md\` | How to navigate, extend, and avoid over-claiming |
| Verify skill | \`${skillRelPath(model)}\` | How to prove the checkout still matches the map |

## Features (inferred)

${features.length ? features.join("\n") : "- Inventory only — no feature sections were inferred."}

## Commands

${scripts.length ? scripts.join("\n") : "- No package scripts were inferred."}

Install: \`${installCommand(model)}\`${model.lockfileName ? ` (lockfile: \`${model.lockfileName}\`)` : ""}.

## Layout

\`\`\`
${model.folderName}/
${tree}
\`\`\`

## Documentation contract

- **Proven (verify)** means a no-secrets verify path asserts it.
- **Code-inspected** means it exists in source and has not been exercised by default verify.
- **Unverified (env-gated)** means a live credentialed integration. Do not treat it as shipped-proven.
- **Gap** means copy, helpers, or filenames hint at work that is missing or incomplete. Copy is not proof.

See [${outputPathFor("map", model)}](${outputPathFor("map", model)}).

## License

${model.license ?? "License file not inferred."}
`;
}

function buildBadges(model: ProjectModel): string {
  const parts: string[] = [];
  if (model.packageName && !model.privatePackage) {
    const encoded = encodeURIComponent(model.packageName);
    parts.push(
      `[![npm](https://img.shields.io/npm/v/${encoded}.svg)](https://www.npmjs.com/package/${model.packageName})`,
    );
  }
  if (model.license) {
    parts.push(
      `[![License](https://img.shields.io/badge/license-${encodeURIComponent(model.license)}-blue.svg)](LICENSE)`,
    );
  }
  if (model.nodeEngine) {
    parts.push(
      `[![Node](https://img.shields.io/badge/node-${encodeURIComponent(model.nodeEngine)}-brightgreen.svg)](package.json)`,
    );
  }
  if (model.github) {
    parts.push(
      `[![CI](https://img.shields.io/github/actions/workflow/status/${model.github}/ci.yml?label=ci)](https://github.com/${model.github}/actions)`,
    );
    parts.push(`[![GitHub](https://img.shields.io/badge/github-${encodeURIComponent(model.github)}-111.svg)](https://github.com/${model.github})`);
  }
  if (!parts.length) {
    parts.push("![docs](https://img.shields.io/badge/docs-fieldguide-0f172a.svg)");
  }
  return parts.join(" ");
}

function usageBlock(model: ProjectModel): string {
  if (model.binNames[0] && model.packageName && !model.privatePackage) {
    return `npm install -g ${model.packageName}\n${model.binNames[0]} .\n\n# or\nnpx ${model.packageName}`;
  }
  if (model.scripts.dev) return `${installCommand(model)}\nnpm run dev`;
  if (model.scripts.start) return `${installCommand(model)}\nnpm start`;
  return `${installCommand(model)}`;
}

export function readmeShouldWrite(existing: string | null, force: boolean): { ok: boolean; reason?: string } {
  if (force || !existing) return { ok: true };
  if (existing.includes(README_MARKER)) return { ok: true };
  return { ok: false, reason: "README.md exists without a Fieldguide marker; pass --force to overwrite" };
}

export function renderAgent(model: ProjectModel): string {
  const verify = model.defaultVerify.command
    ? `\`${model.defaultVerify.command}\``
    : "no composed verify command — inspect the Feature Map before claiming health";
  const env = model.envHits.length
    ? bullet(model.envHits.slice(0, 20).map((hit) => `\`${hit.key}\`${hit.inExample ? "" : " (not in .env.example)"}`))
    : "- None inferred.";
  const doNot = uniqueMustNot(model);

  return `# AGENT.md — ${model.displayName}

Instructions for coding agents working in this repository.

## Product

**${model.displayName}**${model.packageName ? ` (\`${model.packageName}\`)` : ""}. ${model.description}

This file is **current-state**. Do not invent features from marketing copy, README badges, or unused helpers.

## Docs of record

1. [docs/FEATURE_MAP.md](docs/FEATURE_MAP.md) — claims, evidence grades, gaps.
2. [${skillRelPath(model)}](${skillRelPath(model)}) — how to prove the checkout still matches the map.
3. This file — navigation and constraints.

When product behavior drifts, update the Feature Map and the verify skill **in the same change**. Do not change app logic solely so verify passes. Do not weaken docs to hide gaps.

## Default verify

${verify}

${model.defaultVerify.notes.map((note) => `- ${note}`).join("\n")}

Do not call live third-party APIs unless the user explicitly asked for an env-gated check.

## Layout (inferred)

${bullet(model.treeTop)}

## Stack

${model.stack.length ? bullet(model.stack.map((layer) => `**${layer.label}** — ${layer.evidence.join(", ")}`)) : "- Unknown."}

## Environment

${env}

## Commands

${
    Object.keys(model.scripts).length
      ? mdTable(
          ["Script", "Command"],
          Object.entries(model.scripts).map(([key, command]) => [`\`${key}\``, `\`${command}\``]),
        )
      : "No package scripts inferred."
  }

## Do not claim

${doNot.length ? bullet(doNot) : "- Nothing extra; still do not treat UI copy as shipped behavior."}

## Extending the project

- Prefer the existing stack (${model.stack.map((s) => s.label).join(", ") || "inferred languages"}).
- Keep the default verify path free of secrets.
- New user-facing behavior needs a Feature Map row and, when it can be proven without credentials, a verify assertion.
`;
}

function uniqueMustNot(model: ProjectModel): string[] {
  const items = model.sections.flatMap((section) => section.mustNotClaim ?? []);
  return [...new Set(items)];
}
