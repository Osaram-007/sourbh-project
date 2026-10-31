// Pure WCAG contrast check over the design tokens in src/app/globals.css (WL-A11Y-2/3/8/9, WL-LAND-9).
// Reads the real CSS, so swapping --color-brand (Q-C8) is re-checked automatically.
// Run from the repo root: npx tsx --test tests/web/contrast.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { STATUS, STATUS_ORDER } from "../../src/lib/status";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const decls = new Map<string, string>();
for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls.set(m[1], m[2].trim());

/** Follow var() aliases down to a 6-digit hex. Anything else (color-mix, rgb) is not testable and throws. */
function hex(token: string): string {
  let v = decls.get(token);
  assert.ok(v, `${token} is not defined in globals.css`);
  for (let i = 0; i < 5 && v.startsWith("var("); i++) {
    const next = decls.get(v.slice(4, -1).trim());
    assert.ok(next, `${token} aliases an undefined variable (${v})`);
    v = next;
  }
  assert.match(v, /^#[0-9a-f]{6}$/i, `${token} must resolve to a 6-digit hex, got "${v}"`);
  return v;
}

function luminance(h: string): number {
  const n = parseInt(h.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg: string, bg: string): number {
  const [a, b] = [luminance(hex(fg)), luminance(hex(bg))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const TEXT = 4.5; // normal text
const UI = 3; // large text, icons, borders, focus ring

const SURFACES = ["--color-surface", "--color-mint"];
const statusTokens = STATUS_ORDER.map((s) => STATUS[s].token);

// [foreground, background, minimum ratio]
const pairs: [string, string, number][] = [
  // Text on every surface it can sit on.
  ...(["--color-ink", "--color-ink-muted", "--color-brand"] as const).flatMap((fg) =>
    [...SURFACES, "--color-surface-muted"].map((bg): [string, string, number] => [fg, bg, TEXT]),
  ),
  ["--color-on-brand", "--color-brand", TEXT], // primary button label
  // Non-text: status colours (icon, dot, marker) on white and mint, and the white marker glyph on the status colour.
  ...statusTokens.flatMap((t) => [
    ...SURFACES.map((bg): [string, string, number] => [t, bg, UI]),
    ["--color-on-brand", t, UI] as [string, string, number],
  ]),
  // Control borders and the focus ring.
  ...["--color-border-strong", "--color-focus"].flatMap((fg) => SURFACES.map((bg): [string, string, number] => [fg, bg, UI])),
];

describe("contrast: every token pair", () => {
  for (const [fg, bg, min] of pairs) {
    it(`${fg} on ${bg} >= ${min}:1`, (t) => {
      const r = ratio(fg, bg);
      t.diagnostic(`${fg} ${hex(fg)} on ${bg} ${hex(bg)} = ${r.toFixed(2)}:1`);
      assert.ok(r >= min, `${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min}:1`);
    });
  }
});

describe("status map (ADR-0020)", () => {
  const entries = STATUS_ORDER.map((s) => STATUS[s]);

  it("has exactly the four states: no In use, no Maintenance", () => {
    assert.deepEqual(STATUS_ORDER, ["AVAILABLE", "LIMITED", "UNAVAILABLE", "UNKNOWN"]);
    assert.deepEqual(Object.keys(STATUS).sort(), [...STATUS_ORDER].sort());
    assert.deepEqual(entries.map((e) => e.label), ["Available", "Limited", "Unavailable", "Status unknown"]);
  });

  it("gives each state its own colour, icon and word (never colour alone)", () => {
    for (const key of ["token", "icon", "label"] as const) {
      assert.equal(new Set(entries.map((e) => e[key])).size, entries.length, `${key} values must be distinct`);
    }
    assert.equal(new Set(entries.map((e) => hex(e.token))).size, entries.length, "hex values must be distinct");
    for (const e of entries) {
      assert.equal(e.color, `var(${e.token})`);
      assert.ok(e.label && e.description, "label and description are required");
    }
  });
});

describe("other token rules", () => {
  it("focus ring is at least 2px (WL-A11Y-4)", () => {
    const m = /^(\d+(?:\.\d+)?)px$/.exec(decls.get("--focus-ring-width") ?? "");
    assert.ok(m && Number(m[1]) >= 2, `--focus-ring-width is "${decls.get("--focus-ring-width")}"`);
  });

  it("no type-scale step is below 14px (WL-A11Y-9)", () => {
    const steps = [...decls].filter(([k]) => /^--text-[a-z-]+$/.test(k) && !k.includes("--line-height"));
    assert.ok(steps.length >= 4, "type scale is missing");
    for (const [k, v] of steps) {
      const m = /^(?:clamp\()?(\d+(?:\.\d+)?)(rem|px)/.exec(v); // clamp(): its minimum is the first argument
      assert.ok(m, `${k}: cannot read "${v}"`);
      const px = Number(m[1]) * (m[2] === "rem" ? 16 : 1);
      assert.ok(px >= 14, `${k} is ${px}px`);
    }
  });

  it("prefers-reduced-motion switches off ping, pulse and bounce (WL-A11Y-8)", () => {
    const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\n\})/.exec(css)?.[1] ?? "";
    for (const cls of ["animate-ping", "animate-pulse", "animate-bounce"]) assert.ok(block.includes(`.${cls}`), `${cls} not handled`);
  });
});
