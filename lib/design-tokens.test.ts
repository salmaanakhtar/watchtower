import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DARK_TOKENS, LIGHT_TOKENS } from "./design-tokens";

// styles/tokens.css must stay in lockstep with lib/design-tokens.ts —
// one source of truth for engineers and any future design tooling.
function parseBlock(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`selector ${selector} not found in tokens.css`);
  const open = css.indexOf("{", start);
  let depth = 1;
  let end = open;
  while (depth > 0 && end < css.length) {
    end++;
    if (css[end] === "{") depth++;
    if (css[end] === "}") depth--;
  }
  const body = css.slice(open + 1, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim().toLowerCase();
  }
  return out;
}

describe("design token parity", () => {
  const css = readFileSync(resolve(__dirname, "../styles/tokens.css"), "utf8");

  it("tokens.css :root matches LIGHT_TOKENS", () => {
    const root = parseBlock(css, ":root");
    for (const [k, v] of Object.entries(LIGHT_TOKENS)) {
      expect(root[k], `${k} should be ${v}`).toBe(v.toLowerCase());
    }
  });

  it("tokens.css dark block matches DARK_TOKENS", () => {
    const dark = parseBlock(css, "@media (prefers-color-scheme: dark)");
    for (const [k, v] of Object.entries(DARK_TOKENS)) {
      expect(dark[k], `${k} should be ${v}`).toBe(v.toLowerCase());
    }
  });
});
