// UI primitives in src/components/ui (WEB-A03): WL-A11Y-4 (focus ring, keyboard), -5 (target size), -6 (form labels/errors),
// -10 (accessible names, skip link). Server-side markup via renderToStaticMarkup plus source checks; no DOM, no new deps.
// Dialog and Toast behaviour (showModal, Esc, focus return, timers, live announcements) needs a real browser: those get
// e2e tests from their first consumer (WEB-B07 / WEB-B19). Only their static markup is checked here.
// Run from the repo root: npx tsx --test tests/web/ui.test.tsx
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, ButtonLink, buttonClass } from "../../src/components/ui/Button";
import { Checkbox } from "../../src/components/ui/Checkbox";
import { Dialog } from "../../src/components/ui/Dialog";
import { Field, fieldA11y } from "../../src/components/ui/Field";
import { IconButton } from "../../src/components/ui/IconButton";
import { Input } from "../../src/components/ui/Input";
import { Select } from "../../src/components/ui/Select";
import { Skeleton } from "../../src/components/ui/Skeleton";
import { SkipLink } from "../../src/components/ui/SkipLink";
import { dismissToast, toast, Toaster } from "../../src/components/ui/Toast";
import { VisuallyHidden } from "../../src/components/ui/VisuallyHidden";

const UI_DIR = resolve(process.cwd(), "src/components/ui");
const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

// ---- Minimal markup helpers (React's static output is regular: double-quoted attributes, escaped values) ----

interface El {
  name: string;
  attrs: Record<string, string>;
  end: number;
}

const render = (el: ReactElement) => renderToStaticMarkup(el);

function startTags(html: string): El[] {
  const out: El[] = [];
  for (const m of html.matchAll(/<([a-z][a-z0-9]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*\/?>/g)) {
    const attrs: Record<string, string> = {};
    // HTML attribute names are case-insensitive and React writes autoComplete / inputMode in camel case.
    for (const a of m[2].matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) attrs[a[1].toLowerCase()] = a[2] ?? "";
    out.push({ name: m[1], attrs, end: m.index + m[0].length });
  }
  return out;
}

/** The one start tag with this name. Fails if there are none or several. */
function only(html: string, name: string, where: (t: El) => boolean = () => true): El {
  const hits = startTags(html).filter((t) => t.name === name && where(t));
  assert.equal(hits.length, 1, `expected exactly one <${name}> in ${html}`);
  return hits[0];
}

const byId = (html: string, id: string) => startTags(html).filter((t) => t.attrs.id === id);
const classes = (el: El) => (el.attrs.class ?? "").split(/\s+/).filter(Boolean);

/** Text content of an element, up to its matching close tag. */
function textOf(html: string, el: El): string {
  const re = new RegExp(`<(/?)${el.name}\\b[^>]*>`, "g");
  re.lastIndex = el.end;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (!depth) return html.slice(el.end, m.index).replace(/<[^>]*>/g, "");
  }
  throw new Error(`unclosed <${el.name}> in ${html}`);
}

const describedBy = (control: El) => (control.attrs["aria-describedby"] ?? "").split(/\s+/).filter(Boolean);

/** Every aria-describedby token must name exactly one element in the markup. */
function assertNoDanglingRefs(html: string, control: El) {
  for (const id of describedBy(control)) assert.equal(byId(html, id).length, 1, `aria-describedby="${id}" must match exactly one element`);
}

// ---- Class -> pixel size, resolved against the real tokens in globals.css ----

function remPx(token: string): number {
  const m = css.match(new RegExp(`${token}:\\s*([\\d.]+)rem`));
  assert.ok(m, `${token} must be a rem value in globals.css`);
  return parseFloat(m[1]) * 16;
}

/** Height of the `min-h-*` / `size-*` class in a class list: numeric = 4px steps, otherwise a --spacing-* token. */
function targetPx(cls: string): number {
  const m = cls.split(/\s+/).map((t) => t.match(/^(?:min-h|size)-(.+)$/)).find(Boolean);
  assert.ok(m, `no min-h-/size- class in "${cls}"`);
  return /^\d+(\.\d+)?$/.test(m[1]) ? parseFloat(m[1]) * 4 : remPx(`--spacing-${m[1]}`);
}

describe("size tokens (anchor for the 24 / 44 px assertions)", () => {
  it("--spacing-target is 44px and --spacing-target-min is 24px", () => {
    assert.equal(remPx("--spacing-target"), 44);
    assert.equal(remPx("--spacing-target-min"), 24);
  });
});

// ---- 1. Input, Select, Checkbox ----

type Extra = { hint?: ReactNode; error?: ReactNode };
const FIELDS: { name: string; tag: "input" | "select"; make: (e: Extra) => ReactElement }[] = [
  { name: "Input", tag: "input", make: (e) => <Input id="email" label="Email address" {...e} /> },
  {
    name: "Select",
    tag: "select",
    make: (e) => (
      <Select id="email" label="Email address" {...e}>
        <option value="a">A</option>
      </Select>
    ),
  },
  { name: "Checkbox", tag: "input", make: (e) => <Checkbox id="email" label="Email address" {...e} /> },
];
const HINT = "We only use it to sign you in";
const ERROR = "Enter a valid email address";

for (const f of FIELDS) {
  describe(`${f.name}: label, hint and error wiring (WL-A11Y-6)`, () => {
    it("ties a visible label to the control by for/id", () => {
      const html = render(f.make({}));
      const control = only(html, f.tag);
      assert.equal(control.attrs.id, "email");
      assert.equal(byId(html, "email").length, 1, "the id must be unique");
      const label = only(html, "label");
      assert.equal(label.attrs.for, "email");
      assert.equal(textOf(html, label), "Email address");
      assert.ok(!classes(label).includes("sr-only"), "the label must be visible, not screen-reader-only");
    });

    it("with neither hint nor error: no aria-describedby and no aria-invalid at all", () => {
      // Check the control's attributes: the class list legitimately contains the "aria-invalid:" Tailwind variant.
      const control = only(render(f.make({})), f.tag);
      assert.ok(!("aria-describedby" in control.attrs), JSON.stringify(control.attrs));
      assert.ok(!("aria-invalid" in control.attrs), JSON.stringify(control.attrs));
    });

    it("empty or falsy hint/error values add nothing (no dangling references)", () => {
      for (const extra of [{ error: "" }, { hint: "" }, { error: null, hint: null }, { error: false }, { hint: undefined }] as Extra[]) {
        const html = render(f.make(extra));
        const control = only(html, f.tag);
        assert.ok(!("aria-describedby" in control.attrs), `${JSON.stringify(extra)} -> ${html}`);
        assert.ok(!("aria-invalid" in control.attrs), `${JSON.stringify(extra)} -> ${html}`);
        assert.equal(byId(html, "email-error").length + byId(html, "email-hint").length, 0);
      }
    });

    it("error: aria-invalid, and aria-describedby points at an element holding the error text", () => {
      const html = render(f.make({ error: ERROR }));
      const control = only(html, f.tag);
      assert.equal(control.attrs["aria-invalid"], "true");
      assert.deepEqual(describedBy(control), ["email-error"]);
      assertNoDanglingRefs(html, control);
      const errorEl = only(html, "p", (t) => t.attrs.id === "email-error");
      const text = textOf(html, errorEl);
      assert.ok(text.includes(ERROR), `error text missing from "${text}"`);
      assert.ok(text.includes("Error:"), "the word Error must be in the text, so it is not colour alone");
      assert.equal(errorEl.attrs.role, "alert", "an error that appears later must be announced");
    });

    it("the hint is not a live region (only the error is announced)", () => {
      const html = render(f.make({ hint: HINT, error: ERROR }));
      assert.ok(!("role" in only(html, "p", (t) => t.attrs.id === "email-hint").attrs));
    });

    it("every icon in the field (error icon, Select chevron) is decorative (aria-hidden)", () => {
      const svgs = startTags(render(f.make({ error: ERROR }))).filter((t) => t.name === "svg");
      assert.ok(svgs.length >= 1, "the error icon must render");
      for (const svg of svgs) assert.equal(svg.attrs["aria-hidden"], "true");
    });

    it("hint only: describedby points at the hint, the control is not invalid", () => {
      const html = render(f.make({ hint: HINT }));
      const control = only(html, f.tag);
      assert.deepEqual(describedBy(control), ["email-hint"]);
      assert.ok(!("aria-invalid" in control.attrs));
      assertNoDanglingRefs(html, control);
      assert.equal(textOf(html, only(html, "p", (t) => t.attrs.id === "email-hint")), HINT);
    });

    it("hint and error: both ids are referenced, both exist, in reading order", () => {
      const html = render(f.make({ hint: HINT, error: ERROR }));
      const control = only(html, f.tag);
      assert.deepEqual(describedBy(control).sort(), ["email-error", "email-hint"]);
      assertNoDanglingRefs(html, control);
      assert.equal(control.attrs["aria-invalid"], "true");
      assert.ok(textOf(html, only(html, "p", (t) => t.attrs.id === "email-hint")).includes(HINT));
      assert.ok(textOf(html, only(html, "p", (t) => t.attrs.id === "email-error")).includes(ERROR));
      const at = (s: string) => html.indexOf(s);
      assert.ok(at(`id="email-hint"`) < at(`id="email-error"`), "hint comes before error");
    });

    it("className goes on the wrapper, not the control, and never renders 'undefined'", () => {
      const html = render(f.make({}));
      assert.ok(!html.includes("undefined"), html);
      const withClass = render(
        f.name === "Input" ? (
          <Input id="email" label="L" className="w-64" />
        ) : f.name === "Select" ? (
          <Select id="email" label="L" className="w-64">
            <option>A</option>
          </Select>
        ) : (
          <Checkbox id="email" label="L" className="w-64" />
        ),
      );
      assert.ok(!classes(only(withClass, f.tag)).includes("w-64"), "className must not reach the control");
      assert.ok(startTags(withClass).some((t) => t.name === "div" && classes(t).includes("w-64")), "className must reach the wrapper");
    });
  });
}

describe("Input", () => {
  it("defaults to type=text and lets the caller change it", () => {
    assert.equal(only(render(<Input id="a" label="A" />), "input").attrs.type, "text");
    assert.equal(only(render(<Input id="a" label="A" type="email" />), "input").attrs.type, "email");
  });

  it("passes autocomplete, OTP autocomplete, name, required, inputMode and placeholder through (WL-A11Y-6)", () => {
    const html = render(<Input id="otp" label="Code" autoComplete="one-time-code" name="otp" required inputMode="numeric" placeholder="123456" />);
    const input = only(html, "input");
    assert.equal(input.attrs.autocomplete, "one-time-code");
    assert.equal(input.attrs.name, "otp");
    assert.ok("required" in input.attrs);
    assert.equal(input.attrs.inputmode, "numeric");
    assert.equal(input.attrs.placeholder, "123456");
    assert.equal(textOf(html, only(html, "label")), "Code", "a placeholder must not replace the visible label");
  });

  it("control is at least 44px tall and carries the focus ring", () => {
    const input = only(render(<Input id="a" label="A" />), "input");
    assert.ok(targetPx(input.attrs.class) >= 44);
    assert.ok(classes(input).includes("focus-ring"));
  });
});

describe("Select", () => {
  it("renders the options inside a native select, with a decorative chevron", () => {
    const html = render(
      <Select id="c" label="Connector">
        <option value="ccs2">CCS2</option>
        <option value="type2">Type 2</option>
      </Select>,
    );
    assert.equal(only(html, "select").attrs.id, "c");
    assert.equal(startTags(html).filter((t) => t.name === "option").length, 2);
    assert.equal(only(html, "svg").attrs["aria-hidden"], "true");
  });

  it("control is at least 44px tall and carries the focus ring", () => {
    const select = only(render(<Select id="c" label="C"><option>A</option></Select>), "select");
    assert.ok(targetPx(select.attrs.class) >= 44);
    assert.ok(classes(select).includes("focus-ring"));
  });
});

describe("Checkbox", () => {
  it("is a native checkbox, 24px or more, with the focus ring", () => {
    const box = only(render(<Checkbox id="c" label="Remember me" />), "input");
    assert.equal(box.attrs.type, "checkbox");
    assert.ok(targetPx(box.attrs.class) >= 24);
    assert.ok(classes(box).includes("focus-ring"));
  });

  it("label may hold a link, and still belongs to the box by for/id", () => {
    const html = render(<Checkbox id="terms" label={<>I accept the <a href="/legal/terms">terms</a></>} />);
    const label = only(html, "label");
    assert.equal(label.attrs.for, "terms");
    assert.equal(textOf(html, label), "I accept the terms");
    assert.equal(only(html, "a").attrs.href, "/legal/terms");
  });

  it("passes checked state and name through", () => {
    const input = only(render(<Checkbox id="c" label="C" name="consent" defaultChecked disabled />), "input");
    assert.equal(input.attrs.name, "consent");
    assert.ok("checked" in input.attrs && "disabled" in input.attrs);
  });
});

describe("fieldA11y / Field", () => {
  it("fieldA11y lists hint then error, and sets invalid only for a truthy error", () => {
    assert.deepEqual(fieldA11y("f", {}), { "aria-describedby": undefined, "aria-invalid": undefined });
    assert.deepEqual(fieldA11y("f", { hint: "h" }), { "aria-describedby": "f-hint", "aria-invalid": undefined });
    assert.deepEqual(fieldA11y("f", { error: "e" }), { "aria-describedby": "f-error", "aria-invalid": true });
    assert.deepEqual(fieldA11y("f", { hint: "h", error: "e" }), { "aria-describedby": "f-hint f-error", "aria-invalid": true });
    assert.deepEqual(fieldA11y("f", { hint: "", error: "" }), { "aria-describedby": undefined, "aria-invalid": undefined });
  });

  it("Field works around a custom control: label, hint and error resolve from the same id", () => {
    const html = render(
      <Field id="x" label="Custom" hint="h" error="e">
        <textarea id="x" {...fieldA11y("x", { hint: "h", error: "e" })} />
      </Field>,
    );
    const control = only(html, "textarea");
    assert.equal(only(html, "label").attrs.for, "x");
    assert.deepEqual(describedBy(control), ["x-hint", "x-error"]);
    assertNoDanglingRefs(html, control);
  });
});

// ---- 2. Button, ButtonLink ----

describe("Button", () => {
  it("defaults to type=button (never submits a form by accident), and honours type=submit", () => {
    assert.equal(only(render(<Button>Go</Button>), "button").attrs.type, "button");
    assert.equal(only(render(<Button type="submit">Go</Button>), "button").attrs.type, "submit");
    assert.equal(only(render(<Button type="reset">Go</Button>), "button").attrs.type, "reset");
  });

  it("renders its children and passes native attributes through", () => {
    const html = render(<Button disabled aria-pressed="true" name="go">Go now</Button>);
    const b = only(html, "button");
    assert.equal(textOf(html, b), "Go now");
    assert.ok("disabled" in b.attrs);
    assert.equal(b.attrs["aria-pressed"], "true");
    assert.equal(b.attrs.name, "go");
  });

  it("every variant at the default size is a 44px primary target (WL-A11Y-5)", () => {
    for (const variant of ["primary", "secondary", "quiet"] as const) {
      const b = only(render(<Button variant={variant}>x</Button>), "button");
      assert.ok(classes(b).includes("min-h-target"), `${variant}: ${b.attrs.class}`);
      assert.ok(targetPx(b.attrs.class) >= 44, variant);
    }
    // No variant is the default for md either: omitting both props gives the 44px primary.
    assert.ok(targetPx(only(render(<Button>x</Button>), "button").attrs.class) >= 44);
  });

  it("sm is below 44px but never below the 24px floor", () => {
    for (const variant of ["primary", "secondary", "quiet"] as const) {
      const px = targetPx(only(render(<Button variant={variant} size="sm">x</Button>), "button").attrs.class);
      assert.ok(px >= 24 && px < 44, `${variant} sm = ${px}px`);
    }
  });

  it("variants are distinguishable and the caller className is appended last", () => {
    const get = (v: "primary" | "secondary") => classes(only(render(<Button variant={v} className="w-full">x</Button>), "button"));
    assert.ok(get("primary").includes("bg-brand") && get("primary").includes("text-on-brand"));
    assert.ok(get("secondary").includes("border-border-strong") && !get("secondary").includes("bg-brand"));
    assert.equal(get("primary").at(-1), "w-full");
  });

  it("has the visible focus ring and a disabled style", () => {
    const c = classes(only(render(<Button>x</Button>), "button"));
    assert.ok(c.includes("focus-ring"));
    assert.ok(c.includes("disabled:opacity-50") && c.includes("disabled:pointer-events-none"));
  });

  it("every variant has a pressed (active:) state: hover never applies on touch, so a tap needs its own feedback", () => {
    for (const variant of ["primary", "secondary", "quiet"] as const) {
      const c = classes(only(render(<Button variant={variant}>x</Button>), "button"));
      assert.ok(c.some((t) => t.startsWith("active:bg-")), `${variant}: ${c.join(" ")}`);
    }
  });

  it("never renders 'undefined' for default props", () => {
    assert.ok(!render(<Button>x</Button>).includes("undefined"));
  });
});

describe("buttonClass", () => {
  it("iconOnly gives a square target: 44px at md, 32px at sm", () => {
    assert.ok(buttonClass({ iconOnly: true }).split(" ").includes("size-target"));
    assert.ok(buttonClass({ iconOnly: true, size: "sm" }).split(" ").includes("size-8"));
    assert.equal(targetPx(buttonClass({ iconOnly: true })), 44);
    assert.equal(targetPx(buttonClass({ iconOnly: true, size: "sm" })), 32);
  });
  it("defaults to primary md", () => {
    assert.equal(buttonClass(), buttonClass({ variant: "primary", size: "md" }));
  });
});

describe("ButtonLink", () => {
  it("renders a plain <a> with the href, not a button", () => {
    const html = render(<ButtonLink href="/app">Open the map</ButtonLink>);
    const a = only(html, "a");
    assert.equal(a.attrs.href, "/app");
    assert.equal(textOf(html, a), "Open the map");
    assert.ok(!html.includes("<button"), html);
    assert.ok(!("type" in a.attrs) && !("role" in a.attrs), "no type or role on a plain link");
  });

  it("is a 44px primary target at the default size and has the focus ring", () => {
    const a = only(render(<ButtonLink href="/app">x</ButtonLink>), "a");
    assert.ok(targetPx(a.attrs.class) >= 44);
    assert.ok(classes(a).includes("focus-ring"));
  });

  it("passes native anchor attributes through and appends className", () => {
    const a = only(render(<ButtonLink href="/x" variant="secondary" target="_blank" rel="noreferrer" aria-label="Open x" className="mt-4">x</ButtonLink>), "a");
    assert.equal(a.attrs.target, "_blank");
    assert.equal(a.attrs.rel, "noreferrer");
    assert.equal(a.attrs["aria-label"], "Open x");
    assert.equal(classes(a).at(-1), "mt-4");
    assert.ok(classes(a).includes("border-border-strong"));
  });
});

// ---- 3. IconButton ----

describe("IconButton (WL-A11Y-10)", () => {
  const icon = <svg data-icon="x" />;

  it("label becomes aria-label and is not leaked as a DOM attribute", () => {
    const html = render(<IconButton label="Close">{icon}</IconButton>);
    const b = only(html, "button");
    assert.equal(b.attrs["aria-label"], "Close");
    assert.ok(!("label" in b.attrs), "label must not reach the DOM");
  });

  it("hides the icon from assistive tech: it sits inside an aria-hidden wrapper", () => {
    const html = render(<IconButton label="Close">{icon}</IconButton>);
    const wrapper = only(html, "span");
    assert.equal(wrapper.attrs["aria-hidden"], "true");
    // The icon markup sits between the wrapper's start tag and its close tag.
    const at = html.indexOf("data-icon");
    assert.ok(at >= wrapper.end && at < html.indexOf("</span>"), "the svg must be inside the aria-hidden wrapper");
  });

  it("defaults to type=button, the quiet variant, and a 44px square target", () => {
    const b = only(render(<IconButton label="Save">{icon}</IconButton>), "button");
    assert.equal(b.attrs.type, "button");
    assert.ok(classes(b).includes("size-target"));
    assert.equal(targetPx(b.attrs.class), 44);
    assert.ok(classes(b).includes("hover:bg-ink/5"), "quiet variant");
    assert.ok(classes(b).includes("focus-ring"));
  });

  it("sm stays at or above 24px", () => {
    const px = targetPx(only(render(<IconButton label="Close" size="sm">{icon}</IconButton>), "button").attrs.class);
    assert.ok(px >= 24 && px < 44, `${px}px`);
  });

  it("toggle state and other native attributes pass through", () => {
    const b = only(render(<IconButton label="Save station" aria-pressed={true} disabled className="ml-2">{icon}</IconButton>), "button");
    assert.equal(b.attrs["aria-pressed"], "true");
    assert.ok("disabled" in b.attrs);
    assert.equal(classes(b).at(-1), "ml-2");
  });
});

// ---- 4. SkipLink, VisuallyHidden, Skeleton ----

describe("SkipLink (WL-A11Y-10)", () => {
  it("defaults to #main-content with readable text", () => {
    const html = render(<SkipLink />);
    const a = only(html, "a");
    assert.equal(a.attrs.href, "#main-content");
    assert.equal(textOf(html, a), "Skip to main content");
  });

  it("accepts another target and label", () => {
    const html = render(<SkipLink href="#results">Skip to results</SkipLink>);
    assert.equal(only(html, "a").attrs.href, "#results");
    assert.equal(textOf(html, only(html, "a")), "Skip to results");
  });

  it("is off-screen until focused, but stays focusable and exposed (not display:none, aria-hidden or tabindex=-1)", () => {
    const a = only(render(<SkipLink />), "a");
    const c = classes(a);
    assert.ok(c.includes("focus:translate-y-0"), "must move into view on focus");
    assert.ok(c.includes("focus-ring"));
    for (const bad of ["hidden", "invisible", "sr-only"]) assert.ok(!c.includes(bad), `${bad} would make it unreachable or unusable`);
    assert.ok(!("aria-hidden" in a.attrs) && !("tabindex" in a.attrs));
  });
});

describe("VisuallyHidden", () => {
  it("renders its text in a span with sr-only", () => {
    const html = render(<VisuallyHidden>Loading</VisuallyHidden>);
    const span = only(html, "span");
    assert.deepEqual(classes(span), ["sr-only"]);
    assert.equal(textOf(html, span), "Loading");
  });

  it("passes other attributes through but the class always stays sr-only", () => {
    const span = only(render(<VisuallyHidden id="note">x</VisuallyHidden>), "span");
    assert.equal(span.attrs.id, "note");
    const forced = only(render(<VisuallyHidden {...({ className: "block" } as object)}>x</VisuallyHidden>), "span");
    assert.deepEqual(classes(forced), ["sr-only"], "a caller cannot un-hide it");
  });
});

describe("Skeleton", () => {
  it("is aria-hidden and empty", () => {
    const html = render(<Skeleton />);
    assert.equal(only(html, "div").attrs["aria-hidden"], "true");
    assert.equal(textOf(html, only(html, "div")), "");
  });

  it("pulses only under motion-safe (WL-A11Y-8) and takes size from className", () => {
    const c = classes(only(render(<Skeleton className="h-4 w-32" />), "div"));
    assert.ok(c.includes("motion-safe:animate-pulse"));
    assert.ok(!c.includes("animate-pulse"), "bare animate-pulse ignores prefers-reduced-motion");
    assert.ok(c.includes("h-4") && c.includes("w-32"));
    assert.ok(!render(<Skeleton />).includes("undefined"));
  });
});

// ---- Dialog and Toast: static markup only. Behaviour needs a real browser (e2e from the first consumer). ----

describe("Dialog (static markup)", () => {
  const html = render(
    <Dialog open onClose={() => {}} title="Delete account?">
      <p>Body content</p>
    </Dialog>,
  );

  it("is a native <dialog> named by its visible heading", () => {
    const dialog = only(html, "dialog");
    const h2 = only(html, "h2");
    assert.ok(dialog.attrs["aria-labelledby"], "needs aria-labelledby");
    assert.equal(h2.attrs.id, dialog.attrs["aria-labelledby"]);
    assert.equal(textOf(html, h2), "Delete account?");
  });

  it("is never rendered with the open attribute: it opens through showModal() so the page behind is inert", () => {
    assert.ok(!("open" in only(html, "dialog").attrs), html);
  });

  it("has a Close button with an accessible name, placed after the content so focus lands in the content first", () => {
    const close = only(html, "button");
    assert.equal(close.attrs["aria-label"], "Close");
    assert.equal(close.attrs.type, "button");
    assert.ok(html.indexOf("Body content") < html.indexOf('aria-label="Close"'));
  });

  it("Close is a 44px touch target: on touch it is the only way out", () => {
    const close = only(html, "button");
    assert.equal(targetPx(close.attrs.class), 44);
  });

  it("dismissible={false} renders no Close button, and the dialog is still named by its heading", () => {
    const locked = render(
      <Dialog open onClose={() => {}} title="Accept the terms" dismissible={false}>
        <p>Body content</p>
      </Dialog>,
    );
    assert.equal(startTags(locked).filter((t) => t.name === "button").length, 0, locked);
    assert.ok(!locked.includes('aria-label="Close"'));
    assert.equal(only(locked, "h2").attrs.id, only(locked, "dialog").attrs["aria-labelledby"]);
    assert.ok(locked.includes("Body content"));
    assert.ok(!("open" in only(locked, "dialog").attrs));
  });

  it("dismissible defaults to true (Close is rendered)", () => {
    assert.equal(startTags(html).filter((t) => t.name === "button").length, 1);
  });
});

describe("Toaster (static markup)", () => {
  it("always renders the polite live region, and never renders toasts on the server", () => {
    const first = toast("Link copied");
    const second = toast("Could not copy", { kind: "error" });
    assert.ok(second > first, "ids increase");
    const out = render(<Toaster />);
    assert.equal(only(out, "div").attrs["aria-live"], "polite");
    assert.ok(!out.includes("Link copied") && !out.includes("Could not copy"), "no per-request state leaks into server markup");
    dismissToast(first);
    dismissToast(second);
  });
});

// ---- 5. Source checks across src/components/ui ----

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const allFiles = readdirSync(UI_DIR);
const source = new Map(allFiles.filter((f) => /\.(tsx?|jsx?|mjs|cjs)$/.test(f)).map((f) => [f, stripComments(readFileSync(join(UI_DIR, f), "utf8"))]));
const CLIENT_FILES = ["Dialog.tsx", "Toast.tsx"];
const isClient = (code: string) => /["']use client["']/.test(code);
const serverFiles = [...source].filter(([f]) => !CLIENT_FILES.includes(f));

describe("src/components/ui source rules", () => {
  it("finds the eleven primitives (guards against the checks silently scanning nothing)", () => {
    for (const f of ["Button", "Checkbox", "Dialog", "Field", "IconButton", "Input", "Select", "Skeleton", "SkipLink", "Toast", "VisuallyHidden"]) {
      assert.ok(source.has(`${f}.tsx`), `${f}.tsx is missing`);
    }
  });

  it('only Dialog.tsx and Toast.tsx contain "use client"', () => {
    const clients = [...source].filter(([, code]) => isClient(code)).map(([f]) => f).sort();
    assert.deepEqual(clients, CLIENT_FILES);
  });

  it("server-compatible files use no React hooks", () => {
    for (const [f, code] of serverFiles) {
      assert.ok(!/\buse[A-Z]\w*\s*\(/.test(code), `${f} calls a hook`);
      assert.ok(!/import[^;]*\buse[A-Z]\w*[^;]*from\s+["']react["']/.test(code), `${f} imports a hook`);
    }
  });

  it("server-compatible files import no lucide-react and no client file, and define no event handlers", () => {
    for (const [f, code] of serverFiles) {
      assert.ok(!/lucide-react/.test(code), `${f} imports lucide-react (its Icon is client code)`);
      assert.ok(!/from\s+["']\.\/(Dialog|Toast)["']/.test(code), `${f} imports a client component`);
      assert.ok(!/\bon[A-Z]\w+=\{/.test(code), `${f} attaches an event handler, which needs "use client"`);
    }
  });

  it("has no index barrel (a barrel would pull Dialog/Toast client code into every importer)", () => {
    assert.deepEqual(allFiles.filter((f) => /^index\./.test(f)), []);
    for (const ext of ["ts", "tsx", "js", "jsx", "mjs"]) assert.ok(!existsSync(join(UI_DIR, `index.${ext}`)));
  });

  it("uses no raw colours (hex, rgb, hsl, oklch): colour comes from the tokens", () => {
    for (const [f, code] of source) {
      assert.ok(!/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/.test(code), `${f} has a hex colour`);
      assert.ok(!/\b(?:rgba?|hsla?|oklch|oklab)\(/.test(code), `${f} has a functional colour`);
    }
  });

  it("uses no legacy classes (glass, glow) and no raw Tailwind palette colours (bg-slate-*, text-white, ...)", () => {
    const palette = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
    for (const [f, code] of source) {
      assert.ok(!/(?:^|[\s"'`:])(?:glass|glow)(?:-[\w-]+)?(?![\w-])/.test(code), `${f} uses a legacy glass/glow class`);
      assert.ok(!new RegExp(`\\b(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline|shadow|accent|placeholder)-(?:${palette})-\\d`).test(code), `${f} uses a palette colour`);
      assert.ok(!/\b(?:bg|text|border|ring|fill|stroke)-(?:white|black)\b/.test(code), `${f} uses white/black instead of a token`);
    }
  });

  it("builds no Tailwind class from a template (bg-status-${x} is never generated)", () => {
    const utility = "bg|text|border|ring|fill|stroke|accent|outline|shadow|rounded|size|gap|min-h|min-w|max-h|max-w|[whpm][xytblrse]?";
    for (const [f, code] of source) {
      assert.ok(!/status-\$\{/.test(code), `${f} builds a status class from a template`);
      assert.ok(!new RegExp(`\\b(?:${utility})-(?:[\\w.]+-)*\\$\\{`).test(code), `${f} builds a utility class from a template`);
      assert.ok(!/["'`]\s*(?:bg|text|border)-status-["'`]\s*\+/.test(code), `${f} concatenates a status class`);
    }
  });

  it("every animation is motion-safe (WL-A11Y-8)", () => {
    for (const [f, code] of source) {
      for (const m of code.matchAll(/(\S*)animate-[\w-]+/g)) assert.ok(m[1].endsWith("motion-safe:"), `${f}: ${m[0]} must be prefixed with motion-safe:`);
    }
  });

  it("blocks no paste and switches autocomplete off nowhere (WL-A11Y-6 / WCAG 3.3.8)", () => {
    for (const [f, code] of source) {
      assert.ok(!/\bon(?:Paste|Copy|Cut|Drop)\b/.test(code), `${f} handles paste/copy/cut/drop`);
      assert.ok(!/autoComplete=["']off["']/.test(code), `${f} turns autocomplete off`);
    }
  });

  it("every interactive control opts into the focus ring, and the ring is at least 2px (WL-A11Y-4)", () => {
    assert.ok(/@utility focus-ring\s*\{[^}]*&:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring-width\)\s+solid/.test(css), "focus-ring utility");
    assert.ok(parseFloat(css.match(/--focus-ring-width:\s*([\d.]+)px/)?.[1] ?? "0") >= 2, "--focus-ring-width must be at least 2px");
    for (const f of ["Button.tsx", "Checkbox.tsx", "Field.tsx", "SkipLink.tsx"]) {
      assert.ok(/focus-ring/.test(source.get(f) ?? ""), `${f} has no focus-ring class`);
    }
  });

  it("every token-based utility resolves to a variable in globals.css (Tailwind silently drops unknown classes)", () => {
    const theme = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const builtin: Record<string, string[]> = {
      rounded: ["none", "full"],
      shadow: ["none"],
      text: ["left", "center", "right", "start", "end", "nowrap", "balance", "pretty", "ellipsis", "transparent", "current", "inherit"],
      color: ["transparent", "current", "inherit"],
    };
    const ok = (family: string, name: string) =>
      family === "rounded" ? builtin.rounded.includes(name) || theme.has(`--radius-${name}`)
      : family === "shadow" ? builtin.shadow.includes(name) || theme.has(`--shadow-${name}`)
      : family === "text" ? builtin.text.includes(name) || theme.has(`--text-${name}`) || theme.has(`--color-${name}`)
      : builtin.color.includes(name) || theme.has(`--color-${name}`);

    const unresolved: string[] = [];
    let checked = 0;
    for (const [f, code] of source) {
      for (const lit of code.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
        for (const raw of (lit[1] ?? lit[2]).replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) {
          const token = raw.replace(/^(?:(?:\[[^\]]+\]|[a-z0-9-]+):)+/, "");
          const m = token.match(/^(rounded|shadow|bg|text|border|accent|fill|stroke)-([a-z][a-z-]*)(?:\/\d+)?$/);
          if (!m) continue;
          checked++;
          if (!ok(m[1], m[2])) unresolved.push(`${f}: ${raw}`);
        }
      }
    }
    assert.ok(checked > 20, `only ${checked} token classes found; the scan is broken`);
    assert.deepEqual(unresolved, [], "classes with no matching theme variable (typo, or a Tailwind built-in to add to this test's allow-list)");
  });
});
