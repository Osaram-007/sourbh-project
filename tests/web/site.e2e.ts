import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { Browser, Page } from "playwright";
import { legal, type LegalSlug } from "../../src/content/legal";
import { launchBrowser, openPage, VIEWPORTS, type ViewportName } from "./helpers/browser";
import { startServer, type TestServer } from "./helpers/server";
import { fetchDoc, MARKERS } from "./routes-support";

// WEB-A05: the marketing site chrome (header, footer, skip link, layout) in a real browser.
// Criteria: WL-LAND-3 (header nav), WL-LAND-10 (footer), WL-SEO-4 (one h1, landmarks), WL-A11Y-4/5/10 (focus, targets,
// names, skip link), WL-PERF-2 (no prefetch of /app, no client JS from the chrome), ADR-0017 (fc_hint is an inline script
// plus CSS), 360 / 768 / 1280 px layout. Unit-level checks (nav data, Fact, Footer with edited legal values, source scans,
// G8 import gate) are in site.test.tsx; the real production-build gate is in site-gate.e2e.ts.
// Pages that are not built yet (/for-businesses, /for-operators, /about: WEB-B03; /login: WEB-B06) are never requested.
// Nothing here pins which founder facts are filled today: expectations are computed from src/content/legal.ts.
// Run: npx tsx --test --test-concurrency=1 tests/web/site.e2e.ts   (first run: npx playwright install chromium)
delete process.env.SITE_NOINDEX; // closed default; the chrome does not depend on it

const T = { timeout: 90_000 };
const SLUGS: LegalSlug[] = ["privacy", "terms", "disclaimer", "attributions", "delete-account"];
const PAGES = ["/", ...SLUGS.map((s) => `/legal/${s}`)];
const NAV = ["Find Chargers", "Vehicles", "For Businesses", "For Charging Operators", "About"];
const NAV_HREFS = ["/app", "/app?vehicle=pick", "/for-businesses", "/for-operators", "/about"];
let server: TestServer;
let browser: Browser;

before(async () => {
  server = await startServer();
  browser = await launchBrowser();
}, { timeout: 12 * 60_000 });

after(async () => {
  await browser?.close();
  await server?.stop();
});

const origin = () => new URL(server.baseUrl).origin;
const noScripts = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/g, " ");

/** Open `p` with no off-origin traffic. `hint` sets the fc_hint cookie before the first request. */
async function visit(vp: ViewportName, p: string, opts: { hint?: string | false; size?: { width: number; height: number } } = {}) {
  const o = await openPage(browser, vp);
  await o.page.route((u) => u.protocol.startsWith("http") && u.origin !== origin(), (r) => r.abort());
  if (opts.size) await o.page.setViewportSize(opts.size);
  if (opts.hint) await o.page.context().addCookies([{ name: "fc_hint", value: opts.hint, url: server.baseUrl }]);
  const res = await o.page.goto(server.baseUrl + p, { waitUntil: "load" });
  assert.equal(res!.status(), 200, p);
  return o;
}

interface Link {
  label: string;
  href: string | null;
}

/** Visible links under `scope` (checkVisibility: display:none ancestors count as hidden, display:contents does not). */
const visibleLinks = (page: Page, scope: string): Promise<Link[]> =>
  page.evaluate(
    (sel) =>
      [...document.querySelectorAll(`${sel} a`)]
        .filter((a) => a.checkVisibility({ checkVisibilityCSS: true }))
        .map((a) => ({ label: (a.textContent ?? "").replace(/\s+/g, " ").trim(), href: a.getAttribute("href") })),
    scope,
  );

const menuOpen = (page: Page) => page.evaluate(() => (document.getElementById("site-menu") as HTMLDetailsElement).open);
const focusInfo = (page: Page) =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement;
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return {
      tag: e.tagName,
      id: e.id,
      label: (e.innerText ?? e.textContent ?? "").replace(/\s+/g, " ").trim(),
      outlineStyle: cs.outlineStyle,
      outlineWidth: parseFloat(cs.outlineWidth),
      rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
    };
  });

const missing = (v: string | null) => v === null || v.trim() === "";

// ---------------------------------------------------------------------------------------------------------------
describe("WL-LAND-3: header navigation", () => {
  const EXPECT_DESKTOP = ["FullCharge", ...NAV, "Log in", "Find a Charger"];

  test("1280 px: logo, the five links in order, Log in, Find a Charger; nothing else; no Trip Planner", T, async () => {
    const { page, close } = await visit("desktop", "/");
    try {
      const links = await visibleLinks(page, "header");
      assert.deepEqual(links.map((l) => l.label), EXPECT_DESKTOP);
      const nav = await visibleLinks(page, 'header nav[aria-label="Primary"]');
      assert.deepEqual(nav.map((l) => l.label), NAV);
      assert.deepEqual(nav.map((l) => l.href), NAV_HREFS);
      assert.equal(links.find((l) => l.label === "Find a Charger")!.href, "/app");
      assert.equal(links[0].href, "/", "the logo goes home");
      assert.equal(new URL(links.find((l) => l.label === "Log in")!.href!, "http://x").pathname, "/login");
      assert.doesNotMatch(await page.locator("header").innerText(), /trip|plan/i);
      // The menu button belongs to the narrow layout only.
      assert.equal(await page.locator("header summary").isVisible(), false);
    } finally {
      await close();
    }
  });

  for (const [name, vp] of [["360", "mobile"], ["768", "tablet"]] as const) {
    test(`${name} px: only the logo and a Menu button; the same links appear when the menu opens`, T, async () => {
      const { page, close } = await visit(vp, "/");
      try {
        assert.deepEqual((await visibleLinks(page, "header")).map((l) => l.label), ["FullCharge"]);
        const summary = page.locator("header summary");
        assert.equal(await summary.isVisible(), true);
        assert.equal((await summary.innerText()).trim(), "Menu");
        await summary.click();
        const menu = await visibleLinks(page, 'header nav[aria-label="Mobile menu"]');
        assert.deepEqual(menu.map((l) => l.label), [...NAV, "Log in", "Find a Charger"]);
        assert.deepEqual(menu.slice(0, 5).map((l) => l.href), NAV_HREFS);
      } finally {
        await close();
      }
    });
  }

  test("the inline nav switches at 1280 px: 1279 px still gets the menu", T, async () => {
    for (const [width, inline] of [[1279, false], [1024, false], [1280, true]] as const) {
      const { page, close } = await visit("desktop", "/", { size: { width, height: 800 } });
      try {
        assert.equal(await page.locator('header nav[aria-label="Primary"]').isVisible(), inline, `${width}px: inline nav`);
        assert.equal(await page.locator("header summary").isVisible(), !inline, `${width}px: menu button`);
      } finally {
        await close();
      }
    }
  });

  test("Vehicles links to /app?vehicle=pick in the header, the menu and the footer", T, async () => {
    for (const vp of ["desktop", "mobile"] as const) {
      const { page, close } = await visit(vp, "/");
      try {
        if (vp === "mobile") await page.locator("header summary").click();
        const header = (await visibleLinks(page, "header")).filter((l) => l.label === "Vehicles");
        const footer = (await visibleLinks(page, "footer")).filter((l) => l.label === "Vehicles");
        assert.deepEqual(header.map((l) => l.href), ["/app?vehicle=pick"], vp);
        assert.deepEqual(footer.map((l) => l.href), ["/app?vehicle=pick"], vp);
      } finally {
        await close();
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("ADR-0017: the fc_hint cookie swaps Log in for Open the map (inline script + CSS, not an island)", () => {
  const labels = async (page: Page, scope: string) => (await visibleLinks(page, scope)).map((l) => l.label);

  test("no cookie: Log in is shown, Open the map is not, and <html> has no data-fc-hint", T, async () => {
    for (const vp of ["desktop", "mobile"] as const) {
      const { page, close } = await visit(vp, "/");
      try {
        if (vp === "mobile") await page.locator("header summary").click();
        const got = await labels(page, "header");
        assert.ok(got.includes("Log in"), vp);
        assert.ok(!got.includes("Open the map"), vp);
        assert.equal(await page.evaluate(() => document.documentElement.hasAttribute("data-fc-hint")), false);
      } finally {
        await close();
      }
    }
  });

  test("fc_hint=1: Open the map (to /app) replaces Log in, in the inline nav and in the menu, on every marketing page", T, async () => {
    for (const [vp, p] of [["desktop", "/"], ["mobile", "/"], ["desktop", "/legal/privacy"], ["mobile", "/legal/terms"]] as const) {
      const { page, close } = await visit(vp, p, { hint: "1" });
      try {
        if (vp === "mobile") await page.locator("header summary").click();
        const links = await visibleLinks(page, "header");
        assert.ok(!links.some((l) => l.label === "Log in"), `${vp} ${p}: Log in still visible`);
        const open = links.filter((l) => l.label === "Open the map");
        assert.equal(open.length, 1, `${vp} ${p}: exactly one Open the map`);
        assert.equal(open[0].href, "/app");
        assert.ok(links.some((l) => l.label === "Find a Charger"), "Find a Charger stays");
        assert.equal(await page.evaluate(() => document.documentElement.hasAttribute("data-fc-hint")), true);
      } finally {
        await close();
      }
    }
  });

  test("only the exact cookie value 1 counts (fc_hint=0, 10, empty all keep Log in)", T, async () => {
    for (const value of ["0", "10", "true", "11"]) {
      const { page, close } = await visit("desktop", "/", { hint: value });
      try {
        const got = await labels(page, "header");
        assert.ok(got.includes("Log in") && !got.includes("Open the map"), `fc_hint=${value}`);
      } finally {
        await close();
      }
    }
    // A cookie that merely ends in the name must not match either.
    const o = await openPage(browser, "desktop");
    try {
      await o.page.context().addCookies([{ name: "xfc_hint", value: "1", url: server.baseUrl }]);
      await o.page.goto(server.baseUrl + "/", { waitUntil: "load" });
      assert.ok((await labels(o.page, "header")).includes("Log in"));
    } finally {
      await o.close();
    }
  });

  test("the page is static: the HTML is identical with and without the cookie, and carries Log in for crawlers", T, async () => {
    const anon = await fetchDoc(server.baseUrl, "/");
    const hinted = await fetchDoc(server.baseUrl, "/", { cookie: "fc_hint=1" });
    assert.equal(hinted.html, anon.html);
    assert.match(noScripts(anon.html), />Log in</);
    assert.doesNotMatch(anon.html, /<html[^>]*data-fc-hint/);
  });

  test("with JavaScript off the static default (Log in) shows and nothing breaks", T, async () => {
    const context = await browser.newContext({ viewport: VIEWPORTS.desktop, javaScriptEnabled: false });
    try {
      await context.addCookies([{ name: "fc_hint", value: "1", url: server.baseUrl }]);
      const page = await context.newPage();
      await page.route((u) => u.protocol.startsWith("http") && u.origin !== origin(), (r) => r.abort());
      await page.goto(server.baseUrl + "/", { waitUntil: "load" });
      assert.ok((await visibleLinks(page, "header")).some((l) => l.label === "Log in"));
    } finally {
      await context.close();
    }
  });

  test("the hint is not in any JS file the page loads (0 bytes of first-load JS)", T, async () => {
    const { page, close } = await openPage(browser, "desktop");
    try {
      const scripts: string[] = [];
      page.on("response", async (r) => {
        if (r.request().resourceType() === "script" && r.ok()) scripts.push(await r.text().catch(() => ""));
      });
      await page.route((u) => u.protocol.startsWith("http") && u.origin !== origin(), (r) => r.abort());
      await page.route((u) => u.searchParams.has("_rsc"), (r) => r.abort());
      await page.goto(server.baseUrl + "/", { waitUntil: "load" });
      await page.waitForLoadState("networkidle");
      assert.ok(scripts.length >= 3, "control: the page loaded its framework scripts");
      assert.ok(!scripts.some((s) => s.includes("fc_hint") || s.includes("site-menu")), "header logic leaked into a client bundle");
    } finally {
      await close();
    }
  });

  test("the chrome is not in the page's client-reference manifest (no client component ships for it)", T, () => {
    for (const rel of ["page", ...SLUGS.map((s) => `legal/${s}/page`)]) {
      const file = path.join(process.cwd(), ".next/server/app/(marketing)", `${rel}_client-reference-manifest.js`);
      assert.ok(fs.existsSync(file), `${file} is missing (control: the manifest should exist for a built page)`);
      // The manifest is a JS file that assigns one object literal; parsing throws (= fails) if that shape ever changes.
      const src = fs.readFileSync(file, "utf8");
      const manifest = JSON.parse(src.slice(src.indexOf("{", src.indexOf("__RSC_MANIFEST[")), src.lastIndexOf("}") + 1)) as {
        clientModules: Record<string, unknown>;
      };
      const modules = Object.keys(manifest.clientModules);
      assert.ok(modules.length > 0, `${rel}: no client modules at all (control: Next always registers its own)`);
      // Next registers its own client internals (layout-router, Link, ...), so "empty" here means "nothing but those".
      // Any client component of ours or of a third party fails this, whatever its path - the old two-path scan did not.
      // WEB-B04: error.tsx and global-error.tsx must be client components (Next requires it), so they register on every page.
      // Allow exactly those two files; chrome, header or any other module of ours still fails.
      const ours = modules.filter((m) => !m.includes("node_modules/next/dist/") && !/(^|\/)src\/app\/(global-)?error\.tsx($|[ #?])/.test(m));
      assert.deepEqual(ours, [], `${rel} ships client components`);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("mobile menu: native <details>, keyboard operable", () => {
  const summary = "header summary";

  test("Enter and Space open and close it; the button's name follows the state", T, async () => {
    const { page, close } = await visit("mobile", "/");
    try {
      await page.locator(summary).focus();
      assert.equal(await menuOpen(page), false);
      await page.keyboard.press("Enter");
      assert.equal(await menuOpen(page), true, "Enter opens");
      assert.equal((await page.locator(summary).innerText()).trim(), "Close menu");
      await page.keyboard.press("Enter");
      assert.equal(await menuOpen(page), false, "Enter closes");
      assert.equal((await page.locator(summary).innerText()).trim(), "Menu");
      await page.keyboard.press("Space");
      assert.equal(await menuOpen(page), true, "Space opens");
      await page.keyboard.press("Space");
      assert.equal(await menuOpen(page), false, "Space closes");
    } finally {
      await close();
    }
  });

  test("Tab from the open button goes into the menu links, in order", T, async () => {
    const { page, close } = await visit("mobile", "/");
    try {
      await page.locator(summary).focus();
      await page.keyboard.press("Enter");
      const seen: string[] = [];
      for (let i = 0; i < 7; i++) {
        await page.keyboard.press("Tab");
        seen.push((await focusInfo(page)).label);
      }
      assert.deepEqual(seen, [...NAV, "Log in", "Find a Charger"]);
    } finally {
      await close();
    }
  });

  test("Escape closes it and puts focus back on the button, also from a link inside the menu", T, async () => {
    const { page, close } = await visit("mobile", "/");
    try {
      await page.locator(summary).focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Escape");
      assert.equal(await menuOpen(page), false);
      assert.equal((await focusInfo(page)).tag, "SUMMARY");

      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab"); // Find Chargers
      await page.keyboard.press("Tab"); // Vehicles
      assert.equal((await focusInfo(page)).label, "Vehicles");
      await page.keyboard.press("Escape");
      assert.equal(await menuOpen(page), false);
      assert.equal((await focusInfo(page)).tag, "SUMMARY", "focus must not be lost on a hidden link");
    } finally {
      await close();
    }
  });

  test("a click outside closes it; a click inside the menu panel does not", T, async () => {
    const { page, close } = await visit("mobile", "/");
    try {
      await page.locator(summary).click();
      assert.equal(await menuOpen(page), true);
      const box = (await page.locator('nav[aria-label="Mobile menu"]').boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height - 2); // padding of the panel, not a link
      assert.equal(await menuOpen(page), true, "a click on the panel itself keeps it open");
      await page.mouse.click(180, 700);
      assert.equal(await menuOpen(page), false, "a click on the page closes it");
    } finally {
      await close();
    }
  });

  test("a link in the menu loads its page, which also closes the menu", T, async () => {
    const { page, close } = await visit("mobile", "/");
    try {
      await page.locator(summary).click();
      await page.locator('nav[aria-label="Mobile menu"]').getByRole("link", { name: "Find a Charger" }).click();
      await page.waitForURL("**/app", { timeout: 30_000 });
    } finally {
      await close();
    }
  });

  test("works with JavaScript off: Enter on the button opens the menu natively", T, async () => {
    const context = await browser.newContext({ viewport: VIEWPORTS.mobile, javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.route((u) => u.protocol.startsWith("http") && u.origin !== origin(), (r) => r.abort());
      await page.goto(server.baseUrl + "/", { waitUntil: "load" });
      await page.keyboard.press("Tab"); // skip link
      await page.keyboard.press("Tab"); // logo
      await page.keyboard.press("Tab"); // menu button
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("details#site-menu[open]").count(), 1);
      assert.deepEqual((await visibleLinks(page, "header nav[aria-label='Mobile menu']")).map((l) => l.label), [...NAV, "Log in", "Find a Charger"]);
    } finally {
      await context.close();
    }
  });

  test("it is a menu, not a dialog: no dialog role, no modal, nothing inert", T, async () => {
    const { page, close } = await visit("mobile", "/");
    try {
      await page.locator(summary).click();
      assert.equal(await page.locator('dialog, [role="dialog"], [aria-modal="true"], [inert]').count(), 0);
    } finally {
      await close();
    }
  });

  for (const [name, vp, size] of [
    ["360 x 800", "mobile", undefined],
    ["768 x 1024", "tablet", undefined],
    ["360 x 420 (short, landscape-like)", "mobile", { width: 360, height: 420 }],
  ] as const) {
    test(`the open menu is fully on screen and above the page content at ${name}`, T, async () => {
      const { page, close } = await visit(vp, "/", { size });
      try {
        await page.locator(summary).click();
        const m = await page.evaluate(() => {
          const nav = document.querySelector('nav[aria-label="Mobile menu"]') as HTMLElement;
          const r = nav.getBoundingClientRect();
          const last = [...nav.querySelectorAll("a")].pop()!;
          last.scrollIntoView({ block: "nearest" });
          const lr = last.getBoundingClientRect();
          const hit = document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2);
          return {
            vw: window.innerWidth,
            vh: window.innerHeight,
            r: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
            overflowY: getComputedStyle(nav).overflowY,
            lastReachable: !!hit && last.contains(hit),
            lastInside: lr.top >= r.top - 1 && lr.bottom <= r.bottom + 1,
          };
        });
        assert.ok(m.r.left >= 0 && m.r.right <= m.vw, `menu is wider than the viewport: ${JSON.stringify(m)}`);
        assert.ok(m.r.bottom <= m.vh + 1, `menu runs below the viewport: ${JSON.stringify(m)}`);
        assert.equal(m.overflowY, "auto", "a tall menu must scroll inside itself");
        assert.ok(m.lastReachable, "the last menu link is covered by page content (z-index)");
        assert.ok(m.lastInside, "the last menu link is outside the panel");
      } finally {
        await close();
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
describe("skip link, focus and landmarks (WL-A11Y-4, WL-A11Y-10, WL-SEO-4)", () => {
  test("the first Tab stop is the skip link; it is off-screen until focused, then visible with a focus ring", T, async () => {
    const { page, close } = await visit("desktop", "/");
    try {
      const before = await page.evaluate(() => document.querySelector("a")!.getBoundingClientRect().bottom);
      assert.ok(before <= 0, `skip link should be off-screen before focus (bottom ${before})`);
      await page.keyboard.press("Tab");
      const f = await focusInfo(page);
      assert.equal(f.label, "Skip to main content");
      assert.ok(f.rect.top >= 0 && f.rect.bottom > 0 && f.rect.left >= 0, `skip link not on screen when focused: ${JSON.stringify(f.rect)}`);
      assert.equal(f.outlineStyle, "solid");
      assert.ok(f.outlineWidth >= 2, `focus outline ${f.outlineWidth}px`);
      const first = await page.evaluate(() => document.querySelector("body a")!.getAttribute("href"));
      assert.equal(first, "#main-content", "the skip link must be the first link in the document");
    } finally {
      await close();
    }
  });

  for (const vp of ["desktop", "mobile"] as const) {
    test(`activating the skip link moves focus to <main id=main-content> (${vp})`, T, async () => {
      for (const p of ["/", "/legal/privacy"]) {
        const { page, close } = await visit(vp, p);
        try {
          await page.keyboard.press("Tab");
          await page.keyboard.press("Enter");
          assert.equal(new URL(page.url()).hash, "#main-content");
          const f = await focusInfo(page);
          assert.equal(f.id, "main-content", `${p}: focus is on ${f.tag}#${f.id}`);
          assert.equal(f.tag, "MAIN");
          assert.equal(await page.evaluate(() => document.querySelector("main")!.getAttribute("tabindex")), "-1");
        } finally {
          await close();
        }
      }
    });
  }

  test("Tab order at 1280 px: skip link, logo, the five links, Log in, Find a Charger, then the page", T, async () => {
    const { page, close } = await visit("desktop", "/");
    try {
      const stops: string[] = [];
      for (let i = 0; i < 9; i++) {
        await page.keyboard.press("Tab");
        const f = await focusInfo(page);
        stops.push(f.label);
        assert.equal(f.outlineStyle, "solid", `no focus outline on "${f.label}"`);
        assert.ok(f.outlineWidth >= 2, `"${f.label}" focus outline is ${f.outlineWidth}px`);
      }
      assert.deepEqual(stops, ["Skip to main content", "FullCharge", ...NAV, "Log in", "Find a Charger"]);
    } finally {
      await close();
    }
  });

  test("Tab order at 360 px: skip link, logo, menu button; the button has a focus ring", T, async () => {
    const { page, close } = await visit("mobile", "/");
    try {
      const stops: string[] = [];
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press("Tab");
        const f = await focusInfo(page);
        stops.push(f.label);
        assert.ok(f.outlineStyle === "solid" && f.outlineWidth >= 2, `no focus ring on "${f.label}"`);
      }
      assert.deepEqual(stops, ["Skip to main content", "FullCharge", "Menu"]);
    } finally {
      await close();
    }
  });

  test("every footer link shows a focus ring and is not covered by the header (WCAG 2.4.7, 2.4.11)", T, async () => {
    const { page, close } = await visit("desktop", "/legal/privacy");
    try {
      await page.keyboard.press("Tab"); // keyboard modality, so focus() below counts as :focus-visible
      const bad = await page.evaluate(() => {
        const out: string[] = [];
        for (const a of document.querySelectorAll<HTMLElement>("footer a")) {
          a.focus();
          const cs = getComputedStyle(a);
          const r = a.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (cs.outlineStyle !== "solid" || parseFloat(cs.outlineWidth) < 2) out.push(`${a.textContent}: outline ${cs.outlineStyle} ${cs.outlineWidth}`);
          if (!hit || !a.contains(hit)) out.push(`${a.textContent}: covered by ${hit?.tagName}`);
        }
        return out;
      });
      assert.deepEqual(bad, []);
    } finally {
      await close();
    }
  });

  test("the header is not sticky or fixed, so a focused element can never sit underneath it (WCAG 2.4.11)", T, async () => {
    const { page, close } = await visit("desktop", "/legal/privacy");
    try {
      const positions = await page.evaluate(() => {
        const out: string[] = [];
        for (let e: Element | null = document.querySelector("header"); e; e = e.parentElement) out.push(getComputedStyle(e).position);
        return out;
      });
      assert.ok(!positions.some((p) => p === "sticky" || p === "fixed"), positions.join(","));
      // Control: the skip link IS fixed, so the check can see a fixed element.
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("a")!).position), "fixed");
    } finally {
      await close();
    }
  });

  for (const p of PAGES) {
    test(`${p}: one h1, one main#main-content[tabindex=-1], one banner, one contentinfo, labelled navs`, T, async () => {
      const { html } = await fetchDoc(server.baseUrl, p);
      assert.equal((noScripts(html).match(/<h1[\s>]/g) ?? []).length, 1, "exactly one <h1>");
      assert.equal((noScripts(html).match(/<main[\s>]/g) ?? []).length, 1, "exactly one <main>");
      assert.match(html, /<main id="main-content" tabindex="-1"/);
      assert.equal((noScripts(html).match(/<footer[\s>]/g) ?? []).length, 1, "exactly one <footer>");

      for (const vp of ["desktop", "mobile"] as const) {
        const { page, close } = await visit(vp, p);
        try {
          assert.equal(await page.getByRole("banner").count(), 1, `${vp}: banner (a legal <header> inside <article> must not count)`);
          assert.equal(await page.getByRole("contentinfo").count(), 1, `${vp}: contentinfo`);
          assert.equal(await page.getByRole("main").count(), 1, `${vp}: main`);
          assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1, `${vp}: h1`);
          assert.equal(await page.getByRole("navigation", { name: "Footer" }).count(), 1);
          assert.equal(await page.getByRole("navigation", { name: "Primary" }).count(), vp === "desktop" ? 1 : 0);
          // Every nav has a name, and every rendered nav name is unique.
          const names = await page.evaluate(() => [...document.querySelectorAll("nav")].map((n) => n.getAttribute("aria-label")));
          assert.ok(names.every((n) => n && n.trim()), JSON.stringify(names));
          assert.equal(new Set(names).size, names.length, JSON.stringify(names));
        } finally {
          await close();
        }
      }
    });
  }

  test("icons are hidden from assistive tech and images have alt text (WL-A11Y-10)", T, async () => {
    const { page, close } = await visit("desktop", "/");
    try {
      const r = await page.evaluate(() => ({
        svg: [...document.querySelectorAll("header svg, footer svg")].filter((s) => s.getAttribute("aria-hidden") !== "true").length,
        total: document.querySelectorAll("header svg, footer svg").length,
        img: [...document.querySelectorAll("header img, footer img")].filter((i) => !i.hasAttribute("alt")).length,
      }));
      assert.ok(r.total >= 2, "control: the chrome has icons");
      assert.equal(r.svg, 0);
      assert.equal(r.img, 0);
      // The logo link's accessible name is the product name, not the icon.
      assert.equal(await page.locator('header a[href="/"]').first().innerText(), "FullCharge");
    } finally {
      await close();
    }
  });

  for (const vp of ["mobile", "desktop"] as const) {
    test(`header and footer links and buttons are at least 24 px in both directions (${vp})`, T, async () => {
      const { page, close } = await visit(vp, "/");
      try {
        if (vp === "mobile") await page.locator("header summary").click();
        const small = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("header a, header summary, footer a")]
            .filter((e) => e.checkVisibility({ checkVisibilityCSS: true }))
            .map((e) => ({ t: (e.textContent ?? "").trim(), r: e.getBoundingClientRect() }))
            .filter((x) => x.r.width < 24 || x.r.height < 24)
            .map((x) => `${x.t}: ${Math.round(x.r.width)}x${Math.round(x.r.height)}`),
        );
        assert.deepEqual(small, []);
      } finally {
        await close();
      }
    });
  }

  // No CSP is served anywhere yet: next.config.ts has no headers() and there is no src/proxy.ts (chain-proxy, WEB-S05/WEB-S06).
  // So this cannot show the inline script is CSP-clean, and the title does not claim it. The cspViolations line below is a
  // tripwire for the day a policy is served, not evidence today; the real per-page CSP check belongs to WEB-S05 (csp.e2e.ts),
  // which must cover / and /legal/:path* under the static marketing CSP of ADR-0016.
  test("no page errors while using the header", T, async () => {
    const { page, flush, captured, close } = await visit("mobile", "/", { hint: "1" });
    try {
      await page.locator("header summary").click();
      await page.keyboard.press("Escape");
      await flush();
      assert.deepEqual(captured.pageErrors, []);
      assert.deepEqual(captured.cspViolations, []); // vacuous until a CSP is served (see above)
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("WL-LAND-10: footer", () => {
  const emailsNull = legal.contact.supportEmail === null && legal.grievanceOfficer.email === null;

  test("links privacy, terms, disclaimer, attributions, contact and grievance officer; the four legal pages exist", T, async () => {
    const { page, close } = await visit("desktop", "/");
    try {
      const links = await visibleLinks(page, "footer");
      const find = (re: RegExp) => links.filter((l) => re.test(l.label));
      for (const [re, href] of [
        [/privacy/i, legal.documents.privacy.path],
        [/terms/i, legal.documents.terms.path],
        [/disclaimer/i, legal.documents.disclaimer.path],
        [/attribution/i, legal.documents.attributions.path],
      ] as const) {
        const hit = find(re);
        assert.equal(hit.length, 1, `footer link ${re}`);
        assert.equal(hit[0].href, href);
        assert.equal((await fetch(server.baseUrl + href, { signal: AbortSignal.timeout(20_000) })).status, 200, href);
      }
      assert.ok(find(/contact/i).length >= 1, "no Contact link");
      assert.ok(find(/grievance/i).length >= 1, "no Grievance officer link");
      assert.ok(links.some((l) => l.href === legal.documents["delete-account"].path), "no link to the delete-account page");
      // Never requested here: /about, /for-businesses, /for-operators (WEB-B03), /login (WEB-B06).
    } finally {
      await close();
    }
  });

  test("shows the legal entity and registered address from legal.ts, or the To be confirmed marker, and the copyright line", T, async () => {
    for (const p of ["/", "/legal/disclaimer"]) {
      const { page, close } = await visit("desktop", p);
      try {
        const f = await page.evaluate(() => {
          const rows: Record<string, { text: string; marker: boolean }> = {};
          for (const dt of document.querySelectorAll("footer dt")) {
            const dd = dt.nextElementSibling as HTMLElement;
            rows[(dt.textContent ?? "").replace(/[:\s]+$/, "")] = { text: (dd.textContent ?? "").trim(), marker: dd.querySelector("span.border-dashed") !== null };
          }
          const copy = [...document.querySelectorAll("footer p")].map((e) => (e.textContent ?? "").trim()).find((t) => t.startsWith("©"));
          return { rows, copy };
        });
        for (const [label, value] of [["Legal entity", legal.entity.name], ["Registered address", legal.entity.registeredAddress]] as const) {
          const row = f.rows[label];
          assert.ok(row, `${p}: no "${label}" row in the footer`);
          if (missing(value)) {
            assert.equal(row.text, "To be confirmed", `${p}: ${label} must show the marker while it is null`);
            assert.ok(row.marker, `${p}: ${label} marker is not styled as the marker`);
          } else {
            assert.equal(row.text, value!.trim(), `${p}: ${label}`);
            assert.ok(!row.marker);
          }
        }
        assert.equal(f.copy, `© ${legal.entity.name?.trim() || "FullCharge"}`);
        assert.doesNotMatch(f.copy!, /\b(19|20)\d{2}\b/, "no year: legal.ts has none and a build-time year goes stale");
      } finally {
        await close();
      }
    }
  });

  test("shows no email address or mailto link while the emails are null (WL-LEGAL-2)", { ...T, skip: !emailsNull }, async () => {
    const { html } = await fetchDoc(server.baseUrl, "/");
    assert.doesNotMatch(html, /mailto:/i);
    assert.doesNotMatch(noScripts(html), /[\w.+-]+@[\w-]+(\.[\w-]+)+/);
  });

  test("the footer is below the main content and, on a short page, at the bottom of the viewport", T, async () => {
    const { page, close } = await visit("desktop", "/");
    try {
      const r = await page.evaluate(() => ({
        footerTop: document.querySelector("footer")!.getBoundingClientRect().top,
        mainBottom: document.querySelector("main")!.getBoundingClientRect().bottom,
        footerBottom: document.querySelector("footer")!.getBoundingClientRect().bottom,
        vh: window.innerHeight,
      }));
      assert.ok(r.footerTop >= r.mainBottom - 1, JSON.stringify(r));
      assert.ok(r.footerBottom >= r.vh - 1, `footer floats mid-page on a short page: ${JSON.stringify(r)}`);
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("layout: no horizontal overflow at 360 / 768 / 1280 px", () => {
  type Mode = "plain" | "menu" | "long" | "longCopyright" | "nowrap";
  /** Widest layout width after applying `mode`. "long" puts a long unbroken value into the footer's entity and address
   * rows; "longCopyright" into the copyright line (its own test, because it is a separate element); "nowrap" is the
   * control that must overflow. Long values stand in for whatever legal.ts will hold. */
  async function width(vp: ViewportName, p: string, mode: Mode) {
    const { page, close } = await visit(vp, p);
    try {
      if (mode === "menu") await page.locator("header summary").click();
      return await page.evaluate((m) => {
        const long = "verylongunbrokenvalue".repeat(9) + "@examplecompany.example";
        const copy = [...document.querySelectorAll("footer p")].find((e) => (e.textContent ?? "").startsWith("©"));
        if (m === "long" || m === "nowrap") document.querySelectorAll("footer dd").forEach((e) => (e.textContent = long));
        if (m === "longCopyright" || m === "nowrap") if (copy) copy.textContent = `© ${long}`;
        if (m === "nowrap") document.querySelectorAll("footer dd, footer p").forEach((e) => ((e as HTMLElement).style.whiteSpace = "nowrap"));
        return { viewport: window.innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth };
      }, mode);
    } finally {
      await close();
    }
  }

  test("control: the width check can see overflow (nowrap long values at 360 px)", T, async () => {
    const w = await width("mobile", "/", "nowrap");
    assert.equal(w.viewport, 360);
    assert.ok(w.doc > 360, `expected overflow, got ${JSON.stringify(w)}`);
  });

  for (const [name, vp, px] of [["360", "mobile", 360], ["768", "tablet", 768], ["1280", "desktop", 1280]] as const) {
    test(`${name} px: pages with the chrome do not scroll sideways, menu open or closed, also with long footer values`, T, async () => {
      for (const p of ["/", "/legal/privacy", "/legal/delete-account"]) {
        for (const mode of (vp === "desktop" ? ["plain", "long"] : ["plain", "menu", "long"]) as Mode[]) {
          const w = await width(vp, p, mode);
          assert.equal(w.viewport, px, "control: viewport");
          assert.ok(w.doc <= px && w.body <= px, `horizontal overflow at ${px}px on ${p} (${mode}): ${JSON.stringify(w)}`);
        }
      }
    });
  }

  // Found by these tests: the copyright line (<p>© {entity.name}</p>) has no break-words, unlike the entity and address rows.
  for (const [vp, px] of [["mobile", 360], ["desktop", 1280]] as const) {
    test(`${px} px: a long unbroken legal entity name in the copyright line does not scroll the page sideways`, T, async () => {
      const w = await width(vp, "/", "longCopyright");
      assert.ok(w.doc <= px && w.body <= px, `the copyright line overflows at ${px}px: ${JSON.stringify(w)}`);
    });
  }

  test("1279 px (menu layout, just under the inline nav) does not overflow either", T, async () => {
    const { page, close } = await visit("desktop", "/", { size: { width: 1279, height: 800 } });
    try {
      await page.locator("header summary").click();
      const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth }));
      assert.ok(w.doc <= 1279, JSON.stringify(w));
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("ADR-0017 / WL-PERF-2: the chrome never prefetches /app", () => {
  // The header and footer link to /app on every page. A next/link <Link> to /app without prefetch={false} makes Next fetch
  // that route's chunks once the link scrolls into view, which puts NextAuth, React Query and vaul (~54 KB) on a landing
  // visit. routes.e2e.ts checks `/` on a desktop viewport, where the menu links are display:none and never intersect;
  // here the menu is open at 360 px and the whole page is scrolled through, on every marketing page.
  async function scan(vp: ViewportName, p: string) {
    const { page, close } = await openPage(browser, vp);
    try {
      const requests: string[] = [];
      const bodies: { url: string; text: string }[] = [];
      page.on("request", (r) => requests.push(r.url()));
      page.on("response", async (r) => {
        if ((r.request().resourceType() === "script" || /\.js(\?|$)/.test(r.url())) && r.ok()) bodies.push({ url: r.url(), text: await r.text().catch(() => "") });
      });
      await page.route((u) => u.protocol.startsWith("http") && u.origin !== origin(), (r) => r.abort());
      await page.goto(server.baseUrl + p, { waitUntil: "load" });
      if (vp === "mobile") await page.locator("header summary").click();
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y <= height; y += 300) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(60);
      }
      // A page that is prefetching /app may never go idle; fall through so the assertions below name the cause.
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(500); // Next prefetches from an idle callback
      // Control: the recorder sees a prefetch-style request when one is made.
      await page.evaluate(() => fetch("/app?_rsc=probe").catch(() => null));
      await page.waitForTimeout(200);
      return { requests, bodies };
    } finally {
      await close();
    }
  }

  for (const p of PAGES) {
    for (const vp of ["mobile", "desktop"] as const) {
      test(`${p} at ${vp}: no Next prefetch request, and none of NextAuth / React Query / Zustand / Maps / vaul is loaded`, T, async () => {
        const { requests, bodies } = await scan(vp, p);
        const rsc = requests.filter((u) => new URL(u).searchParams.has("_rsc"));
        assert.deepEqual(rsc, [server.baseUrl + "/app?_rsc=probe"], `a <Link> on ${p} is prefetching (use <a> or prefetch={false}); only the test's own probe request may carry _rsc`);
        assert.ok(bodies.length >= 3, "the scan recorded almost no scripts, so it would pass vacuously");
        for (const [lib, marker] of Object.entries(MARKERS)) {
          const hit = bodies.find((s) => s.text.includes(marker));
          assert.ok(!hit, `${lib} code (${JSON.stringify(marker)}) was loaded on ${p} via ${hit?.url}: a Link to /app is prefetching; use <a> or prefetch={false}`);
        }
        for (const u of requests) assert.ok(!new URL(u).pathname.startsWith("/api/"), `${p} called ${u}`);
      });
    }
  }
});
