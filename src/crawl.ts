import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import ignore from "ignore";
import { posixRel, readText } from "./util.js";
import type { FileRecord } from "./types.js";

const MAX_FILES = 1200;
const MAX_SOURCE_READS = 220;
const MAX_FILE_BYTES = 256_000;

const DEFAULT_IGNORES = [
  ".git/",
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  ".next/",
  ".nuxt/",
  ".turbo/",
  ".cache/",
  ".venv/",
  "venv/",
  "__pycache__/",
  "target/",
  "vendor/",
  ".docusaurus/",
  "out/",
  "*.min.js",
  "*.map",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
];

const TEXT_EXT = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".vue",
  ".svelte",
  ".py",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".java",
  ".kt",
  ".cs",
  ".toml",
  ".yml",
  ".yaml",
  ".html",
  ".css",
  ".scss",
  ".env",
  ".example",
  ".sh",
  ".ps1",
  ".xml",
  ".svg",
]);

const SOURCE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".vue",
  ".svelte",
  ".java",
  ".kt",
  ".cs",
]);

export interface CrawlResult {
  files: FileRecord[];
  sources: Map<string, string>;
}

export async function crawl(root: string): Promise<CrawlResult> {
  const ig = ignore().add(DEFAULT_IGNORES);
  const gitignore = readText(join(root, ".gitignore"));
  if (gitignore) ig.add(gitignore);

  const files: FileRecord[] = [];
  await walk(root, root, ig, files);

  const sourceCandidates = files
    .filter((file) => isSourcePath(file.rel) && file.size <= MAX_FILE_BYTES)
    .slice(0, MAX_SOURCE_READS);

  const sources = new Map<string, string>();
  for (const file of sourceCandidates) {
    const text = readText(join(root, file.rel));
    if (text) sources.set(file.rel, text);
  }

  const extra = [
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "metadata.json",
    ".env.example",
    "README.md",
    "AGENT.md",
    "AGENTS.md",
  ];
  for (const rel of extra) {
    if (sources.has(rel)) continue;
    const text = readText(join(root, rel));
    if (text) sources.set(rel, text);
  }

  return { files, sources };
}

async function walk(
  root: string,
  dir: string,
  ig: ReturnType<typeof ignore>,
  files: FileRecord[],
): Promise<void> {
  if (files.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (files.length >= MAX_FILES) return;
    const abs = join(dir, entry.name);
    const rel = posixRel(relative(root, abs));
    if (!rel || rel === ".") continue;
    const ignorePath = entry.isDirectory() ? `${rel}/` : rel;
    if (ig.ignores(ignorePath) || ig.ignores(rel)) continue;

    if (entry.isDirectory()) {
      await walk(root, abs, ig, files);
      continue;
    }
    if (!entry.isFile()) continue;

    try {
      const info = await stat(abs);
      files.push({ rel, size: info.size });
    } catch {
      continue;
    }
  }
}

export function isSourcePath(rel: string): boolean {
  const lower = rel.toLowerCase();
  const ext = extname(lower);
  if (lower.endsWith(".env.example") || lower.endsWith(".env.sample")) return true;
  if (lower.endsWith("dockerfile")) return true;
  return SOURCE_EXT.has(ext) || TEXT_EXT.has(ext);
}

function extname(rel: string): string {
  const base = rel.split("/").pop() ?? rel;
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i) : "";
}
