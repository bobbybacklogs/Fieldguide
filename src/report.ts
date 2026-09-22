import pc from "picocolors";

export function asciiTable(headers: string[], rows: string[][], widths?: number[]): string {
  const cols = headers.length;
  const measured = headers.map((header, index) => {
    const cap = widths?.[index] ?? 56;
    const longest = Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length));
    return Math.min(cap, Math.max(longest, 4));
  });

  const line = (left: string, mid: string, right: string, fill: string) =>
    `${left}${measured.map((width) => fill.repeat(width + 2)).join(mid)}${right}`;

  const rowLine = (cells: string[], emphasize?: boolean) => {
    const body = cells
      .map((cell, index) => {
        const clipped = clip(cell, measured[index] ?? 4);
        const padded = clipped.padEnd(measured[index] ?? 4);
        return ` ${emphasize ? pc.bold(padded) : padded} `;
      })
      .join(pc.dim("│"));
    return `${pc.dim("│")}${body}${pc.dim("│")}`;
  };

  const out = [
    pc.dim(line("┌", "┬", "┐", "─")),
    rowLine(headers, true),
    pc.dim(line("├", "┼", "┤", "─")),
    ...rows.map((row) => {
      const cells = Array.from({ length: cols }, (_, index) => row[index] ?? "");
      return rowLine(cells);
    }),
    pc.dim(line("└", "┴", "┘", "─")),
  ];
  return out.join("\n");
}

export function banner(version: string): string {
  return [
    "",
    `  ${pc.bold("Fieldguide")}  ${pc.dim(version)}`,
    `  ${pc.dim("Current-state docs from the checkout — not a roadmap.")}`,
    "",
  ].join("\n");
}

export function kvTable(rows: Array<[string, string]>): string {
  return asciiTable(["Item", "Value"], rows, [16, 64]);
}

export function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1))}…`;
}

export function statusLabel(status: "wrote" | "skipped" | "dry-run"): string {
  switch (status) {
    case "wrote":
      return pc.green("wrote");
    case "skipped":
      return pc.yellow("skipped");
    case "dry-run":
      return pc.cyan("dry-run");
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function previewBlock(label: string, text: string): string {
  const lines = text.trim().split(/\r?\n/).slice(0, 8);
  const body = lines.map((line) => `  ${pc.dim("│")} ${clip(line, 88)}`).join("\n");
  return `  ${pc.bold(label)}\n${body || `  ${pc.dim("│")} (empty)`}\n`;
}
