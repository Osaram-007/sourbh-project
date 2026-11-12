import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser, Page, Request, Route } from "playwright";
import { launchBrowser, openPage } from "./helpers/browser";
import { startServer, type TestServer } from "./helpers/server";
import { BANNED_COPY, fetchDoc, loadPage } from "./routes-support";

// WEB-B03: /for-businesses, /for-operators, /about and the shared ContactForm.
// Criteria: WL-LAND-13, WL-LAND-14, WL-SEO-1, WL-LAND-5 (metadata and visible copy), WL-A11Y (labels, focus, honeypot),
// T-1 (no numbers, no operator brands), WL-PERF-2 (soft budget). The API (WEB-D07) does not exist: every POST is mocked.
// Built with SITE_NOINDEX=0 so page-level metadata is not hidden behind the closed-site flag.
// Run: npx tsx --test --test-concurrency=1 tests/web/marketing-pages.e2e.ts
process.env.SITE_NOINDEX = "0";

const T = { timeout: 90_000 };
const BUDGET_BYTES = 150_000;
const PAGES = [
  { path: "/for-businesses", type: "BUSINESS", h1: "For businesses" },
  { path: "/for-operators", type: "OPERATOR", h1: "For charging operators" },
  { path: "/about", type: "OTHER", h1: "About FullCharge" },
] as const;
const API = "**/api/v1/enquiries";
const GENERIC = "Your message did not send. Please try again.";
const SUCCESS = "Thanks. We have your message.";
const RATE = "You have sent several messages. Please try again later.";

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

const strip = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/g, " ");
const main = (html: string) => /<main\b[\s\S]*?<\/main>/.exec(html)?.[0] ?? "";
const text = (html: string) =>
  strip(html).replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const canonical = (html: string) => /<link\s[^>]*rel="canonical"[^>]*>/.exec(html)?.[0].match(/href="([^"]*)"/)?.[1] ?? null;

describe("WL-LAND-13 / WL-SEO-1: served pages", () => {
  const docs: Record<string, Awaited<ReturnType<typeof fetchDoc>>> = {};
  before(async () => {
    for (const p of ["/", ...PAGES.map((x) => x.path)]) docs[p] = await fetchDoc(server.baseUrl, p);
  });

  for (const p of PAGES) {
    test(`${p.path}: 200, one h1, the contact form`, T, () => {
      const d = docs[p.path];
      assert.equal(d.status, 200);
      const h1s = [...d.html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
      assert.equal(h1s.length, 1);
      assert.equal(text(h1s[0][1]), p.h1);
      assert.match(main(d.html), /<form\b/);
      assert.match(main(d.html), /name="website"/);
      assert.match(text(main(d.html)), /Send Message/);
    });

    test(`${p.path}: no digits, no operator brands, no banned wording`, T, () => {
      const t = text(main(docs[p.path].html));
      assert.doesNotMatch(t, /\d/, "the deck has no numbers on this page (T-1)");
      assert.doesNotMatch(t, /tata|ather|statiq|bpcl|charge ?zone|evyatra|open ?charge ?map|openstreetmap/i);
      for (const re of BANNED_COPY) assert.doesNotMatch(t, re);
      const { meta } = docs[p.path];
      for (const re of BANNED_COPY) assert.doesNotMatch(`${meta.title} ${meta.description.join(" ")}`, re);
    });

    test(`${p.path}: self canonical, one "| FullCharge" suffix, one description, no own robots`, T, () => {
      const { html, meta } = docs[p.path];
      assert.ok(meta.title, "no <title>");
      assert.equal(meta.title!.split("| FullCharge").length - 1, 1, `title "${meta.title}"`);
      assert.ok(meta.title!.endsWith("| FullCharge"));
      const c = canonical(html);
      assert.ok(c, "no canonical");
      assert.equal(new URL(c!, server.baseUrl).pathname, p.path);
      assert.equal(meta.description.length, 1);
      assert.ok(meta.description[0].length > 20);
      assert.deepEqual(meta.robots, [], "a marketing page must not set its own robots");
    });
  }

  test("titles and descriptions are unique across /, /for-businesses, /for-operators, /about", T, () => {
    const all = Object.values(docs);
    assert.equal(all.length, 4);
    assert.equal(new Set(all.map((d) => d.meta.title)).size, 4);
    assert.equal(new Set(all.map((d) => d.meta.description[0])).size, 4);
    const cs = all.map((d) => canonical(d.html)).filter(Boolean);
    assert.equal(new Set(cs.map((c) => new URL(c!, server.baseUrl).pathname)).size, cs.length);
  });

  test("/about: attributions link and a #contact section", T, () => {
    const m = main(docs["/about"].html);
    assert.match(m, /href="\/legal\/attributions"/);
    assert.match(m, /id="contact"/);
  });
});

describe("no prefetch of /app from these pages", () => {
  for (const p of PAGES) {
    test(p.path, T, async () => {
      const l = await loadPage(browser, server.baseUrl, p.path);
      const origin = new URL(server.baseUrl).origin;
      const hits = l.requests.filter((u) => new URL(u).origin === origin && new URL(u).pathname === "/app");
      assert.deepEqual(hits, []);
    });
  }
});

describe("WL-PERF-2 soft budget", () => {
  for (const p of PAGES) {
    test(`${p.path} first-load JS <= ${BUDGET_BYTES} bytes gzipped`, T, async () => {
      const l = await loadPage(browser, server.baseUrl, p.path, { blockPrefetch: true });
      const bytes = l.scripts.reduce((n, s) => n + s.gzipBytes, 0);
      console.log(`${p.path} first-load JS: ${bytes} bytes`);
      assert.ok(bytes > 60_000, "measurement is broken");
      assert.ok(bytes <= BUDGET_BYTES, `${bytes} > ${BUDGET_BYTES}`);
    });
  }
});

async function open(path: string) {
  const o = await openPage(browser, "desktop");
  const origin = new URL(server.baseUrl).origin;
  await o.page.route((u) => u.protocol.startsWith("http") && u.origin !== origin, (r) => r.abort());
  await o.page.goto(server.baseUrl + path, { waitUntil: "load" });
  await o.page.waitForLoadState("networkidle"); // hydrated: the submit handler is attached
  return o;
}

describe("WL-LAND-14 / a11y: form structure", () => {
  for (const p of PAGES) {
    test(`${p.path}: labels, privacy link, honeypot, preselected type`, T, async () => {
      const { page, close } = await open(p.path);
      try {
        const fields = await page.evaluate(() =>
          [...document.querySelectorAll("main form input, main form select, main form textarea")].map((el) => {
            const e = el as HTMLInputElement;
            const lab = e.id ? document.querySelector(`label[for="${e.id}"]`) : e.closest("label");
            const r = e.getBoundingClientRect();
            return {
              name: e.name,
              labelText: lab?.textContent?.trim() ?? "",
              hidden: !!e.closest('[aria-hidden="true"]'),
              offscreen: r.right <= 0 || r.bottom <= 0 || r.width === 0 || r.height === 0,
              tabindex: e.getAttribute("tabindex"),
              value: e.value,
            };
          }),
        );
        assert.deepEqual(fields.map((f) => f.name).sort(), ["consent", "email", "message", "name", "organisation", "type", "website"]);
        for (const f of fields.filter((f) => f.name !== "website")) assert.ok(f.labelText.length > 0, `${f.name} has no label`);
        const hp = fields.find((f) => f.name === "website")!;
        assert.ok(hp.hidden, "honeypot must be inside aria-hidden");
        assert.ok(hp.offscreen, "honeypot must not be visible");
        assert.equal(hp.tabindex, "-1");
        assert.equal(hp.value, "");
        assert.equal(fields.find((f) => f.name === "type")!.value, p.type);
        assert.equal(await page.isChecked("#contact-consent"), false);

        const href = await page.locator('label[for="contact-consent"] a').getAttribute("href");
        assert.equal(href, "/legal/privacy");
        assert.equal((await fetchDoc(server.baseUrl, href!)).status, 200);
      } finally {
        await close();
      }
    });
  }
});

const fillValid = async (page: Page) => {
  await page.fill("#contact-name", "  Asha Rao ");
  await page.fill("#contact-email", "asha@example.test");
  await page.fill("#contact-organisation", "Acme");
  await page.fill("#contact-message", "Hello there");
  await page.check("#contact-consent");
};
const formAlerts = (page: Page) => page.locator('main form [role="alert"]').count(); // not the Next route announcer
const activeId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? "");
const submit = (page: Page) => page.click('button[type="submit"]');

describe("form behaviour (POST /api/v1/enquiries mocked)", () => {
  test("empty submit: no request, aria-invalid, focus on first invalid, no role=alert", T, async () => {
    const { page, close } = await open("/for-businesses");
    try {
      const reqs: Request[] = [];
      await page.route(API, (r) => (reqs.push(r.request()), r.fulfill({ status: 200, body: "{}" })));
      await submit(page);
      await page.waitForSelector("#contact-name-error");
      for (const f of ["name", "email", "consent"]) {
        assert.equal(await page.getAttribute(`#contact-${f}`, "aria-invalid"), "true", f);
        assert.match((await page.getAttribute(`#contact-${f}`, "aria-describedby")) ?? "", new RegExp(`contact-${f}-error`));
      }
      assert.notEqual(await page.getAttribute("#contact-message", "aria-invalid"), "true", "message is optional");
      assert.equal(await activeId(page), "contact-name");
      assert.equal(await formAlerts(page), 0);
      assert.match((await page.textContent("#contact-name-error")) ?? "", /Please enter your name\./);
      assert.match((await page.textContent("#contact-consent-error")) ?? "", /Please tick the box to agree\./);
      assert.deepEqual(reqs, []);
    } finally {
      await close();
    }
  });

  test("only an invalid email: that field alone is invalid and focused", T, async () => {
    const { page, close } = await open("/about");
    try {
      await fillValid(page);
      await page.fill("#contact-email", "not-an-email");
      await submit(page);
      await page.waitForSelector("#contact-email-error");
      assert.equal(await activeId(page), "contact-email");
      assert.equal(await page.locator('[aria-invalid="true"]').count(), 1);
    } finally {
      await close();
    }
  });

  for (const p of PAGES) {
    test(`${p.path}: valid submit sends the exact contract; 200 shows the success message with focus`, T, async () => {
      const { page, close } = await open(p.path);
      try {
        let method = "", ct = "", body: unknown;
        await page.route(API, (r) => {
          method = r.request().method();
          ct = r.request().headers()["content-type"] ?? "";
          body = r.request().postDataJSON();
          return r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
        });
        await fillValid(page);
        await submit(page);
        await page.getByText(SUCCESS).waitFor();
        assert.equal(method, "POST");
        assert.match(ct, /application\/json/);
        assert.deepEqual(body, {
          name: "Asha Rao",
          email: "asha@example.test",
          organisation: "Acme",
          type: p.type,
          message: "Hello there",
          consent: true,
          website: "",
        });
        assert.equal(await page.locator("main form").count(), 0, "form must be replaced");
        assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), SUCCESS);
      } finally {
        await close();
      }
    });
  }

  test("a bot that fills the honeypot: the value is sent as typed", T, async () => {
    const { page, close } = await open("/for-operators");
    try {
      let body: Record<string, unknown> = {};
      await page.route(API, (r) => ((body = r.request().postDataJSON()), r.fulfill({ status: 200, body: "{}" })));
      await fillValid(page);
      await page.locator('input[name="website"]').fill("http://spam.example", { force: true });
      await submit(page);
      await page.getByText(SUCCESS).waitFor();
      assert.equal(body.website, "http://spam.example");
    } finally {
      await close();
    }
  });

  test("400 {fields:{email}}: inline error on email, focus there, no role=alert, input kept", T, async () => {
    const { page, close } = await open("/for-businesses");
    try {
      await page.route(API, (r) => r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ fields: { email: "bad" } }) }));
      await fillValid(page);
      await submit(page);
      await page.waitForSelector("#contact-email-error");
      assert.match((await page.textContent("#contact-email-error")) ?? "", /Please enter a valid email address\./);
      assert.equal(await page.getAttribute("#contact-email", "aria-invalid"), "true");
      assert.equal(await activeId(page), "contact-email");
      assert.equal(await formAlerts(page), 0);
      assert.equal(await page.inputValue("#contact-message"), "Hello there");
    } finally {
      await close();
    }
  });

  test("400 {fields:{message}}: the too-long message error, focus on message", T, async () => {
    const { page, close } = await open("/for-businesses");
    try {
      await page.route(API, (r) => r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ fields: { message: "x" } }) }));
      await fillValid(page);
      await submit(page);
      await page.waitForSelector("#contact-message-error");
      assert.match((await page.textContent("#contact-message-error")) ?? "", /Your message is too long\. Please shorten it\./);
      assert.equal(await activeId(page), "contact-message");
    } finally {
      await close();
    }
  });

  test("429: the rate-limit message, form stays filled", T, async () => {
    const { page, close } = await open("/about");
    try {
      await page.route(API, (r) => r.fulfill({ status: 429, body: "{}" }));
      await fillValid(page);
      await submit(page);
      await page.getByText(RATE).waitFor();
      assert.equal(await page.locator('main form [role="alert"]').textContent(), RATE);
      assert.equal(await page.inputValue("#contact-message"), "Hello there");
    } finally {
      await close();
    }
  });

  const failures: [string, (r: Route) => Promise<void>][] = [
    ["500", (r) => r.fulfill({ status: 500, body: "boom" })],
    ["403", (r) => r.fulfill({ status: 403, body: "{}" })],
    ["network abort", (r) => r.abort("failed")],
  ];
  for (const [label, handler] of failures) {
    test(`${label}: one role=alert with the generic message, form stays filled, can retry`, T, async () => {
      const { page, close } = await open("/for-businesses");
      try {
        await page.route(API, handler);
        await fillValid(page);
        await submit(page);
        await page.getByText(GENERIC).waitFor();
        assert.equal(await formAlerts(page), 1);
        assert.equal(await page.locator('main form [role="alert"]').textContent(), GENERIC);
        assert.equal(await page.inputValue("#contact-email"), "asha@example.test");
        assert.equal(await page.inputValue("#contact-message"), "Hello there");
        assert.equal(await page.isChecked("#contact-consent"), true);
        assert.equal(await page.locator('button[type="submit"]').isDisabled(), false, "submit must re-enable");
      } finally {
        await close();
      }
    });
  }

  const slow500 = (counter: { n: number }) => async (r: Route) => {
    counter.n++;
    await new Promise((res) => setTimeout(res, 1000));
    await r.fulfill({ status: 500, body: "boom" });
  };
  const sendingNow = (page: Page) =>
    page.waitForFunction(() => document.querySelector('button[type="submit"]')?.getAttribute("aria-disabled") === "true");

  test("S2: double-click sends one request; aria-disabled and Sending... while in flight; restored after", T, async () => {
    const { page, close } = await open("/for-businesses");
    try {
      const c = { n: 0 };
      await page.route(API, slow500(c));
      await fillValid(page);
      const btn = page.locator('button[type="submit"]');
      await btn.dblclick();
      await sendingNow(page);
      assert.equal((await btn.textContent())?.trim(), "Sending…");
      assert.equal(await btn.getAttribute("disabled"), null, "must use aria-disabled, not disabled");
      await page.getByText(GENERIC).waitFor();
      assert.equal(c.n, 1);
      assert.equal(await btn.getAttribute("aria-disabled"), "false");
      assert.equal((await btn.textContent())?.trim(), "Send Message");
    } finally {
      await close();
    }
  });

  test("S2: keyboard double-Enter while sending: one request, focus stays on the button", T, async () => {
    const { page, close } = await open("/for-businesses");
    try {
      const c = { n: 0 };
      await page.route(API, slow500(c));
      await fillValid(page);
      const btn = page.locator('button[type="submit"]');
      await btn.focus();
      await page.keyboard.press("Enter");
      await sendingNow(page);
      await page.keyboard.press("Enter"); // aria-disabled keeps it focusable; the ref guard must swallow this
      assert.equal(await btn.evaluate((e) => e === document.activeElement), true, "focus dropped while sending");
      await page.getByText(GENERIC).waitFor();
      assert.equal(c.n, 1);
      assert.equal(await btn.evaluate((e) => e === document.activeElement), true, "focus dropped after the response");
    } finally {
      await close();
    }
  });

  // Expected to FAIL today: aria-disabled:pointer-events-none lets the 2nd click fall through to <main tabindex=-1>, which takes focus.
  test("S2: after a mouse double-click the button is still document.activeElement while sending", T, async () => {
    const { page, close } = await open("/for-businesses");
    try {
      const c = { n: 0 };
      await page.route(API, slow500(c));
      await fillValid(page);
      const btn = page.locator('button[type="submit"]');
      await btn.dblclick();
      await sendingNow(page);
      const act = await page.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}`);
      assert.equal(await btn.evaluate((e) => e === document.activeElement), true, `focus dropped to ${act}`);
    } finally {
      await close();
    }
  });

  test("S1: after an invalid submit, a valid resubmit never moves focus back to an old field", T, async () => {
    const { page, close } = await open("/for-businesses");
    try {
      await page.route(API, async (r) => {
        await new Promise((res) => setTimeout(res, 800));
        await r.fulfill({ status: 500, body: "boom" });
      });
      await submit(page); // empty: focus goes to name
      await page.waitForSelector("#contact-name-error");
      assert.equal(await activeId(page), "contact-name");
      await fillValid(page);
      await page.focus('button[type="submit"]');
      await submit(page);
      await page.waitForFunction(() => document.querySelector('button[type="submit"]')?.getAttribute("aria-disabled") === "true");
      assert.notEqual(await activeId(page), "contact-name", "in flight");
      await page.getByText(GENERIC).waitFor();
      assert.notEqual(await activeId(page), "contact-name", "after the alert");
      assert.equal(await page.locator('[aria-invalid="true"]').count(), 0, "old errors cleared");
    } finally {
      await close();
    }
  });

  test("labels: Organisation and Message say (optional); Name and Email do not", T, async () => {
    const { page, close } = await open("/about");
    try {
      const label = async (f: string) => (await page.locator(`label[for="contact-${f}"]`).textContent()) ?? "";
      assert.match(await label("organisation"), /\(optional\)/);
      assert.match(await label("message"), /\(optional\)/);
      assert.doesNotMatch(await label("name"), /optional/);
      assert.doesNotMatch(await label("email"), /optional/);
    } finally {
      await close();
    }
  });

  test("B1: without JS, a native submit does not put the fields in the URL", T, async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      const origin = new URL(server.baseUrl).origin;
      await page.route((u) => u.protocol.startsWith("http") && u.origin !== origin, (r) => r.abort());
      const urls: string[] = [];
      page.on("request", (r) => urls.push(r.url()));
      await page.goto(server.baseUrl + "/about", { waitUntil: "load" });
      await page.fill("#contact-name", "Asha Rao");
      await page.fill("#contact-email", "asha@example.test");
      await page.check("#contact-consent");
      await page.click('button[type="submit"]').catch(() => {}); // the POST to the page may 405; that is fine
      await page.waitForTimeout(1000);
      for (const u of [...urls, page.url()]) assert.doesNotMatch(u, /[?&](name|email|consent)=|Asha|asha%40|asha@/i, u);
    } finally {
      await context.close();
    }
  });
});
