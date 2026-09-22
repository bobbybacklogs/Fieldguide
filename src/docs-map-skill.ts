import type { EvidenceGrade, ProjectModel } from "./types.js";
import { GENERATED_BANNER } from "./types.js";
import { installCommand, skillRelPath } from "./infer.js";
import { mdTable } from "./util.js";

export function renderFeatureMap(model: ProjectModel): string {
  const gradeRows = mdTable(
    ["Grade", "Meaning"],
    [
      ["**Proven (verify)**", "Asserted by the default verify path on a clean checkout with no secret env."],
      ["**Code-inspected**", "Present in source as of this map. Not exercised by the default verify path."],
      ["**Unverified (env-gated)**", "Requires credentials or a live third-party call. Do not treat as proven."],
      ["**Gap**", "Source or copy hints at the work, but the behavior is missing or incomplete. Copy is **not** proof of shipped behavior."],
    ],
  );

  const naming = mdTable(
    ["Surface", "String"],
    model.naming.map((row) => [row.surface, row.value]),
  );

  const verifyIntro = model.defaultVerify.command
    ? `Default verify path: \`${model.defaultVerify.command}\`. ${model.defaultVerify.notes.join(" ")}`
    : "No default verify path could be composed. Treat every claim as code-inspected or a gap until a verify script exists.";

  const sections = model.sections.map(renderSection).join("\n\n---\n\n");

  const outOfScope = collectOutOfScope(model);

  return `${GENERATED_BANNER}

# Feature Map — ${model.displayName}

${model.packageName ? `Package name: **${model.packageName}**. ` : ""}Repo / folder: **${model.folderName}**.

This map records what the product **actually does** today, what the default verify path **proves**, and what remains **env-gated or unfinished**. It is not a roadmap.

**Evidence grades**

${gradeRows}

${verifyIntro}

---

## Naming (as shipped)

${naming}

These names coexist in manifests and folders. The map uses **${model.displayName}** as the product name.

---

${sections}

---

## Explicitly out of scope / not shipped

Do **not** treat README copy, badges, or unused helpers as implemented unless a row above says so:

${outOfScope.map((item) => `- ${item}`).join("\n")}

Do not invent live integrations, proven model calls, or user flows that this map grades as code-inspected, env-gated, or a gap.

## How this map was produced

Fieldguide crawled this directory (gitignore-aware), read manifests and a capped set of source files, and inferred routes, env keys, scripts, and integrations. It does not execute the app. Re-run Fieldguide after material behavior changes, then tighten unverified rows with project-specific smoke checks.
`;
}

function renderSection(section: ProjectModel["sections"][number]): string {
  const rows = mdTable(
    ["Claim", "Grade", "Evidence"],
    section.claims.map((claim) => [escapeCell(claim.claim), claim.grade, escapeCell(claim.evidence)]),
  );
  const extra = section.mustNotClaim?.length
    ? `\n\n**Must still do / do not claim**\n\n${section.mustNotClaim.map((item) => `- ${item}`).join("\n")}`
    : "";
  const intro = section.intro ? `\n\n${section.intro}\n` : "\n";
  return `## ${section.title}${intro}\n${rows}${extra}`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function collectOutOfScope(model: ProjectModel): string[] {
  const items: string[] = [];
  for (const integration of model.integrations) {
    if (integration.grade === "Unverified (env-gated)") {
      items.push(`Live ${integration.label} — **code exists**; **unverified (env-gated)**.`);
    }
  }
  for (const env of model.envHits) {
    if (env.files.length && !env.inExample) {
      items.push(`\`${env.key}\` is referenced in source but missing from \`.env.example\`.`);
    }
  }
  if (!model.hasTests) items.push("A test suite — **not inferred**.");
  if (!model.scripts.verify) items.push("A dedicated `verify` script — **not present** (an inferred path may still exist).");
  for (const section of model.sections) {
    items.push(...(section.mustNotClaim ?? []));
  }
  if (!items.length) items.push("Nothing extra beyond the graded rows above.");
  return [...new Set(items)];
}

export function renderSkill(model: ProjectModel): string {
  const skillName = `verify-${model.slug}`;
  const mapRel = "../../../docs/FEATURE_MAP.md";
  const defaultCommand = model.defaultVerify.command ?? `${installCommand(model)}  # then add a verify script`;
  const stages = model.defaultVerify.stages.length
    ? mdTable(
        ["Step", "Command", "Expected exit", "What it proves", "Feature Map claims"],
        model.defaultVerify.stages.map((stage) => [
          stage.name,
          `\`${stage.command}\``,
          String(stage.expectedExit),
          escapeCell(stage.proves),
          escapeCell(stage.mapClaims),
        ]),
      )
    : "_No stages inferred. Add lint/test/build/verify scripts, then re-run Fieldguide._";

  const smoke = smokeCoverage(model);
  const gated = model.integrations
    .filter((item) => item.grade === "Unverified (env-gated)")
    .map((item) => `- Live ${item.label}${item.envKeys.length ? ` (${item.envKeys.map((k) => `\`${k}\``).join(", ")})` : ""}.`);

  const composed = model.defaultVerify.stages.map((stage) => stage.command).join(" && ");

  return `---
name: ${skillName}
description: "use this when verifying ${model.displayName} still matches its Feature Map"
---

# Verify ${model.displayName}

Use this skill to prove the checkout still matches [${mapRel}](${mapRel}). Do not treat README marketing copy, unused helpers, or env-example comments as shipped live behavior. Do not call live third-party APIs unless the user explicitly asked for an env-gated check.

Default path: **no secrets**. Expected exit: **0** on a clean checkout after \`${installCommand(model)}\`.

## Default command

${model.defaultVerify.command ? `\`\`\`bash\n${model.defaultVerify.command}\n\`\`\`\n` : "No `verify` script was found. Use the inferred stages below, then add a `verify` script so agents have one command.\n"}
${composed && model.defaultVerify.command && composed !== model.defaultVerify.command ? `This is:\n\n\`\`\`bash\n${composed}\n\`\`\`\n` : ""}
Run the stages separately only when isolating a failure. Do not skip lint, tests, or build and still claim the Feature Map is green.

${stages}

If \`node_modules\` is missing (Node projects): \`${installCommand(model)}\`${model.lockfileName ? ` (lockfile: \`${model.lockfileName}\`)` : ""}. Then re-run the default command.

## Smoke coverage

${smoke}

## Out of default scope (env-gated)

These Feature Map rows stay **Unverified (env-gated)** or **Gap** after a green default verify. Do not “fix” the map by claiming them.

${gated.length ? gated.join("\n") : "- No credentialed integrations were inferred. Still do not hit the network to 'make sure'."}

Do not run UI e2e (Playwright/Cypress) as part of this skill unless the Feature Map marks those checks **Proven (verify)**. Do not weaken docs to hide gaps.

## Failure handling

1. Restate the failed command and exit code.
2. Map the failure to a Feature Map row (missing script, typecheck, bundle, assertion, route drift, env-gate miss).
3. If product behavior drifted, update \`docs/FEATURE_MAP.md\` and this skill in the same change. Do not change app logic so verify passes.

## Cleanup

Leave no stray processes. If a smoke server was started, stop only the PID this skill started.
`;
}

function smokeCoverage(model: ProjectModel): string {
  const rows: string[][] = [];
  if (model.routes.length) {
    rows.push([
      "Route strings in source",
      `Source still contains: ${model.routes.slice(0, 8).map((route) => `\`${route.method} ${route.path}\``).join(", ")}.`,
      "HTTP / routes",
    ]);
  }
  if (model.scripts.lint || model.scripts.build || model.scripts.test || model.scripts.verify) {
    rows.push([
      "Gate inventory",
      `package.json scripts: ${Object.keys(model.scripts).join(", ") || "(none)"}.`,
      "Health / runtime",
    ]);
  }
  for (const integration of model.integrations) {
    rows.push([
      integration.label,
      `${integration.evidence.join("; ")}. Live calls stay env-gated.`,
      "Integrations",
    ]);
  }
  if (model.binNames.length) {
    rows.push([
      "CLI bin",
      `${model.binNames.map((name) => `\`${name}\``).join(", ")} present in package.json.`,
      "CLI",
    ]);
  }
  if (!rows.length) {
    return "No smoke assertions were inferred beyond running the default command. Add project-specific checks in `scripts/verify-smoke.ts` and re-run Fieldguide after they exist.";
  }
  return `The default verify path should stay deterministic. It must not require secret env vars (${model.envHits.map((h) => `\`${h.key}\``).slice(0, 8).join(", ") || "none inferred"}).\n\n${mdTable(["Check", "Proves", "Map section"], rows)}`;
}

export function gradeLabel(grade: EvidenceGrade): string {
  switch (grade) {
    case "Proven (verify)":
    case "Code-inspected":
    case "Unverified (env-gated)":
    case "Gap":
      return grade;
    default: {
      const _never: never = grade;
      return _never;
    }
  }
}
