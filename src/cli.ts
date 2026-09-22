#!/usr/bin/env node
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { analyze, generateDocs, parseKinds } from "./generate.js";
import { ReasonParseError } from "./reason.js";
import { asciiTable, banner, clip, kvTable, previewBlock, statusLabel } from "./report.js";
import type { DocKind, WriteResult } from "./types.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

const program = new Command();

program
  .name("fieldguide")
  .version(pkg.version)
  .description("Crawl a project, reason about it with ModelHitch, and write navigation docs.")
  .argument("[dir]", "project root", ".")
  .option("--dry-run", "print what would be written without touching the disk", false)
  .option("--force", "overwrite an existing README even without a Fieldguide marker", false)
  .option("--only <kinds>", "comma list: readme,map,agent,skill")
  .option("--json", "print the inferred model as JSON (no ModelHitch call)", false)
  .option("--no-llm", "skip ModelHitch and write inventory templates only")
  .option("--provider <id>", "ModelHitch provider (default: config, else ollama)")
  .option("--model <id>", "ModelHitch model id")
  .action(async (
    dir: string,
    opts: {
      dryRun: boolean;
      force: boolean;
      only?: string;
      json?: boolean;
      llm?: boolean;
      provider?: string;
      model?: string;
    },
  ) => {
    const root = resolve(dir);
    try {
      const kinds = parseKinds(opts.only);
      if (opts.json) {
        const model = await analyze(root);
        process.stdout.write(`${JSON.stringify(model, null, 2)}\n`);
        return;
      }

      process.stderr.write(banner(pkg.version));
      const llm = opts.llm !== false;
      const steps: Array<[string, string]> = [
        ["Crawl", "…"],
        ["Infer", "…"],
        ["Reason", llm ? "…" : "skipped (--no-llm)"],
        ["Write", "…"],
      ];

      const { model, results, reasoning, lane } = await generateDocs({
        root,
        dryRun: opts.dryRun,
        force: opts.force,
        kinds,
        llm,
        provider: opts.provider,
        model: opts.model,
        onProgress: (event) => {
          switch (event.step) {
            case "crawl":
              steps[0] = ["Crawl", event.detail ?? "reading tree"];
              break;
            case "infer":
              steps[0] = ["Crawl", event.detail ?? "done"];
              steps[1] = ["Infer", event.detail ?? "done"];
              break;
            case "reason":
              steps[2] = ["Reason", event.detail ?? "ModelHitch"];
              break;
            case "write":
              steps[3] = ["Write", event.detail ?? "files"];
              break;
            default: {
              const _never: never = event.step;
              return _never;
            }
          }
        },
      });

      steps[1] = ["Infer", `${model.displayName} · ${model.stack.map((layer) => layer.label).join(" · ") || "unknown stack"}`];
      if (lane) steps[2] = ["Reason", `${lane.provider} / ${lane.model}`];
      else steps[2] = ["Reason", "inventory templates (--no-llm)"];
      const wrote = results.filter((item) => item.status === "wrote").length;
      const skipped = results.filter((item) => item.status === "skipped").length;
      steps[3] = ["Write", `${wrote} wrote · ${skipped} skipped · ${results.length} total`];

      process.stderr.write(
        `${kvTable([
          ["Project", model.displayName],
          ["Package", model.packageName ?? "—"],
          ["Root", root],
          ["Hitch", lane ? `${lane.provider} / ${lane.model}` : "off"],
        ])}\n\n`,
      );
      process.stderr.write(`${asciiTable(["Step", "Detail"], steps, [12, 64])}\n\n`);
      process.stderr.write(`${fileTable(results)}\n`);

      if (reasoning) {
        process.stderr.write(`\n${previewBlock("Reasoning", reasoning)}\n`);
      }

      if (opts.dryRun) {
        for (const result of results) {
          if (result.status !== "dry-run" || !result.body) continue;
          process.stdout.write(`\n${pc.bold(result.rel)}\n${pc.dim("─".repeat(72))}\n${result.body.trim()}\n`);
        }
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`\n  ${pc.red(pc.bold("Failed"))}\n  ${message}\n\n`);
      if (error instanceof ReasonParseError && error.preview) {
        process.stderr.write(previewBlock("Model preview", error.preview));
      }
      process.exitCode = 1;
    }
  });

function fileTable(results: WriteResult[]): string {
  const rows = results.map((result) => {
    const note = result.reason ? clip(result.reason, 36) : kindLabel(result.kind);
    return [result.rel, statusLabel(result.status), note];
  });
  return asciiTable(["File", "Status", "Notes"], rows, [42, 10, 36]);
}

function kindLabel(kind: DocKind): string {
  switch (kind) {
    case "readme":
      return "product README";
    case "map":
      return "feature map";
    case "agent":
      return "agent instructions";
    case "skill":
      return "verify skill";
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

program.parseAsync();
