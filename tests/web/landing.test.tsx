// WEB-B02 unit tests for the landing page at /. Criteria: WL-LAND-4, WL-LAND-6, WL-LAND-7, WL-LAND-9, WL-SEO-3, WL-PERF-2.
// Run: npx tsx --test tests/web/landing.test.tsx
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import { AVAILABILITY_DISCLAIMER } from "../../src/components/data/AvailabilityDisclaimer";
import { Hero } from "../../src/components/landing/Hero";
import { KnowBeforeYouGo } from "../../src/components/landing/KnowBeforeYouGo";
import { STATUS, STATUS_ORDER } from "../../src/lib/status";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const PAGE = join(SRC, "app/(marketing)/page.tsx");
const LANDING_DIR = join(SRC, "components/landing");
const decode = (s: string) => s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const hero = renderToStaticMarkup(<Hero />);
const know = renderToStaticMarkup(<KnowBeforeYouGo />);

describe("WL-LAND-6: hero search", () => {
  const form = /<form\b[^>]*>[\s\S]*?<\/form>/.exec(hero)?.[0] ?? "";
  it("is a GET form to /app with a q field", () => {
    assert.ok(form, "no <form> in the hero");
    assert.match(form, /\saction="\/app"/);
    assert.match(form, /\smethod="get"/i);
    assert.match(form, /<input\b[^>]*\sname="q"/);
  });
  it("has a visible <label> tied to the input (not placeholder-only)", () => {
    const id = /<input\b[^>]*\sid="([^"]+)"/.exec(form)?.[1];
    assert.ok(id, "input has no id");
    const label = new RegExp(`<label\\b[^>]*\\sfor="${id}"[^>]*>([\\s\\S]*?)</label>`).exec(form);
    assert.ok(label, `no <label for="${id}">`);
    assert.ok(label[1].replace(/<[^>]+>/g, "").trim().length > 0, "label is empty");
    assert.doesNotMatch(label[0], /sr-only|hidden/, "label must be visible");
  });
});

describe("WL-LAND-6: Use my location inline script (run in a vm with fakes; the real-browser run is in routes.e2e.ts)", () => {
  const src = /<script>([\s\S]*?)<\/script>/.exec(hero)?.[1];
  type Cb = (p: { coords: { latitude: number; longitude: number } }) => void;
  type Geo = { getCurrentPosition: (ok: Cb, err: () => void) => void };
  function run(geo: Geo | undefined, storage: { setItem: (k: string, v: string) => void }) {
    const calls = { geo: 0, assigned: [] as string[], prevented: 0, click: () => {} };
    const link = {
      addEventListener: (_t: string, f: (e: { preventDefault(): void }) => void) => (calls.click = () => f({ preventDefault: () => calls.prevented++ })),
      setAttribute() {},
      removeAttribute() {},
    };
    const navigator = { geolocation: geo && { getCurrentPosition: (ok: Cb, err: () => void) => { calls.geo++; geo.getCurrentPosition(ok, err); } } };
    vm.runInNewContext(src!, {
      document: { getElementById: (id: string) => (id === "fc-locate" ? link : null) },
      navigator,
      sessionStorage: storage,
      location: { assign: (u: string) => calls.assigned.push(u) },
      addEventListener() {},
      Date,
      JSON,
    });
    return calls;
  }
  it("exists and is the only script in the hero", () => {
    assert.ok(src, "no inline script in Hero");
    assert.equal((hero.match(/<script/g) ?? []).length, 1);
  });
  it("asks for nothing and stores nothing until the link is clicked", () => {
    const set: string[] = [];
    const c = run({ getCurrentPosition: () => assert.fail("asked before click") }, { setItem: (k) => set.push(k) });
    assert.equal(c.geo, 0);
    assert.deepEqual(set, []);
    assert.deepEqual(c.assigned, []);
  });
  it("on grant stores {lat,lng,t} under fc_geo and goes to a bare /app (no coordinates in the URL)", () => {
    const store: Record<string, string> = {};
    const c = run({ getCurrentPosition: (ok) => ok({ coords: { latitude: 19.07, longitude: 72.87 } }) }, { setItem: (k, v) => (store[k] = v) });
    c.click();
    assert.equal(c.geo, 1);
    assert.equal(c.prevented, 1);
    assert.deepEqual(Object.keys(store), ["fc_geo"]);
    const v = JSON.parse(store.fc_geo);
    assert.deepEqual(Object.keys(v).sort(), ["lat", "lng", "t"]);
    assert.equal(v.lat, 19.07);
    assert.equal(v.lng, 72.87);
    assert.equal(typeof v.t, "number");
    assert.deepEqual(c.assigned, ["/app"]);
  });
  it("on denial stores {denied:true} and goes to /app", () => {
    const store: Record<string, string> = {};
    const c = run({ getCurrentPosition: (_ok, err) => err() }, { setItem: (k, v) => (store[k] = v) });
    c.click();
    assert.deepEqual(JSON.parse(store.fc_geo), { denied: true });
    assert.deepEqual(c.assigned, ["/app"]);
  });
  it("still navigates if sessionStorage throws; without geolocation the link stays a normal link", () => {
    const c = run({ getCurrentPosition: (ok) => ok({ coords: { latitude: 1, longitude: 2 } }) }, { setItem: () => { throw new Error("quota"); } });
    c.click();
    assert.deepEqual(c.assigned, ["/app"]);
    const d = run(undefined, { setItem: () => {} });
    d.click();
    assert.equal(d.prevented, 0);
    assert.deepEqual(d.assigned, []);
  });
});

describe("WL-LAND-4: Example labels", () => {
  it("the sample card is labelled Example, with no operator brand, photo, score or number", () => {
    assert.match(hero, />Example</);
    assert.match(hero, /Example charging station/);
    assert.doesNotMatch(hero, /<img|<picture|background-image/i, "photo on the sample card");
    assert.doesNotMatch(hero, /Tata|Statiq|Ather|BPCL|ChargeZone|Charge Zone|Jio|Zeon|Fortum|Magenta|Kazam|Ola\b/i, "operator brand");
    assert.doesNotMatch(hero, /★|\bstars?\b|\d(\.\d)?\s*\/\s*5\b|\brating\b|\bscore\b|\breviews?\b/i, "score");
    assert.doesNotMatch(hero, /₹|\bRs\.?\s*\d|\d+\s*kW|\d+\s*km\b/i, "invented number or price");
  });
  it("any landing section that mentions an app preview also carries an Example label", () => {
    const withPreview = readdirSync(LANDING_DIR)
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => [f, readFileSync(join(LANDING_DIR, f), "utf8")] as const)
      .filter(([, code]) => /preview|mock/i.test(code));
    // The anti-vacuity guard is deliberately not an assert on length: if no section has a preview, there is nothing to label.
    for (const [f, code] of withPreview) assert.match(code, /ExampleTag|\bExample\b/, `${f} shows a preview without an Example label`);
  });
});

describe("WL-LAND-9: status cards", () => {
  it("shows the four states, in order, with the words and descriptions from status.ts", () => {
    assert.deepEqual(STATUS_ORDER.map((s) => STATUS[s].label), ["Available", "Limited", "Unavailable", "Status unknown"]);
    let at = -1;
    for (const s of STATUS_ORDER) {
      const i = know.indexOf(`>${STATUS[s].label}<`);
      assert.ok(i > at, `${STATUS[s].label} missing or out of order`);
      at = i;
      assert.ok(decode(know).includes(STATUS[s].description), `description of ${s} missing`);
    }
  });
  it('has no station-level "In use", "Maintenance" or "Out of service"', () => {
    assert.doesNotMatch(know, /in use|maintenance|out of service/i);
    assert.doesNotMatch(hero, /in use|maintenance|out of service/i);
  });
  it("shows the data disclaimer", () => {
    assert.ok(decode(know).includes(AVAILABILITY_DISCLAIMER));
  });
});

describe("WL-SEO-3: JSON-LD Organization (page.tsx rendered in a child so APP_ORIGIN is read at import, as at build)", () => {
  const jsonLd = (origin?: string) => {
    const env: Record<string, string | undefined> = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, HOME: process.env.HOME };
    if (origin !== undefined) env.APP_ORIGIN = origin;
    const code = `
      const { renderToStaticMarkup } = await import("react-dom/server");
      const { createElement: h } = await import("react");
      const mod = await import(${JSON.stringify(pathToFileURL(PAGE).href)});
      const Home = typeof mod.default === "function" ? mod.default : mod.default.default; // tsx interop for CJS-typed files
      process.stdout.write(renderToStaticMarkup(h(Home)));`;
    const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: ROOT, env: env as NodeJS.ProcessEnv, encoding: "utf8", timeout: 90_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal((r.stdout.match(/application\/ld\+json/g) ?? []).length, 1);
    const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(r.stdout);
    assert.ok(m, "no JSON-LD script on /");
    return JSON.parse(m[1]);
  };
  it("is an Organization named FullCharge with no url when APP_ORIGIN is unset", () => {
    const o = jsonLd();
    assert.equal(o["@context"], "https://schema.org");
    assert.equal(o["@type"], "Organization");
    assert.equal(o.name, "FullCharge");
    assert.ok(!("url" in o), "url must be absent without APP_ORIGIN");
  });
  it("adds url (origin only) when APP_ORIGIN is set", () => {
    const o = jsonLd("https://example.test/some/path?x=1");
    assert.equal(o.name, "FullCharge");
    assert.equal(o.url, "https://example.test");
  });
});

// ---- Source graph: everything reachable from the landing tree ----
const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const files = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : [join(d, n)]));
// "(marketing)/**" is the route group, but its legal pages are WEB-A/B legal work; the criterion is for / so page.tsx plus the landing components.
const roots = [PAGE, ...files(LANDING_DIR)].filter((f) => /\.tsx?$/.test(f));
const resolveSpec = (from: string, spec: string) => {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : resolve(dirname(from), spec);
  const hit = EXTS.map((e) => base + e).find((p) => existsSync(p) && statSync(p).isFile());
  assert.ok(hit, `${from}: cannot resolve "${spec}"`);
  return hit;
};
const BANNED = /^(?:@googlemaps\/|firebase|@firebase\/|@tanstack\/|zustand|vaul|lucide-react|next-auth|@vis\.gl|@\/store|@\/providers|@\/components\/map|@\/components\/layout)/;

describe("WL-PERF-2: no heavy client code reachable from the landing tree (transitive)", () => {
  const walk = () => {
    const seen = new Set<string>(roots);
    const queue = [...roots];
    for (let i = 0; i < queue.length; i++) {
      const code = stripComments(readFileSync(queue[i], "utf8"));
      for (const m of code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        const spec = m[1];
        assert.ok(!BANNED.test(spec), `${queue[i]} imports ${spec}`);
        if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
        const t = resolveSpec(queue[i], spec);
        if (!seen.has(t)) { seen.add(t); queue.push(t); }
      }
    }
    return seen;
  };
  it("imports no Maps, Firebase, React Query, Zustand, vaul, lucide-react or NextAuth, directly or via any module it reaches", () => {
    const seen = walk();
    assert.ok(seen.size > roots.length, "the walk never left the landing tree, so it checked nothing");
    assert.ok([...seen].some((p) => p.replace(/\\/g, "/").endsWith("src/lib/status.ts")), "walk did not reach status.ts");
  });
  it('reaches no module with "use client"', () => {
    for (const f of walk()) assert.ok(!/^\s*["']use client["']/m.test(stripComments(readFileSync(f, "utf8"))), `${f} is a client module`);
  });
});

describe("WL-LAND-7 / ADR-0017: links to /app do not prefetch", () => {
  it("the hero renders its /app links as plain <a>", () => {
    assert.ok([...hero.matchAll(/<a\b[^>]*\shref="\/app[^"]*"/g)].length >= 3, "expected Find a Charger, Use my location and Add Your Vehicle");
  });
  it("no landing source uses next/link without prefetch={false}", () => {
    for (const f of roots) {
      const code = stripComments(readFileSync(f, "utf8"));
      if (!/from\s+["']next\/link["']/.test(code)) continue;
      for (const tag of code.match(/<Link\b[^>]*>/g) ?? []) assert.match(tag, /prefetch=\{false\}/, `${f}: ${tag}`);
    }
  });
  it("ButtonLink, used for every CTA, is not next/link", () => {
    assert.doesNotMatch(stripComments(readFileSync(join(SRC, "components/ui/Button.tsx"), "utf8")), /next\/link/);
  });
});

describe("WL-LAND-7: CTAs", () => {
  it("Find a Charger goes to /app; Add Your Vehicle opens the vehicle flow", () => {
    assert.match(hero, /<a\b[^>]*href="\/app"[^>]*>Find a Charger</);
    assert.match(hero, /<a\b[^>]*href="\/app\?vehicle=pick"[^>]*>Add Your Vehicle</);
  });
});
