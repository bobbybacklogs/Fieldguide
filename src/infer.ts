import { basename } from "node:path";
import type { CrawlResult } from "./crawl.js";
import type {
  DocKind,
  EvidenceGrade,
  FeatureSection,
  Integration,
  NamingRow,
  PackageManager,
  ProjectModel,
  RouteHit,
  StackLayer,
  VerifyPlan,
  VerifyStage,
} from "./types.js";
import {
  detectGithub,
  fileExists,
  parseJsonObject,
  recordKeys,
  slugify,
  stringField,
  stringRecord,
  titleFromSlug,
  unique,
} from "./util.js";

const ENV_RE = /\b(?:process\.env|Deno\.env(?:\.get)?|os\.environ(?:\.get)?|ENV)\[["']([A-Z][A-Z0-9_]+)["']\]/g;
const ENV_DOT_RE = /\bprocess\.env\.([A-Z][A-Z0-9_]+)/g;
const ENV_EXAMPLE_RE = /^([A-Z][A-Z0-9_]+)=/gm;

const ROUTE_PATTERNS: Array<{ re: RegExp; methodFrom?: "g1"; pathFrom: "g1" | "g2" }> = [
  { re: /\b(?:app|router|server)\.(get|post|put|patch|delete|options|head|all)\(\s*["'`]([^"'`]+)["'`]/gi, methodFrom: "g1", pathFrom: "g2" },
  { re: /@(?:app|router)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi, methodFrom: "g1", pathFrom: "g2" },
  { re: /@(?:Get|Post|Put|Patch|Delete|GET|POST)\(\s*["'`]([^"'`]+)["'`]/g, pathFrom: "g1" },
  { re: /\.route\(\s*["'`]([^"'`]+)["'`]/g, pathFrom: "g1" },
];

const INTEGRATIONS: Array<{
  id: string;
  label: string;
  packages?: string[];
  env?: string[];
  needles?: string[];
}> = [
  { id: "firebase", label: "Firebase", packages: ["firebase", "firebase-admin"], env: ["FIREBASE_API_KEY", "FIREBASE_PROJECT_ID"], needles: ["initializeApp", "signInWithPopup"] },
  { id: "stripe", label: "Stripe", packages: ["stripe"], env: ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY"] },
  { id: "openai", label: "OpenAI", packages: ["openai"], env: ["OPENAI_API_KEY"] },
  { id: "anthropic", label: "Anthropic", packages: ["@anthropic-ai/sdk"], env: ["ANTHROPIC_API_KEY"] },
  { id: "gemini", label: "Google Gemini", packages: ["@google/genai", "@google/generative-ai"], env: ["GEMINI_API_KEY", "GOOGLE_API_KEY"] },
  { id: "supabase", label: "Supabase", packages: ["@supabase/supabase-js"], env: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] },
  { id: "clerk", label: "Clerk", packages: ["@clerk/nextjs", "@clerk/clerk-sdk-node"], env: ["CLERK_SECRET_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"] },
  { id: "vercel-ai", label: "Vercel AI SDK", packages: ["ai", "@ai-sdk/openai"] },
  { id: "express", label: "Express", packages: ["express"] },
  { id: "next", label: "Next.js", packages: ["next"] },
  { id: "vite", label: "Vite", packages: ["vite"] },
  { id: "react", label: "React", packages: ["react"] },
];

const TEST_HINTS = [".test.", ".spec.", "/test/", "/tests/", "/__tests__/", "vitest", "jest"];

export function inferProject(root: string, crawl: CrawlResult): ProjectModel {
  const pkg = parseJsonObject(crawl.sources.get("package.json") ?? "") ?? null;
  const metadata = parseJsonObject(crawl.sources.get("metadata.json") ?? "") ?? null;
  const folderName = basename(root);
  const packageName = stringField(pkg, "name");
  const displayName =
    stringField(metadata, "name") ??
    (packageName ? titleFromSlug(packageName) : titleFromSlug(folderName));
  const slug = slugify(packageName ?? folderName);
  const description =
    stringField(pkg, "description") ??
    stringField(metadata, "description") ??
    firstReadmeSentence(crawl.sources.get("README.md") ?? "") ??
    "Inferred project — Fieldguide could not find a package description.";

  const scripts = stringRecord(pkg?.scripts);
  const dependencies = recordKeys(pkg?.dependencies);
  const devDependencies = recordKeys(pkg?.devDependencies);
  const allDeps = unique([...dependencies, ...devDependencies]);
  const bin = stringRecord(pkg?.bin);
  const binNames = Object.keys(bin).length ? Object.keys(bin) : pkg?.bin && typeof pkg.bin === "string" ? [packageName ?? slug] : [];

  const engines = pkg?.engines && typeof pkg.engines === "object" ? (pkg.engines as Record<string, unknown>) : null;
  const nodeEngine = typeof engines?.node === "string" ? engines.node : null;

  const packageManager = detectPackageManager(root, crawl.files.map((f) => f.rel));
  const github = detectGithub(root);
  const sourceFiles = [...crawl.sources.keys()].filter((rel) => isProductSource(rel));
  const routes = findRoutes(crawl.sources);
  const envHits = findEnv(crawl.sources);
  const stack = inferStack({
    pkg,
    allDeps,
    files: crawl.files.map((f) => f.rel),
    binNames,
    crawl,
  });
  const integrations = inferIntegrations(allDeps, envHits, crawl.sources);
  const testFiles = crawl.files
    .map((f) => f.rel)
    .filter((rel) => TEST_HINTS.some((hint) => rel.toLowerCase().includes(hint)));
  const ciFiles = crawl.files
    .map((f) => f.rel)
    .filter((rel) => rel.startsWith(".github/workflows/") || rel === ".gitlab-ci.yml" || rel === "Jenkinsfile");
  const lock = detectLockfile(crawl.files.map((f) => f.rel), root);
  const existingDocs = crawl.files
    .map((f) => f.rel)
    .filter((rel) =>
      /^(readme\.md|agent\.md|agents\.md|docs\/feature_map\.md)$/i.test(rel) ||
      rel.startsWith(".agents/skills/"),
    );
  const naming = buildNaming({
    displayName,
    packageName,
    folderName,
    metadataName: stringField(metadata, "name"),
    binNames,
  });
  const defaultVerify = buildVerifyPlan({
    packageManager,
    scripts,
    hasTests: testFiles.length > 0,
    hasLint: Boolean(scripts.lint),
    hasBuild: Boolean(scripts.build),
  });
  const sections = buildSections({
    displayName,
    stack,
    scripts,
    routes,
    envHits,
    integrations,
    defaultVerify,
    binNames,
    hasTests: testFiles.length > 0,
    testFiles,
    ciFiles,
    sourceFiles,
    packageManager,
    allDeps,
  });

  return {
    root,
    folderName,
    slug,
    packageName,
    displayName,
    description,
    version: stringField(pkg, "version"),
    license: stringField(pkg, "license"),
    privatePackage: pkg?.private === true,
    packageManager,
    github,
    nodeEngine,
    binNames,
    scripts,
    dependencies,
    devDependencies,
    stack,
    files: crawl.files,
    treeTop: summarizeTree(crawl.files.map((f) => f.rel)),
    sourceFiles,
    routes,
    envHits,
    integrations,
    hasLockfile: Boolean(lock),
    lockfileName: lock,
    hasCi: ciFiles.length > 0,
    ciFiles,
    hasTests: testFiles.length > 0,
    testFiles,
    existingDocs,
    naming,
    sections,
    defaultVerify,
  };
}

function firstReadmeSentence(readme: string): string | null {
  const line = readme
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("#") && !item.startsWith("!") && !item.startsWith("[") && !item.startsWith("<"));
  if (!line) return null;
  return line.replace(/^>\s*/, "").slice(0, 240);
}

function detectPackageManager(root: string, files: string[]): PackageManager {
  if (files.includes("pnpm-lock.yaml") || fileExists(root, "pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock") || fileExists(root, "yarn.lock")) return "yarn";
  if (files.includes("bun.lock") || files.includes("bun.lockb") || fileExists(root, "bun.lock")) return "bun";
  if (files.includes("package-lock.json") || fileExists(root, "package-lock.json")) return "npm";
  if (files.includes("package.json")) return "npm";
  return "unknown";
}

function detectLockfile(files: string[], root: string): string | null {
  const names = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "Cargo.lock", "poetry.lock", "go.sum"];
  for (const name of names) {
    if (files.includes(name) || fileExists(root, name)) return name;
  }
  return null;
}

function isAppSource(rel: string): boolean {
  if (rel.startsWith("node_modules/") || rel.startsWith("dist/")) return false;
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|vue|svelte)$/.test(rel);
}

function isProductSource(rel: string): boolean {
  const lower = rel.toLowerCase();
  if (!isAppSource(lower) && !/server\.(ts|js|mjs|cjs)$/.test(lower)) return false;
  if (lower.startsWith("test/") || lower.startsWith("tests/") || lower.includes("/__tests__/")) return false;
  if (lower.includes(".test.") || lower.includes(".spec.")) return false;
  if (lower.startsWith("scripts/")) return false;
  if (lower.startsWith("docs/")) return false;
  return true;
}

function findRoutes(sources: Map<string, string>): RouteHit[] {
  const hits: RouteHit[] = [];
  for (const [file, text] of sources) {
    if (!isProductSource(file)) continue;
    for (const pattern of ROUTE_PATTERNS) {
      pattern.re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.re.exec(text))) {
        const method = pattern.methodFrom === "g1" ? (match[1] ?? "ANY").toUpperCase() : guessMethod(match[0]);
        const path = pattern.pathFrom === "g2" ? (match[2] ?? "") : (match[1] ?? "");
        if (!path.startsWith("/") && !path.startsWith("http")) continue;
        hits.push({ method, path, file });
      }
    }
    const appRoute = file.match(/app\/api\/(.+)\/route\.(ts|js)$/);
    if (appRoute?.[1]) {
      hits.push({ method: "ROUTE", path: `/api/${appRoute[1].replace(/\/index$/, "")}`, file });
    }
  }
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = `${hit.method} ${hit.path} ${hit.file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 80);
}

function guessMethod(raw: string): string {
  const found = raw.match(/\b(GET|POST|PUT|PATCH|DELETE|get|post|put|patch|delete)\b/);
  return found ? found[1]!.toUpperCase() : "ANY";
}

function findEnv(sources: Map<string, string>): ProjectModel["envHits"] {
  const map = new Map<string, Set<string>>();
  const exampleKeys = new Set<string>();
  for (const [file, text] of sources) {
    const isExample = file.endsWith(".env.example") || file.endsWith(".env.sample");
    if (!isExample && !isProductSource(file)) continue;
    if (isExample) {
      ENV_EXAMPLE_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = ENV_EXAMPLE_RE.exec(text))) {
        exampleKeys.add(match[1]!);
      }
    }
    for (const re of [ENV_RE, ENV_DOT_RE]) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text))) {
        const key = match[1]!;
        if (!map.has(key)) map.set(key, new Set());
        map.get(key)!.add(file);
      }
    }
  }
  const keys = unique([...map.keys(), ...exampleKeys]).sort();
  return keys.map((key) => ({
    key,
    files: [...(map.get(key) ?? [])],
    inExample: exampleKeys.has(key),
  }));
}

function inferStack(input: {
  pkg: Record<string, unknown> | null;
  allDeps: string[];
  files: string[];
  binNames: string[];
  crawl: CrawlResult;
}): StackLayer[] {
  const layers: StackLayer[] = [];
  const add = (id: string, label: string, evidence: string[]) => {
    if (!evidence.length) return;
    layers.push({ id, label, evidence });
  };

  if (input.pkg) add("node", "Node.js", ["package.json"]);
  if (input.files.some((f) => f.endsWith(".ts") || f.endsWith(".tsx"))) add("typescript", "TypeScript", input.files.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx")).slice(0, 3));
  if (input.binNames.length) add("cli", "CLI", input.binNames.map((name) => `bin: ${name}`));
  if (input.allDeps.includes("react")) add("react", "React", ["react"]);
  if (input.allDeps.includes("next")) add("next", "Next.js", ["next"]);
  if (input.allDeps.includes("vue")) add("vue", "Vue", ["vue"]);
  if (input.allDeps.includes("express")) add("express", "Express", ["express"]);
  if (input.allDeps.includes("vite")) add("vite", "Vite", ["vite"]);
  if (input.files.includes("pyproject.toml") || input.files.some((f) => f.endsWith(".py"))) {
    add("python", "Python", input.files.filter((f) => f.endsWith(".py") || f === "pyproject.toml").slice(0, 3));
  }
  if (input.files.includes("go.mod")) add("go", "Go", ["go.mod"]);
  if (input.files.includes("Cargo.toml")) add("rust", "Rust", ["Cargo.toml"]);
  if (input.crawl.sources.has("src/cli.ts") || input.files.includes("src/cli.ts")) {
    add("fieldguide-shape", "TypeScript CLI layout", ["src/cli.ts"]);
  }
  return layers;
}

function inferIntegrations(
  allDeps: string[],
  envHits: ProjectModel["envHits"],
  sources: Map<string, string>,
): Integration[] {
  const found: Integration[] = [];
  const haystack = [...sources.entries()]
    .filter(([file]) => isProductSource(file))
    .map(([, text]) => text)
    .join("\n");
  for (const spec of INTEGRATIONS) {
    const evidence: string[] = [];
    for (const pkg of spec.packages ?? []) {
      if (allDeps.includes(pkg)) evidence.push(`package ${pkg}`);
    }
    const envKeys: string[] = [];
    for (const key of spec.env ?? []) {
      if (envHits.some((hit) => hit.key === key)) {
        envKeys.push(key);
        evidence.push(`env ${key}`);
      }
    }
    for (const needle of spec.needles ?? []) {
      if (haystack.includes(needle)) evidence.push(`source contains ${needle}`);
    }
    if (!evidence.length) continue;
    const gated = envKeys.length > 0;
    found.push({
      id: spec.id,
      label: spec.label,
      evidence,
      envKeys,
      grade: gated ? "Unverified (env-gated)" : "Code-inspected",
    });
  }
  return found;
}

function buildNaming(input: {
  displayName: string;
  packageName: string | null;
  folderName: string;
  metadataName: string | null;
  binNames: string[];
}): NamingRow[] {
  const rows: NamingRow[] = [
    { surface: "Display name", value: input.displayName },
    { surface: "Folder", value: input.folderName },
  ];
  if (input.packageName) rows.push({ surface: "package.json name", value: input.packageName });
  if (input.metadataName) rows.push({ surface: "metadata.json name", value: input.metadataName });
  for (const bin of input.binNames) rows.push({ surface: "CLI bin", value: bin });
  return rows;
}

function pmRun(manager: PackageManager, script: string): string {
  switch (manager) {
    case "pnpm":
      return `pnpm ${script}`;
    case "yarn":
      return `yarn ${script}`;
    case "bun":
      return `bun run ${script}`;
    case "npm":
    case "unknown":
      return `npm run ${script}`;
    default: {
      const _never: never = manager;
      return _never;
    }
  }
}

function buildVerifyPlan(input: {
  packageManager: PackageManager;
  scripts: Record<string, string>;
  hasTests: boolean;
  hasLint: boolean;
  hasBuild: boolean;
}): VerifyPlan {
  const stages: VerifyStage[] = [];
  if (input.scripts.verify) {
    const composed = splitScript(input.scripts.verify);
    if (composed.length > 1) {
      for (const part of composed) {
        stages.push(stageFromCommand(part, input.scripts));
      }
    } else {
      stages.push({
        name: "Verify",
        command: pmRun(input.packageManager, "verify"),
        expectedExit: 0,
        proves: "The repository's documented verify script.",
        mapClaims: "Health / runtime",
      });
    }
    return {
      label: "Default verify path",
      command: pmRun(input.packageManager, "verify"),
      stages: stages.length ? stages : [{
        name: "Verify",
        command: pmRun(input.packageManager, "verify"),
        expectedExit: 0,
        proves: "The repository's documented verify script.",
        mapClaims: "Health / runtime",
      }],
      notes: ["Default path: **no secrets**. Expected exit: **0** on a clean checkout after install."],
    };
  }

  if (input.hasLint) {
    stages.push({
      name: "Lint / typecheck",
      command: pmRun(input.packageManager, "lint"),
      expectedExit: 0,
      proves: "Static checks succeed without secret env.",
      mapClaims: "Health / runtime",
    });
  }
  if (input.scripts.test || input.hasTests) {
    const command = input.scripts.test ? pmRun(input.packageManager, "test") : "inferred tests exist but no test script";
    stages.push({
      name: "Tests",
      command,
      expectedExit: 0,
      proves: "Automated tests pass without secret env.",
      mapClaims: "Health / runtime",
    });
  }
  if (input.hasBuild) {
    stages.push({
      name: "Build",
      command: pmRun(input.packageManager, "build"),
      expectedExit: 0,
      proves: "Production build succeeds without secret env.",
      mapClaims: "Health / runtime",
    });
  }

  const command = stages
    .map((stage) => stage.command)
    .filter((item) => !item.startsWith("inferred"))
    .join(" && ") || null;

  return {
    label: "Inferred verify path",
    command,
    stages,
    notes: command
      ? ["No `verify` script was found; Fieldguide composed this path from lint/test/build.", "Default path: **no secrets**."]
      : ["No lint, test, or build script was inferred. The map is code-inspected only until a verify path exists."],
  };
}

function splitScript(script: string): string[] {
  return script.split("&&").map((part) => part.trim()).filter(Boolean);
}

function stageFromCommand(command: string, scripts: Record<string, string>): VerifyStage {
  const run = command.match(/^(?:npm run|pnpm(?: run)?|yarn|bun run)\s+(\S+)/);
  const scriptName = run?.[1];
  let name: string;
  if (scriptName) name = titleFromSlug(scriptName);
  else if (/\bverify-smoke\b/.test(command) || command.startsWith("tsx ")) name = "Smoke";
  else name = command;
  return {
    name,
    command,
    expectedExit: 0,
    proves: scriptName && scripts[scriptName] ? `\`${scripts[scriptName]}\`` : command,
    mapClaims: "Health / runtime",
  };
}

function summarizeTree(files: string[]): string[] {
  const top = new Set<string>();
  for (const file of files) {
    const first = file.split("/")[0];
    if (first) top.add(first.includes(".") ? first : `${first}/`);
  }
  return [...top].sort().slice(0, 24);
}

function buildSections(input: {
  displayName: string;
  stack: StackLayer[];
  scripts: Record<string, string>;
  routes: RouteHit[];
  envHits: ProjectModel["envHits"];
  integrations: Integration[];
  defaultVerify: VerifyPlan;
  binNames: string[];
  hasTests: boolean;
  testFiles: string[];
  ciFiles: string[];
  sourceFiles: string[];
  packageManager: PackageManager;
  allDeps: string[];
}): FeatureSection[] {
  const sections: FeatureSection[] = [];

  sections.push({
    id: "identity",
    title: "Identity / surface",
    claims: [
      {
        section: "Identity / surface",
        claim: `Product display name is **${input.displayName}**.`,
        grade: "Code-inspected",
        evidence: "Inferred from metadata.json, package.json, or folder name.",
      },
      {
        section: "Identity / surface",
        claim: input.binNames.length
          ? `CLI binaries: ${input.binNames.map((n) => `\`${n}\``).join(", ")}.`
          : "No CLI `bin` entry was found.",
        grade: input.binNames.length ? "Code-inspected" : "Gap",
        evidence: "package.json `bin`.",
      },
    ],
  });

  sections.push({
    id: "stack",
    title: "Stack",
    claims: input.stack.length
      ? input.stack.map((layer) => ({
          section: "Stack",
          claim: `${layer.label} is part of the inferred runtime.`,
          grade: "Code-inspected" as const,
          evidence: layer.evidence.join("; "),
        }))
      : [
          {
            section: "Stack",
            claim: "Stack could not be inferred from manifests or source extensions.",
            grade: "Gap",
            evidence: "No package.json, pyproject.toml, go.mod, or Cargo.toml with recognizable source.",
          },
        ],
  });

  if (input.binNames.length) {
    sections.push({
      id: "cli",
      title: "CLI",
      claims: [
        {
          section: "CLI",
          claim: `${input.displayName} exposes ${input.binNames.map((n) => `\`${n}\``).join(", ")}.`,
          grade: "Code-inspected",
          evidence: "package.json bin field.",
        },
        {
          section: "CLI",
          claim: "Running the CLI against a directory writes documentation files (README, feature map, AGENT.md, verify skill).",
          grade: input.sourceFiles.some((f) => f.includes("generate")) ? "Code-inspected" : "Gap",
          evidence: "Generator modules under src/ when present; otherwise inferred from package description.",
        },
      ],
    });
  }

  if (input.routes.length) {
    sections.push({
      id: "http",
      title: "HTTP / routes",
      intro: "Routes are string-matched in source. Live HTTP behavior is not proven unless a verify smoke hits them.",
      claims: input.routes.slice(0, 20).map((route) => ({
        section: "HTTP / routes",
        claim: `\`${route.method} ${route.path}\` is registered in source.`,
        grade: "Code-inspected" as const,
        evidence: `\`${route.file}\``,
      })),
      mustNotClaim: ["That these routes were exercised over the network on a clean checkout."],
    });
  }

  if (input.integrations.length) {
    sections.push({
      id: "integrations",
      title: "Integrations",
      claims: input.integrations.map((item) => ({
        section: "Integrations",
        claim: `${item.label} appears in the project.`,
        grade: item.grade,
        evidence: item.evidence.join("; "),
      })),
      mustNotClaim: input.integrations
        .filter((item) => item.grade === "Unverified (env-gated)")
        .map((item) => `Live ${item.label} calls on the default verify path.`),
    });
  }

  if (input.envHits.length) {
    sections.push({
      id: "env",
      title: "Environment",
      claims: input.envHits.slice(0, 30).map((hit) => ({
        section: "Environment",
        claim: `\`${hit.key}\` ${hit.files.length ? "is referenced in source" : "is documented"} ${hit.inExample ? "and listed in `.env.example`" : "and is **not** listed in `.env.example`"}.`,
        grade: (hit.inExample ? "Code-inspected" : "Gap") as EvidenceGrade,
        evidence: hit.files.length ? hit.files.join(", ") : ".env.example",
      })),
    });
  }

  sections.push({
    id: "health",
    title: "Health / runtime",
    intro: input.defaultVerify.command
      ? `Default verify path: \`${input.defaultVerify.command}\`.`
      : "No default verify path could be composed.",
    claims: [
      {
        section: "Health / runtime",
        claim: input.scripts.lint
          ? `Lint/typecheck script exists: \`${input.scripts.lint}\`.`
          : "No `lint` script.",
        grade: input.scripts.lint ? (input.defaultVerify.command ? "Proven (verify)" : "Code-inspected") : "Gap",
        evidence: "package.json scripts.",
      },
      {
        section: "Health / runtime",
        claim: input.scripts.test
          ? `Test script exists: \`${input.scripts.test}\`.`
          : input.hasTests
            ? `Test files exist (${input.testFiles.slice(0, 5).join(", ")}) but no test script.`
            : "No test script or test files inferred.",
        grade: input.scripts.test
          ? "Proven (verify)"
          : input.hasTests
            ? "Code-inspected"
            : "Gap",
        evidence: input.scripts.test ?? input.testFiles.slice(0, 5).join(", ") ?? "package.json scripts",
      },
      {
        section: "Health / runtime",
        claim: input.scripts.build
          ? `Build script exists: \`${input.scripts.build}\`.`
          : "No `build` script.",
        grade: input.scripts.build ? "Code-inspected" : "Gap",
        evidence: "package.json scripts.",
      },
      {
        section: "Health / runtime",
        claim: input.scripts.verify
          ? `A dedicated \`verify\` script is wired: \`${input.scripts.verify}\`.`
          : "No dedicated `verify` script; Fieldguide inferred a composed path when possible.",
        grade: input.scripts.verify ? "Proven (verify)" : input.defaultVerify.command ? "Code-inspected" : "Gap",
        evidence: "package.json scripts.",
      },
      {
        section: "Health / runtime",
        claim: input.ciFiles.length
          ? `CI config present: ${input.ciFiles.join(", ")}.`
          : "No GitHub Actions / GitLab CI file inferred.",
        grade: input.ciFiles.length ? "Code-inspected" : "Gap",
        evidence: input.ciFiles.join(", ") || "no workflow files",
      },
      {
        section: "Health / runtime",
        claim: `Package manager inferred as **${input.packageManager}**.`,
        grade: "Code-inspected",
        evidence: "lockfile or package.json presence.",
      },
    ],
  });

  return sections;
}

export function installCommand(model: ProjectModel): string {
  switch (model.packageManager) {
    case "pnpm":
      return "pnpm install";
    case "yarn":
      return "yarn";
    case "bun":
      return "bun install";
    case "npm":
    case "unknown":
      return "npm install";
    default: {
      const _never: never = model.packageManager;
      return _never;
    }
  }
}

export function skillRelPath(model: ProjectModel): string {
  return `.agents/skills/verify-${model.slug}/SKILL.md`;
}

export function outputPathFor(kind: DocKind, model: ProjectModel): string {
  switch (kind) {
    case "readme":
      return "README.md";
    case "map":
      return "docs/FEATURE_MAP.md";
    case "agent":
      return "AGENT.md";
    case "skill":
      return skillRelPath(model);
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}
