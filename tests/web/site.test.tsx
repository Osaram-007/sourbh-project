// Marketing site chrome (WEB-A05): src/components/site/** and the (marketing) layout. Criteria: WL-LAND-3 (header nav),
// WL-LAND-10 (footer), WL-SEO-4 and WL-A11Y-10 (landmarks, skip link, names), G8 (a null legal fact fails the production
// build, now for every marketing route), plus the two design rules that cost bytes when broken: no client JS, and no
// prefetching link to /app. Markup via renderToStaticMarkup plus source checks; no DOM. Behaviour in a real browser
// (menu, focus, overflow, fc_hint) is in site.e2e.ts.
// Nothing here pins which founder facts are filled today: tests that need a value set it on the exported `legal` object
// and restore it.
// Run from the repo root: npx tsx --test tests/web/site.test.tsx
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Fact, markerClass } from "../../src/components/site/Fact";
import { SiteFooter } from "../../src/components/site/Footer";
import { SiteHeader } from "../../src/components/site/Header";
import { Logo } from "../../src/components/site/Logo";
import { FIND_A_CHARGER, FOOTER_GROUPS, HEADER_NAV, LOG_IN, OPEN_THE_MAP } from "../../src/components/site/nav";
import { legal, pendingLegalItems, type LegalSlug } from "../../src/content/legal";

const ROOT = process.cwd();
const render = (el: ReactElement) => renderToStaticMarkup(el);
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const anchors = (html: string) =>
  [...html.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ href: m[1].replace(/&amp;/g, "&"), label: text(m[2]) }));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}
const read = (p: string) => readFileSync(p, "utf8");
const SITE_DIR = resolve(ROOT, "src/components/site");
const MARKETING_DIR = resolve(ROOT, "src/app/(marketing)");

/** Run `fn` with the shipped legal config temporarily replaced, whatever it holds today. */
function withLegal(patch: { name?: string | null; address?: string | null }, fn: () => void) {
  const before = { name: legal.entity.name, address: legal.entity.registeredAddress };
  if ("name" in patch) legal.entity.name = patch.name ?? null;
  if ("address" in patch) legal.entity.registeredAddress = patch.address ?? null;
  try {
    fn();
  } finally {
    legal.entity.name = before.name;
    legal.entity.registeredAddress = before.address;
  }
}

describe("WL-LAND-3: header navigation", () => {
  it("is exactly Find Chargers, Vehicles, For Businesses, For Charging Operators, About, in that order", () => {
    assert.deepEqual(
      HEADER_NAV.map((l) => l.label),
      ["Find Chargers", "Vehicles", "For Businesses", "For Charging Operators", "About"],
    );
  });

  it("Vehicles opens the in-app vehicle picker; Find Chargers opens the map", () => {
    const by = Object.fromEntries(HEADER_NAV.map((l) => [l.label, l.href]));
    assert.equal(by["Vehicles"], "/app?vehicle=pick");
    assert.equal(by["Find Chargers"], "/app");
  });

  it("has Log in and Find a Charger beside it, and 'Open the map' as the logged-in label", () => {
    assert.equal(LOG_IN.label, "Log in");
    assert.equal(new URL(LOG_IN.href, "http://x").pathname, "/login");
    assert.equal(FIND_A_CHARGER.label, "Find a Charger");
    assert.equal(FIND_A_CHARGER.href, "/app");
    assert.equal(OPEN_THE_MAP.label, "Open the map");
    assert.equal(OPEN_THE_MAP.href, "/app");
  });

  it("names no Trip Planner or trip feature anywhere in the header or footer links", () => {
    const labels = [...HEADER_NAV, LOG_IN, OPEN_THE_MAP, FIND_A_CHARGER, ...FOOTER_GROUPS.flatMap((g) => g.links)].map((l) => l.label);
    for (const label of labels) assert.doesNotMatch(label, /trip|plan/i, label);
  });

  it("the rendered header carries the nav twice (inline and menu) with the same links, plus both account labels", () => {
    const html = render(<SiteHeader />);
    const primary = /<nav aria-label="Primary"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1];
    const menu = /<nav aria-label="Mobile menu"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1];
    assert.ok(primary && menu, "both navs are rendered, one shown per breakpoint");
    const want = HEADER_NAV.map((l) => ({ href: l.href, label: l.label }));
    assert.deepEqual(anchors(primary), want);
    assert.deepEqual(anchors(menu).slice(0, want.length), want);
    // Menu tail: Log in / Open the map / Find a Charger.
    assert.deepEqual(anchors(menu).slice(want.length).map((a) => a.label), ["Log in", "Open the map", "Find a Charger"]);
  });
});

describe("header design rules", () => {
  const html = render(<SiteHeader />);

  it("the mobile menu is a native <details> with a <summary>, never a dialog (JS budget)", () => {
    assert.match(html, /<details id="site-menu"[^>]*>\s*<summary/);
    assert.doesNotMatch(html, /<dialog|role="dialog"|aria-modal/);
  });

  it("is not sticky or fixed (WCAG 2.4.11: a sticky header can hide a focused element)", () => {
    const header = /<header\b[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";
    assert.ok(header, "no <header>");
    assert.doesNotMatch(header, /\b(sticky|fixed)\b|-(sticky|fixed)\b/);
  });

  it("the account label is a pure-CSS swap: the inline script comes before the header and both labels are in the HTML", () => {
    assert.ok(html.indexOf("<script>") >= 0 && html.indexOf("<script>") < html.indexOf("<header"), "script must run before the header paints");
    assert.equal((html.match(/<script/g) ?? []).length, 1);
    assert.match(html, /fc_hint=1/);
    assert.match(html, />Log in</);
    assert.match(html, />Open the map</);
    // The Log in link is the one hidden by the hint, and "Open the map" is the one revealed by it.
    assert.match(/<a[^>]*href="\/login[^"]*"[^>]*>/.exec(html)?.[0] ?? "", /html\[data-fc-hint\]_&amp;\]:hidden/);
    assert.match(/<span class="([^"]*)"><a[^>]*>Open the map/.exec(html)?.[1] ?? "", /hidden .*html\[data-fc-hint\]_&amp;\]:contents/);
  });

  it("the cookie test matches only the exact fc_hint=1 cookie", () => {
    const src = /\/\(\^\|; \)fc_hint=1\(;\|\$\)\//.exec(html);
    assert.ok(src, "cookie regex not found in the inline script");
    const re = /(^|; )fc_hint=1(;|$)/;
    for (const yes of ["fc_hint=1", "a=b; fc_hint=1", "fc_hint=1; a=b", "a=b; fc_hint=1; c=d"]) assert.ok(re.test(yes), yes);
    for (const no of ["", "fc_hint=0", "fc_hint=10", "xfc_hint=1", "a=fc_hint=1", "fc_hint=", "FC_HINT=1"]) assert.ok(!re.test(no), no);
  });

  it("the inline nav shows from xl (1280px) and the menu button below it", () => {
    assert.match(/<nav aria-label="Primary"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "", /\bhidden\b[^"]*\bxl:flex\b/);
    assert.match(/<details id="site-menu"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "", /\bxl:hidden\b/);
    const css = read(resolve(ROOT, "src/app/globals.css"));
    assert.doesNotMatch(css, /--breakpoint-xl/, "xl was redefined, so 1280px is no longer the switch point");
  });

  it("every icon is aria-hidden, and the menu button's name is its visible text (WL-A11Y-10)", () => {
    for (const svg of html.match(/<svg\b[^>]*>/g) ?? []) assert.match(svg, /aria-hidden="true"/, svg);
    assert.ok((html.match(/<svg\b/g) ?? []).length >= 3, "control: the header has icons");
    assert.doesNotMatch(html, /<img\b/);
    const summary = /<summary[\s\S]*?<\/summary>/.exec(html)![0];
    assert.match(summary, />Menu</);
    assert.match(summary, />Close menu</);
    assert.doesNotMatch(summary, /aria-label=/, "an aria-label would override the visible text");
  });

  it("the navs have distinct names", () => {
    const names = [...html.matchAll(/<nav aria-label="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(names, ["Primary", "Mobile menu"]);
    assert.deepEqual(
      [...render(<SiteFooter />).matchAll(/<nav aria-label="([^"]+)"/g)].map((m) => m[1]),
      ["Footer"],
    );
  });

  it("the logo is decorative art next to the name, so the link name is 'FullCharge'", () => {
    const logo = render(<Logo />);
    assert.match(logo, /<svg[^>]*aria-hidden="true"/);
    assert.equal(text(logo), "FullCharge");
  });
});

describe("WL-LAND-10: footer", () => {
  const html = render(<SiteFooter />);
  const links = anchors(html);
  const find = (re: RegExp) => links.filter((l) => re.test(l.label));

  it("links privacy, terms, disclaimer, attributions, contact and grievance officer", () => {
    for (const re of [/privacy/i, /terms/i, /disclaimer/i, /attribution/i, /contact/i, /grievance/i]) {
      assert.ok(find(re).length >= 1, `no footer link matching ${re}`);
    }
  });

  it("the four legal links point at the paths held in legal.ts", () => {
    const slugs: LegalSlug[] = ["privacy", "terms", "disclaimer", "attributions", "delete-account"];
    for (const slug of slugs) {
      const doc = legal.documents[slug];
      const hit = links.find((l) => l.href === doc.path);
      assert.ok(hit, `footer has no link to ${doc.path}`);
    }
  });

  it("every link has a visible label and an href, and no href repeats", () => {
    assert.ok(links.length >= 10);
    for (const l of links) assert.ok(l.label.length > 0 && l.href.length > 0, JSON.stringify(l));
    const hrefs = FOOTER_GROUPS.flatMap((g) => g.links.map((l) => l.href));
    assert.equal(new Set(hrefs).size, hrefs.length, "React key collision in the footer lists");
  });

  it("footer group titles are h2 (the page keeps its one h1) and there is no h1", () => {
    assert.doesNotMatch(html, /<h1[\s>]/);
    assert.deepEqual([...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]), FOOTER_GROUPS.map((g) => g.title));
  });

  it("with no entity facts (null) it shows 'To be confirmed', never a guess, and the copyright falls back to the product name", () => {
    withLegal({ name: null, address: null }, () => {
      const out = render(<SiteFooter />);
      assert.equal((out.match(/To be confirmed/g) ?? []).length, 2, "entity and address each show the marker");
      assert.match(text(out), /Legal entity: To be confirmed/);
      assert.match(text(out), /Registered address: To be confirmed/);
      assert.match(text(out), /© FullCharge$/);
      assert.doesNotMatch(out, /null|undefined/);
    });
  });

  it("with entity facts it prints them and the copyright names the entity; no year", () => {
    withLegal({ name: "Acme Charging Pvt Ltd", address: "1 Test Lane\nPune 411001" }, () => {
      const out = render(<SiteFooter />);
      const t = text(out);
      assert.match(t, /Legal entity: Acme Charging Pvt Ltd/);
      assert.ok(out.includes("1 Test Lane\nPune 411001"), "address newline kept (rendered with whitespace-pre-line)");
      assert.match(t, /© Acme Charging Pvt Ltd$/);
      assert.doesNotMatch(out, /To be confirmed/);
      assert.doesNotMatch(/<p>&copy;[\s\S]*?<\/p>|<p>©[\s\S]*?<\/p>/.exec(out)?.[0] ?? "", /\b(19|20)\d{2}\b/, "a build-time year goes stale");
    });
  });

  it("a blank (whitespace-only) entity name counts as missing, as in the production gate", () => {
    withLegal({ name: "   ", address: "  " }, () => {
      const out = render(<SiteFooter />);
      assert.equal((out.match(/To be confirmed/g) ?? []).length, 2);
      assert.match(text(out), /© FullCharge$/);
    });
  });

  it("escapes founder text (it is data, not markup)", () => {
    withLegal({ name: 'A & <b>B</b> "Q"', address: null }, () => {
      const out = render(<SiteFooter />);
      assert.doesNotMatch(out, /<b>B<\/b>/);
      assert.match(out, /A &amp; &lt;b&gt;B&lt;\/b&gt; &quot;Q&quot;/);
    });
  });

  it("renders no email address or mailto link of its own", () => {
    assert.doesNotMatch(html, /mailto:/);
  });
});

describe("Fact: what a legal field renders (null handling moved out of the legal pages)", () => {
  it("null shows the dashed 'To be confirmed' marker", () => {
    const out = render(<Fact value={null} />);
    assert.equal(out, `<span class="${markerClass}">To be confirmed</span>`);
    assert.match(markerClass, /border-dashed/);
  });

  it("an empty or whitespace-only string is treated as missing", () => {
    for (const v of ["", " ", "\n\t "]) {
      assert.match(render(<Fact value={v} />), /To be confirmed/, JSON.stringify(v));
      assert.match(render(<Fact value={v} email />), /To be confirmed/, JSON.stringify(v));
    }
  });

  it("a null or blank email is the marker, not a mailto link", () => {
    for (const v of [null, "", "  "]) assert.doesNotMatch(render(<Fact value={v} email />), /<a\b|mailto/, String(v));
  });

  it("a set value renders as plain text; an email becomes a mailto link", () => {
    assert.equal(render(<Fact value="Acme Pvt Ltd" />), "Acme Pvt Ltd");
    const a = render(<Fact value="help@acme.example" email />);
    assert.match(a, /^<a href="mailto:help@acme\.example"[^>]*>help@acme\.example<\/a>$/);
    assert.equal(render(<Fact value="help@acme.example" />), "help@acme.example", "without the email flag it is not a link");
  });

  it("text that looks falsy is still text", () => {
    assert.equal(render(<Fact value="0" />), "0");
  });

  it("escapes text and the mailto attribute", () => {
    assert.equal(render(<Fact value="<script>x</script>" />), "&lt;script&gt;x&lt;/script&gt;");
    assert.doesNotMatch(render(<Fact value={'a"onmouseover="x'} email />), /href="mailto:a"onmouseover/);
  });

  it("the legal pages use this Fact, not a copy of their own", () => {
    const doc = read(resolve(MARKETING_DIR, "legal/_components/LegalDocument.tsx"));
    assert.match(doc, /from "@\/components\/site\/Fact"/);
    assert.doesNotMatch(doc, /function Fact\b|const Fact\b/);
    assert.match(read(resolve(MARKETING_DIR, "legal/delete-account/page.tsx")), /from "@\/components\/site\/Fact"/);
  });
});

describe("marketing layout", () => {
  const layout = read(resolve(MARKETING_DIR, "layout.tsx"));

  it("renders skip link, header, main#main-content[tabindex=-1] and footer, in that order", () => {
    const order = ["<SkipLink", "<SiteHeader", "<main", "<SiteFooter"].map((s) => layout.indexOf(s));
    assert.ok(order.every((i) => i >= 0), "something is missing from the layout");
    assert.deepEqual([...order].sort((a, b) => a - b), order, "wrong order: the skip link must be the first focusable element");
    const main = /<main\b[^>]*>/.exec(layout)![0];
    assert.match(main, /id="main-content"/);
    assert.match(main, /tabIndex=\{-1\}/);
    assert.equal((layout.match(/<main\b/g) ?? []).length, 1);
  });

  it("the skip link target is the id on <main>", () => {
    assert.match(read(resolve(ROOT, "src/components/ui/SkipLink.tsx")), /href = "#main-content"/);
  });

  it("sets its own light surface (body is still dark until WEB-B14)", () => {
    assert.match(layout, /bg-surface text-ink/);
  });

  it("sets no robots of its own (WL-SEO-8) and reads no session, cookies or headers (static group)", () => {
    const code = layout.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ""); // comments name these on purpose
    assert.doesNotMatch(code, /robots|cookies\(|headers\(|getServerSession|auth\(/);
  });

  it("no legal page renders a second <main> or a second skip link (the layout owns them)", () => {
    for (const file of walk(MARKETING_DIR).filter((f) => !f.endsWith("layout.tsx"))) {
      const src = read(file);
      assert.doesNotMatch(src, /<main\b/, relative(ROOT, file));
      assert.doesNotMatch(src, /<SkipLink/, relative(ROOT, file));
    }
  });
});

describe("no client JS from the chrome (WL-PERF-2: / has under 1 KB of budget left)", () => {
  const files = walk(SITE_DIR);

  it("control: the scan sees the site components", () => {
    assert.ok(files.length >= 5, files.join(", "));
  });

  it('no "use client" in src/components/site/** or the marketing layout', () => {
    for (const f of [...files, resolve(MARKETING_DIR, "layout.tsx")]) {
      assert.doesNotMatch(read(f), /^\s*(["'])use client\1/m, relative(ROOT, f));
    }
  });

  it("no hooks, lucide-react, vaul or client libraries are imported by the chrome", () => {
    for (const f of files) {
      const src = read(f);
      assert.doesNotMatch(src, /from "(lucide-react|vaul|next-auth[^"]*|@tanstack[^"]*|zustand[^"]*|firebase[^"]*|react)"/, relative(ROOT, f));
      assert.doesNotMatch(src, /\buse(State|Effect|Ref|Router|Session|Store|Query)\b/, relative(ROOT, f));
    }
  });

  it("nothing marked 'use client' imports src/content/legal.ts (its text would land in client JS)", () => {
    for (const f of walk(resolve(ROOT, "src"))) {
      const src = read(f);
      if (/^\s*(["'])use client\1/m.test(src)) assert.doesNotMatch(src, /content\/legal/, relative(ROOT, f));
    }
  });
});

describe("links from marketing pages to /app are plain <a> or prefetch={false}", () => {
  // Next prefetches a <Link> to a static route once it scrolls into view, pulling ~54 KB of NextAuth, React Query and
  // vaul onto the landing visit. e2e (site.e2e.ts) checks the result; this is the source-level guard.
  const files = [...walk(SITE_DIR), ...walk(MARKETING_DIR)];

  it("every <Link> under the chrome and the marketing group has prefetch={false}", () => {
    let seen = 0;
    for (const f of files) {
      for (const m of read(f).matchAll(/<Link\b[^>]*>/g)) {
        seen++;
        assert.match(m[0], /prefetch=\{false\}/, `${relative(ROOT, f)}: ${m[0]}`);
      }
    }
    // No page uses <Link> today (the marketing group is plain <a>, ADR-0016), so the control is synthetic: the scan's own regex must see one.
    assert.ok(/<Link\b[^>]*>/.test('<Link href="/x" prefetch={false}>'), "control: the <Link> regex works");
    assert.ok(files.length > 10, `control: the scan read ${files.length} real files`);
    void seen;
  });

  it("no router.prefetch and no <Link prefetch> variants that turn it back on", () => {
    for (const f of files) {
      const src = read(f);
      assert.doesNotMatch(src, /router\.prefetch|prefetch=\{true\}|prefetch="(true|auto)"|\bprefetch\b(?!=\{false\})(?=[\s/>])/, relative(ROOT, f));
    }
  });

  it("the header and footer links are rendered as plain <a> (no next/link import)", () => {
    for (const f of walk(SITE_DIR)) assert.doesNotMatch(read(f), /next\/link/, relative(ROOT, f));
  });
});

describe("G8: a null legal fact fails the production build for every marketing route", () => {
  // The footer imports legal.ts, the layout imports the footer, and legal.ts throws on import under APP_ENV=production.
  // Run in fresh processes (the static import above is cached). The real `next build` check is in site-gate.e2e.ts.
  const load = (target: string, appEnv?: string) => {
    const env = { ...process.env };
    delete env.APP_ENV;
    if (appEnv) env.APP_ENV = appEnv;
    return spawnSync(process.execPath, ["--import", "tsx", "-e", `import(${JSON.stringify(target)})`], { cwd: ROOT, env, encoding: "utf8" });
  };
  const pending = pendingLegalItems(legal);

  for (const target of ["./src/components/site/Footer.tsx", "./src/app/(marketing)/layout.tsx"]) {
    it(`control: ${target} imports cleanly with APP_ENV unset`, () => {
      const r = load(target);
      assert.equal(r.status, 0, r.stderr);
    });

    it(`${target} throws the missing-legal-config error under APP_ENV=production`, { skip: pending.length === 0 }, () => {
      const r = load(target, "production");
      assert.notEqual(r.status, 0, "importing the footer in production must fail while legal values are missing");
      assert.match(r.stderr, /Production build blocked/);
      for (const item of pending) assert.ok(r.stderr.includes(item), `stderr does not name: ${item}`);
      assert.doesNotMatch(r.stderr, /Cannot find module|SyntaxError|ERR_MODULE_NOT_FOUND|is not a function/, "failed for a reason other than the gate");
    });
  }

  it("the layout reaches legal.ts only through the footer (so every marketing route is covered)", () => {
    assert.match(read(resolve(SITE_DIR, "Footer.tsx")), /from "@\/content\/legal"/);
    assert.match(read(resolve(MARKETING_DIR, "layout.tsx")), /from "@\/components\/site\/Footer"/);
  });
});
