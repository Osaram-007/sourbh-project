// T3-01: the production Caddyfile must keep owner-only paths 404, no literal IPs/domains, loopback upstreams, log redaction. Source guard, no Caddy needed.
// Run from the repo root: npx tsx --test tests/deploy/caddy.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const src = readFileSync(resolve(process.cwd(), "deploy/caddy/Caddyfile"), "utf8")
  .split(/\r?\n/)
  .map((l) => l.replace(/#.*$/, "").trimEnd())
  .join("\n");

// Body of the first `{` block after `head` (head is a regex source), matched on structural braces only.
// `{$ENV}` and `{args[0]}` placeholders are not structural.
function block(text: string, head: string): string | undefined {
  const m = new RegExp(`(^|\\n)[ \\t]*${head}[ \\t]*\\{`).exec(text);
  if (!m) return undefined;
  const start = m.index + m[0].length;
  let depth = 1;
  for (const t of text.slice(start).matchAll(/\{\$\w+\}|\{args\[\d+\]\}|[{}]/g)) {
    if (t[0] === "{") depth++;
    else if (t[0] === "}" && --depth === 0) return text.slice(start, start + t.index);
  }
  return undefined;
}

// Inline `import name args...` with the snippet body, substituting {args[n]}.
function inline(body: string): string {
  return body.replace(/^[ \t]*import[ \t]+(\w+)(.*)$/gm, (_, name: string, rest: string) => {
    const args = rest.trim().split(/\s+/).filter(Boolean);
    const snip = block(src, `\\(${name}\\)`);
    assert.ok(snip !== undefined, `snippet ${name} is defined`);
    return inline(snip).replace(/\{args\[(\d+)\]\}/g, (_m, i: string) => args[Number(i)] ?? "");
  });
}

const site = (head: string) => {
  const b = block(src, head.replace(/[.$]/g, "\\$&").replace(/[{}]/g, "\\$&"));
  assert.ok(b !== undefined, `site ${head} exists`);
  return inline(b);
};
const prod = site("{$SITE_DOMAIN}");
const www = site("www.{$SITE_DOMAIN}");
const staging = site("{$STAGING_DOMAIN}");
const words = (s: string) => s.trim().split(/\s+/);

describe("Caddyfile owner-only paths on production (T3-01)", () => {
  const matcher = block(prod, "@owner_only") ?? "";
  it("matcher covers exactly the four owner-only prefixes", () => {
    const path = matcher.split("\n").find((l) => /^\s*path\s/.test(l)) ?? "";
    assert.deepEqual(words(path).slice(1).sort(), ["/admin*", "/api/admin*", "/api/analytics*", "/api/sync*"]);
  });
  it("is combined with not remote_ip {$OWNER_IP}", () => {
    assert.ok(matcher.split("\n").some((l) => /^\s*not\s+remote_ip\s+\{\$OWNER_IP\}\s*$/.test(l)));
  });
  it("responds 404 via handle @owner_only", () => {
    assert.match(block(prod, "handle\\s+@owner_only") ?? "", /^\s*respond\s+404\s*$/m);
  });
});

describe("Caddyfile encoded-slash rejection on production (T3-01)", () => {
  it("rule matches %2f and %5c case-insensitively in the path part of the escaped URI", () => {
    const m = prod.match(/^\s*@encoded_slash\s+`(.+)`\s*$/m);
    assert.ok(m, "@encoded_slash matcher present");
    assert.equal(m[1], '{http.request.uri}.matches("(?i)^[^?]*%(2f|5c)")');
  });
  it("responds 400 via handle @encoded_slash", () => {
    assert.match(block(prod, "handle\\s+@encoded_slash") ?? "", /^\s*respond\s+400\s*$/m);
  });
  it("comes before the owner-only handling", () => {
    const a = prod.search(/^\s*@encoded_slash\s/m);
    const h = prod.search(/^\s*handle\s+@encoded_slash\b/m);
    assert.ok(a >= 0 && h >= 0);
    assert.ok(h < prod.search(/^\s*@owner_only\s/m));
    assert.ok(h < prod.search(/^\s*handle\s+@owner_only\b/m));
  });
});

describe("Caddyfile no literals, no trusted_proxies (T3-01)", () => {
  it("site addresses come only from env placeholders", () => {
    const heads = [...src.matchAll(/^(\S.*?)\s*\{\s*$/gm)].map((m) => m[1]).filter((h) => !h.startsWith("("));
    assert.deepEqual(heads, ["{$SITE_DOMAIN}", "www.{$SITE_DOMAIN}", "{$STAGING_DOMAIN}"]);
  });
  it("no IPv4 literal except 127.0.0.1", () => {
    const ips = src.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
    assert.deepEqual(ips.filter((ip) => ip !== "127.0.0.1"), []);
  });
  it("no trusted_proxies (Caddy must replace client X-Forwarded-For)", () => {
    assert.doesNotMatch(src, /trusted_proxies/);
  });
});

describe("Caddyfile upstreams (T3-01)", () => {
  for (const [name, text, port] of [["production", prod, 3000], ["staging", staging, 3001]] as const) {
    it(`${name} proxies to 127.0.0.1:${port} with keepalive 4s`, () => {
      assert.deepEqual(text.match(/reverse_proxy\s+\S+/g)?.map((s) => words(s)[1]), [`127.0.0.1:${port}`]);
      assert.match(text, /^\s*keepalive\s+4s\s*$/m); // below Node's 5 s idle default
    });
  }
});

describe("Caddyfile staging (T3-01)", () => {
  it("is owner-IP-only (404 otherwise)", () => {
    assert.match(staging, /^\s*@not_owner\s+not\s+remote_ip\s+\{\$OWNER_IP\}\s*$/m);
    assert.match(block(staging, "handle\\s+@not_owner") ?? "", /^\s*respond\s+404\s*$/m);
  });
  it("sets X-Robots-Tag noindex", () => {
    assert.match(staging, /^\s*header\s+X-Robots-Tag\s+"?noindex"?\s*$/m);
  });
});

describe("Caddyfile HSTS (T3-01)", () => {
  it("is max-age=300 with no includeSubDomains or preload", () => {
    for (const text of [prod, www, staging]) {
      const h = text.match(/^\s*header\s+Strict-Transport-Security\s+(.+)$/m);
      assert.ok(h, "HSTS header present");
      assert.equal(h[1].replace(/"/g, "").trim(), "max-age=300");
    }
    assert.doesNotMatch(src, /includeSubDomains|preload/i);
  });
});

describe("Caddyfile log redaction (T3-01)", () => {
  const fields = block(prod, "fields") ?? "";
  const params = ["lat", "lng", "bbox", "q", "north", "south", "east", "west"];
  const deleted = (f: string) => {
    const q = block(f, "request>uri query") ?? "";
    return [...q.matchAll(/^\s*delete\s+(\S+)\s*$/gm)].map((m) => m[1]);
  };
  it("deletes location and search query params from the access log", () => {
    for (const p of params) assert.ok(deleted(fields).includes(p), `delete ${p}`);
  });
  it("default logger (5xx entries) filters request>uri the same way", () => {
    const g = block(src, "") ?? ""; // global options block: a bare `{`
    const dl = block(g, "log") ?? "";
    assert.match(dl, /^\s*wrap\s+json\s*$/m);
    for (const p of params) assert.ok(deleted(dl).includes(p), `default log delete ${p}`);
  });
  it("rolls daily and keeps 14 files / 336h", () => {
    assert.match(prod, /^\s*roll_interval\s+24h\s*$/m);
    assert.match(prod, /^\s*roll_keep\s+14\s*$/m);
    assert.match(prod, /^\s*roll_keep_for\s+336h\s*$/m);
  });
  it("deletes Cookie and Authorization request headers", () => {
    assert.match(fields, /^\s*request>headers>Cookie\s+delete\s*$/m);
    assert.match(fields, /^\s*request>headers>Authorization\s+delete\s*$/m);
  });
});

describe("Caddyfile www redirect (T3-01)", () => {
  it("redirects 301 to the apex", () => {
    assert.match(www, /^\s*redir\s+https:\/\/\{\$SITE_DOMAIN\}\{uri\}\s+301\s*$/m);
  });
});
