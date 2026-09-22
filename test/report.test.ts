import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { asciiTable, clip } from "../src/report.js";

describe("asciiTable", () => {
  it("renders a boxed header and rows", () => {
    const out = asciiTable(["File", "Status"], [["README.md", "wrote"], ["AGENT.md", "skipped"]]);
    assert.match(out, /File/);
    assert.match(out, /README.md/);
    assert.match(out, /┌/);
    assert.match(out, /└/);
  });

  it("clips long cells", () => {
    assert.equal(clip("abcdefghij", 6).length, 6);
    assert.match(clip("abcdefghij", 6), /…$/);
  });
});
