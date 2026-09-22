import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function posixRel(rel: string): string {
  return rel.replaceAll("\\", "/");
}

export function titleFromSlug(value: string): string {
  const cleaned = value.replace(/^@[^/]+\//, "").replace(/[-_]+/g, " ");
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function slugify(value: string): string {
  return value
    .replace(/^@[^/]+\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "project";
}

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function stringField(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const value = obj[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function recordKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>);
}

export function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

export function detectGithub(root: string): string | null {
  const cfg = readText(join(root, ".git", "config"));
  if (!cfg) return null;
  const match = cfg.match(/github\.com[:/]([^/\s]+)\/([^.\s]+)/);
  if (!match?.[1] || !match[2]) return null;
  return `${match[1]}/${match[2].replace(/\.git$/, "")}`;
}

export function fileExists(root: string, rel: string): boolean {
  return existsSync(join(root, rel));
}

export function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}`;
}

export function fence(lang: string, body: string): string {
  return `\`\`\`${lang}\n${body.trimEnd()}\n\`\`\``;
}

export function bullet(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}
