import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { Browser } from "playwright";
import { legal, type LegalSlug } from "../../src/content/legal";
import { launchBrowser, openPage } from "./helpers/browser";
import { startServer, type TestServer } from "./helpers/server";
import { fetchDoc } from "./routes-support";

// T3-09: the five /legal/* pages. Criteria: WL-LEGAL-1 (pages exist), WL-LEGAL-2 (nothing invented while the
// founder facts are null), WL-SEO-8 / QA-5 (a marketing page must not set its own robots), one h1, the static
// marketing group (ADR-0017), 360 px mobile width, DN-24 (delete-account instructions), DN-13 (same-method notice).
// Content arrives in stages, so tests that depend on a value being null read src/content/legal.ts and skip once it is
// filled. Nothing here pins which values are filled today.
// Built with SITE_NOINDEX=0 (indexable) so any page-level robots meta shows up; with the site flag closed it would hide
// behind the root layout's noindex. APP_ENV is not passed to the server by testEnv(), so this is the dev/staging build.
// Run: npx tsx --test --test-concurrency=1 tests/web/legal.e2e.ts   (first run: npx playwright install chromium)
process.env.SITE_NOINDEX = "0";

const T = { timeout: 60_000 };
const SLUGS: LegalSlug[] = ["privacy", "terms", "disclaimer", "attributions", "delete-account"];
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

const missing = (v: string | null) => v === null || v.trim() === "";
/** The page shows the "To be confirmed" marker for any missing founder fact, and on a drafted section that has text. */
const expectsMarker = (slug: LegalSlug) => {
  const doc = legal.documents[slug];
  const facts = [legal.entity.name, legal.entity.registeredAddress, legal.contact.supportEmail, ...Object.values(legal.grievanceOfficer), doc.version, doc.effectiveDate];
  return facts.some(missing) || doc.sections.some((s) => s.draft && s.body !== null);
};
const emailsNull = legal.contact.supportEmail === null && legal.grievanceOfficer.email === null;

test("control: the robots check can see a robots meta (/app is noindex)", T, async () => {
  const { meta } = await fetchDoc(server.baseUrl, "/app");
  assert.deepEqual(meta.robots, ["noindex, nofollow"]);
});

/** Widest layout width at 360 px after applying `mode` to the built page. "long" puts long unbroken values into every
 * place a config value can land, which legal.ts cannot be changed to do from a test; "nowrap" is the control. */
async function widthAt360(p: string, mode: "plain" | "long" | "nowrap") {
  const { page, close } = await openPage(browser, "mobile");
  try {
    const origin = new URL(server.baseUrl).origin;
    await page.route((u) => u.protocol.startsWith("http") && u.origin !== origin, (r) => r.abort());
    const nav = await page.goto(server.baseUrl + p, { waitUntil: "load" });
    assert.equal(nav!.status(), 200);
    return await page.evaluate((m) => {
      const long = "verylongunbrokenvalue".repeat(9) + "@examplecompany.example"; // about 210 characters, no spaces or hyphens (both allow a line break)
      if (m !== "plain") {
        document.querySelectorAll("article dd").forEach((dd, i) => {
          if (i % 2) return void (dd.textContent = `Line one\n${long}`);
          const a = document.createElement("a"); // what Fact renders for an email
          a.href = "mailto:x@example.test";
          a.textContent = long;
          dd.replaceChildren(a);
        });
        // Paragraphs a config value can land in. Not the fixed "Draft. To be confirmed" marker (self-start, shrink-to-fit).
        document.querySelectorAll("article section p:not(.self-start)").forEach((el) => (el.textContent = long));
      }
      if (m === "nowrap") document.querySelectorAll("article dd, article section p:not(.self-start)").forEach((el) => ((el as HTMLElement).style.whiteSpace = "nowrap"));
      return { viewport: window.innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth };
    }, mode);
  } finally {
    await close();
  }
}

test("control: the width check can see overflow (nowrap long values at 360 px)", T, async () => {
  const w = await widthAt360("/legal/privacy", "nowrap");
  assert.equal(w.viewport, 360);
  assert.ok(w.doc > 360, `expected overflow, got ${JSON.stringify(w)}`);
});

for (const slug of SLUGS) {
  const p = `/legal/${slug}`;

  describe(p, () => {
    test("200, static, one h1, no page-level robots", T, async () => {
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
    });

    // A section is not a landmark: aria-labelledby on <section> made every legal section one.
    test("the article has content and its sections carry no aria-labelledby", T, async () => {
      const { html } = await fetchDoc(server.baseUrl, p);
      const article = /<article[\s\S]*<\/article>/.exec(noScripts(html))?.[0];
      assert.ok(article, "no <article>");
      assert.match(article, /<section[\s>]/, "control: the article contains sections");
      assert.doesNotMatch(article, /aria-labelledby/);
    });

    test("shows the To be confirmed marker for a missing fact", { ...T, skip: !expectsMarker(slug) }, async () => {
      const { html } = await fetchDoc(server.baseUrl, p);
      assert.ok(visibleText(html).includes("To be confirmed"), "null founder facts must show the marker, not a guess");
    });

    // WL-LEGAL-2 / T-1: while the emails are unanswered (Q-C9) the page may show no email address.
    test("shows no email address while both emails are null", { ...T, skip: !emailsNull }, async () => {
      const { html } = await fetchDoc(server.baseUrl, p);
      assert.doesNotMatch(html, /mailto:/i, "a mailto link means an email was rendered");
      assert.doesNotMatch(noScripts(html), /[\w.+-]+@[\w-]+(\.[\w-]+)+/, "email address");
    });

    test("does not exceed 360 px width, also with long unbroken values", T, async () => {
      for (const mode of ["plain", "long"] as const) {
        const w = await widthAt360(p, mode);
        assert.equal(w.viewport, 360, "control: viewport is 360 px");
        assert.ok(w.doc <= 360 && w.body <= 360, `horizontal overflow at 360 px (${mode}): ${JSON.stringify(w)}`);
      }
    });
  });
}

describe("/legal/delete-account (DN-24, DN-13)", () => {
  test("gives the in-app path, the support email slot and the same-method notice", T, async () => {
    const { html } = await fetchDoc(server.baseUrl, "/legal/delete-account");
    const text = visibleText(html);
    assert.match(html, /href="\/account"/, "link to the in-app deletion page");
    assert.match(text, /same method/i, "same-method line");
    assert.match(text, /separate FullCharge accounts/i, "phone and Google make separate accounts");
    assert.match(text, /different account/i, "the other method opens a different account");
  });
});
