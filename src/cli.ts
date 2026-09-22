#!/usr/bin/env node
import { resolve } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { analyze, generateDocs, parseKinds } from "./generate.js";
import { outputPathFor } from "./infer.js";
import type { DocKind } from "./types.js";

const program = new Command();

program
  .name("fieldguide")
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
      process.stderr.write(`${pc.bold("Fieldguide")}  ${pc.dim(root)}\n`);
      const llm = opts.llm !== false;
      const { model, results, reasoning, lane } = await generateDocs({
        root,
        dryRun: opts.dryRun,
        force: opts.force,
        kinds,
        llm,
        provider: opts.provider,
        model: opts.model,
      });
      process.stderr.write(
        `${pc.dim("Inferred")}  ${model.displayName} · ${model.stack.map((s) => s.label).join(" · ") || "unknown stack"}\n`,
      );
      if (lane) {
        process.stderr.write(`${pc.dim("ModelHitch")}  ${lane.provider}/${lane.model}\n`);
      } else {
        process.stderr.write(`${pc.yellow("templates")}  --no-llm; inventory only, no reasoning pass\n`);
      }
      if (reasoning) {
        process.stderr.write(`${pc.dim("Reasoning")}  ${reasoning.split(/\r?\n/)[0]}\n`);
      }
      for (const result of results) {
        const tag =
          result.status === "wrote"
            ? pc.green("wrote")
            : result.status === "skipped"
              ? pc.yellow("skip")
              : pc.cyan("dry");
        process.stderr.write(`  ${tag}  ${result.rel}${result.reason ? pc.dim(`  ${result.reason}`) : ""}\n`);
        if (result.status === "dry-run" && result.body) {
          process.stdout.write(`\n----- ${result.rel} -----\n${result.body.trim()}\n`);
        }
      }
      if (opts.dryRun) return;
      process.stderr.write(pc.dim(`\nFeature map: ${outputPathFor("map" as DocKind, model)}\n`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${pc.red("fieldguide:")} ${message}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync();
