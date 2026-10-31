import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { Browser } from "playwright";
import { launchBrowser, openPage } from "./helpers/browser";
import { startServer, type TestServer } from "./helpers/server";
import { fetchDoc } from "./routes-support";

// T3-09: the five /legal/* skeleton pages. Criteria: WL-LEGAL-1 (pages exist), WL-LEGAL-2 (nothing invented while
// the founder facts are null), WL-SEO-8 / QA-5 (a marketing page must not set its own robots), WL-A11Y (one h1),
// WL-PERF static group (ADR-0017), 360 px mobile width (spec 8).
// Built with SITE_NOINDEX=0 (indexable) so any page-level robots meta shows up; with the site flag closed it would hide
// behind the root layout's noindex. APP_ENV is not passed to the server by testEnv(), so this is the dev/staging build.
// Valid while the config still holds nulls: once the founder fills them the "To be confirmed" test must be revisited.
// Run: npx tsx --test --test-concurrency=1 tests/web/legal.e2e.ts   (first run: npx playwright install chromium)
process.env.SITE_NOINDEX = "0";

const T = { timeout: 60_000 };
const SLUGS = ["privacy", "terms", "disclaimer", "attributions", "delete-account"];
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

const noScripts = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/g, " ");
const visibleText = (html: string) => noScripts(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("control: the robots check can see a robots meta (/app is noindex)", T, async () => {
  const { meta } = await fetchDoc(server.baseUrl, "/app");
  assert.deepEqual(meta.robots, ["noindex, nofollow"]);
});

for (const slug of SLUGS) {
  const p = `/legal/${slug}`;

  describe(p, () => {
    test("200, static, one h1, no page-level robots, shows the To be confirmed marker", T, async () => {
      const { res, status, html, meta } = await fetchDoc(server.baseUrl, p);
      assert.equal(status, 200);

      // static: prerendered in the build, no revalidate, served as a prerendered response
      const route = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".next/prerender-manifest.json"), "utf8")).routes[p];
      assert.ok(route, `${p} is missing from prerender-manifest routes, so it is not prerendered`);
      assert.equal(route.initialRevalidateSeconds, false, "prerendered but revalidating, so not purely static");
      assert.match(res.headers.get("x-nextjs-prerender") ?? "", /^1(, 1)*$/);
      assert.match(res.headers.get("cache-control") ?? "", /s-maxage=\d{6,}/);

      assert.equal((noScripts(html).match(/<h1[\s>]/g) ?? []).length, 1, "exactly one <h1>");

      assert.deepEqual(meta.robots, [], "page sets its own robots meta (overrides the SITE_NOINDEX flag)");
      assert.doesNotMatch(res.headers.get("x-robots-tag") ?? "", /noindex/i);

      assert.ok(visibleText(html).includes("To be confirmed"), "null founder facts must show the marker, not a guess");
    });

    // WL-LEGAL-2 / T-1: while Q-C9 is unanswered the page may state no fact about the operator.
    test("contains no invented facts (email, phone, street address, company suffix)", T, async () => {
      const { html } = await fetchDoc(server.baseUrl, p);
      const text = visibleText(html);
      assert.doesNotMatch(html, /mailto:/i, "a mailto link means an email was rendered");
      assert.doesNotMatch(noScripts(html), /[\w.+-]+@[\w-]+(\.[\w-]+)+/, "email address");
      assert.doesNotMatch(text, /\+?\d[\d\s().-]{7,}\d/, "phone-like number");
      assert.doesNotMatch(text, /\b[1-9]\d{5}\b/, "6-digit PIN code");
      assert.doesNotMatch(text, /\b(road|rd\.|street|st\.|lane|nagar|sector|floor|plot no|pin ?code)\b/i, "street-address word");
      assert.doesNotMatch(text, /\b(pvt\.?|private limited|ltd\.?|limited|llp|inc\.?|llc|corp\.?|corporation)(?=\W|$)/i, "company suffix");
    });

    test("does not exceed 360 px width", T, async () => {
      const { page, close } = await openPage(browser, "mobile");
      try {
        const origin = new URL(server.baseUrl).origin;
        await page.route((u) => u.protocol.startsWith("http") && u.origin !== origin, (r) => r.abort());
        const nav = await page.goto(server.baseUrl + p, { waitUntil: "load" });
        assert.equal(nav!.status(), 200);
        const w = await page.evaluate(() => ({
          viewport: window.innerWidth,
          doc: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
        }));
        assert.equal(w.viewport, 360, "control: viewport is 360 px");
        assert.ok(w.doc <= 360 && w.body <= 360, `horizontal overflow at 360 px: ${JSON.stringify(w)}`);
      } finally {
        await close();
      }
    });
  });
}
