// Data components in src/components/data (WEB-A04): WL-APP-6 (card/row fields, missing-data texts), WL-APP-8 (no raw enums),
// WL-APP-10 (error is never "empty"; offline banner with last-updated time + retry), WL-A11Y-3 (colour + icon + word),
// WL-LEGAL-7 (availability disclaimer), ADR-0020 (four states; per-connector In use / Out of service only at LIVE or RECENT).
// Server-side markup via renderToStaticMarkup plus source checks; no DOM, no new deps.
// ErrorRetry and OfflineBanner: only their server markup is checked here. Clicking Retry, the online/offline events and
// useSyncExternalStore updates need a real browser (e2e from their first consumer, WEB-B07 / WEB-B09).
// Run from the repo root: npx tsx --test tests/web/data.test.tsx
// (Optional extra TZ check of the whole file: TZ=America/Los_Angeles npx tsx --test tests/web/data.test.tsx)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { STATUS, STATUS_ORDER, type AvailabilityState } from "../../src/lib/status";
import { AvailabilityBadge } from "../../src/components/data/AvailabilityBadge";
import { AVAILABILITY_DISCLAIMER, AvailabilityDisclaimer } from "../../src/components/data/AvailabilityDisclaimer";
import {
  connectorStatus,
  connectorTypeLabel,
  formatPower,
  formatPrice,
  NOT_LISTED,
  type AvailabilityConfidence,
  type ConnectorSourceStatus,
  type ConnectorType,
} from "../../src/components/data/connector";
import { ConnectorRow } from "../../src/components/data/ConnectorRow";
import { EmptyState } from "../../src/components/data/EmptyState";
import { ErrorRetry } from "../../src/components/data/ErrorRetry";
import { FreshnessText } from "../../src/components/data/FreshnessText";
import { OfflineBanner } from "../../src/components/data/OfflineBanner";
import { StatusIcon } from "../../src/components/data/StatusIcon";
import { StatusLegend } from "../../src/components/data/StatusLegend";
import { formatIst, freshnessLabel, toDate, UPDATE_UNKNOWN } from "../../src/components/data/time";

const DATA_DIR = resolve(process.cwd(), "src/components/data");
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
    // HTML attribute names are case-insensitive and React writes dateTime / viewBox in camel case.
    for (const a of m[2].matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) attrs[a[1].toLowerCase()] = a[2] ?? "";
    out.push({ name: m[1], attrs, end: m.index + m[0].length });
  }
  return out;
}

const tagsNamed = (html: string, name: string) => startTags(html).filter((t) => t.name === name);

/** The one start tag with this name. Fails if there are none or several. */
function only(html: string, name: string, where: (t: El) => boolean = () => true): El {
  const hits = startTags(html).filter((t) => t.name === name && where(t));
  assert.equal(hits.length, 1, `expected exactly one <${name}> in ${html}`);
  return hits[0];
}

const classes = (el: El) => (el.attrs.class ?? "").split(/\s+/).filter(Boolean);
const allClasses = (html: string) => startTags(html).flatMap(classes);
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** Visible text: tags dropped (nothing visible lives in an attribute or in svg path data), entities decoded, whitespace collapsed. */
const text = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const withoutSvg = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, "");

/** Fill colour and the two path strings that make up one status icon, read back out of the markup. */
function iconOf(html: string) {
  const svg = only(html, "svg");
  const [shape, glyph] = tagsNamed(html, "path");
  assert.ok(shape && glyph, `status icon must have a shape path and a glyph path in ${html}`);
  return { svg, fill: shape.attrs.fill, shape: shape.attrs.d, glyph: glyph.attrs.d };
}

// ---- Source files (read once; comments are stripped so doc comments cannot trip the checks) ----

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const allFiles = readdirSync(DATA_DIR);
const source = new Map(allFiles.filter((f) => /\.(tsx?|jsx?|mjs|cjs)$/.test(f)).map((f) => [f, stripComments(readFileSync(join(DATA_DIR, f), "utf8"))]));
const CLIENT_FILES = ["ErrorRetry.tsx", "OfflineBanner.tsx"];
const isClient = (code: string) => /["']use client["']/.test(code);
// Everything marketing pages may import (AvailabilityBadge, StatusLegend, FreshnessText, ConnectorRow, ...).
const serverFiles = [...source].filter(([f]) => !CLIENT_FILES.includes(f));

// ---- Fixtures ----

const NOW = new Date("2026-11-01T12:00:00Z"); // 5:30 pm IST, 1 Nov 2026
const MIN = 60_000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const from = (ms: number) => new Date(NOW.getTime() + ms);

const SOURCE_STATUSES: (ConnectorSourceStatus | null | undefined)[] = ["AVAILABLE", "OCCUPIED", "FAULTED", "UNKNOWN", null, undefined];
const CONFIDENCES: (AvailabilityConfidence | null | undefined)[] = ["LIVE", "RECENT", "HISTORICAL", "UNKNOWN", null, undefined];
const CURRENT = new Set<AvailabilityConfidence | null | undefined>(["LIVE", "RECENT"]);
const ALL_TYPES: ConnectorType[] = ["CCS2", "CHADEMO", "TYPE2", "TYPE1", "GB_T", "BHARAT_AC", "BHARAT_DC", "WALL_SOCKET"];

/** What ADR-0020 says each (status, confidence) pair must read. In use / Out of service are defined by the ADR; the other words come from status.ts. */
function expectedConnector(status: ConnectorSourceStatus | null | undefined, confidence: AvailabilityConfidence | null | undefined) {
  const unknown = { state: "UNKNOWN" as AvailabilityState, label: STATUS.UNKNOWN.label };
  if (!CURRENT.has(confidence)) return unknown;
  switch (status) {
    case "AVAILABLE":
      return { state: "AVAILABLE" as AvailabilityState, label: STATUS.AVAILABLE.label };
    case "OCCUPIED":
      return { state: "UNAVAILABLE" as AvailabilityState, label: "In use" };
    case "FAULTED":
      return { state: "UNAVAILABLE" as AvailabilityState, label: "Out of service" };
    default:
      return unknown;
  }
}

// ---- 1. connectorStatus (ADR-0020) ----

describe("connectorStatus: per-connector text only at LIVE or RECENT", () => {
  for (const status of SOURCE_STATUSES) {
    for (const confidence of CONFIDENCES) {
      it(`${String(status)} + ${String(confidence)}`, () => {
        assert.deepEqual(connectorStatus(status, confidence), expectedConnector(status, confidence));
      });
    }
  }

  it('"In use" and "Out of service" appear for exactly four combinations: OCCUPIED / FAULTED x LIVE / RECENT', () => {
    const hits: string[] = [];
    for (const s of SOURCE_STATUSES) {
      for (const c of CONFIDENCES) {
        if (/^(In use|Out of service)$/.test(connectorStatus(s, c).label)) hits.push(`${s}+${c}`);
      }
    }
    assert.deepEqual(hits.sort(), ["FAULTED+LIVE", "FAULTED+RECENT", "OCCUPIED+LIVE", "OCCUPIED+RECENT"]);
  });

  it('"Available" is never shown unless the report is LIVE or RECENT (HISTORICAL / UNKNOWN / missing confidence give "Status unknown")', () => {
    for (const c of ["HISTORICAL", "UNKNOWN", null, undefined] as const) {
      assert.deepEqual(connectorStatus("AVAILABLE", c), { state: "UNKNOWN", label: STATUS.UNKNOWN.label });
    }
  });

  it("a status or confidence the client does not know (a new server enum, wrong case, empty) reads as Status unknown, never a raw value", () => {
    for (const [s, c] of [
      ["OFFLINE", "LIVE"],
      ["occupied", "LIVE"],
      ["", "LIVE"],
      ["AVAILABLE", "live"],
      ["AVAILABLE", "STALE"],
      ["AVAILABLE", ""],
    ]) {
      const out = connectorStatus(s as never, c as never);
      assert.deepEqual(out, { state: "UNKNOWN", label: STATUS.UNKNOWN.label }, `${s} + ${c}`);
    }
  });

  it("always returns a state that exists in the status map, with a non-empty label", () => {
    for (const s of SOURCE_STATUSES) {
      for (const c of CONFIDENCES) {
        const out = connectorStatus(s, c);
        assert.ok(out.state in STATUS, `${s}+${c} -> ${out.state}`);
        assert.ok(out.label.length > 0);
      }
    }
  });
});

describe("no station-level In use or Maintenance anywhere (ADR-0020, W4)", () => {
  it("the status map has exactly the four states, in order, with no In use / Maintenance / Out of service word", () => {
    assert.deepEqual(Object.keys(STATUS).sort(), ["AVAILABLE", "LIMITED", "UNAVAILABLE", "UNKNOWN"]);
    assert.deepEqual([...STATUS_ORDER].sort(), Object.keys(STATUS).sort());
    for (const [state, entry] of Object.entries(STATUS)) {
      assert.ok(!/in use|maintenance|out of service/i.test(`${entry.label} ${entry.description}`), `${state} mentions a state ADR-0020 rejects`);
    }
  });

  it("a station-level badge and the legend never print In use, Out of service or Maintenance", () => {
    const pages = [
      ...STATUS_ORDER.map((s) => render(<AvailabilityBadge state={s} />)),
      render(<StatusLegend variant="cards" />),
      render(<StatusLegend variant="list" />),
    ];
    for (const html of pages) assert.ok(!/in use|out of service|maintenance/i.test(text(html)), text(html));
  });

  it("an unrecognised station state (e.g. MAINTENANCE from a newer server) renders as Status unknown, not as itself", () => {
    for (const bad of ["MAINTENANCE", "IN_USE", "OCCUPIED", "", undefined, null]) {
      const html = render(<AvailabilityBadge state={bad as never} />);
      assert.equal(text(html), STATUS.UNKNOWN.label);
      assert.equal(iconOf(html).fill, STATUS.UNKNOWN.color);
    }
  });

  it('the words "In use" / "Out of service" are defined once, in connector.ts; "Maintenance" is in no data component', () => {
    const where = (re: RegExp) => [...source].filter(([, code]) => re.test(code)).map(([f]) => f);
    assert.deepEqual(where(/["'`]In use["'`]/), ["connector.ts"]);
    assert.deepEqual(where(/["'`]Out of service["'`]/), ["connector.ts"]);
    assert.deepEqual(where(/maintenance/i), []);
  });
});

// ---- 2. Freshness and time ----

describe("freshnessLabel: relative under a day, IST date after", () => {
  const cases: [string, number, string][] = [
    ["0 s", 0, "Updated just now"],
    ["59.999 s", 59_999, "Updated just now"],
    ["exactly 1 min", MIN, "Updated 1 min ago"],
    ["5 min", 5 * MIN, "Updated 5 min ago"],
    ["59 min 59 s", HOUR - 1000, "Updated 59 min ago"],
    ["exactly 1 hour (singular)", HOUR, "Updated 1 hour ago"],
    ["1 h 59 m (floors, singular)", 119 * MIN, "Updated 1 hour ago"],
    ["2 hours", 2 * HOUR, "Updated 2 hours ago"],
    ["23 h 59 m 59 s", 24 * HOUR - 1000, "Updated 23 hours ago"],
    ["exactly 24 h switches to the IST date", 24 * HOUR, "Updated 31 Oct, 5:30 pm IST"],
    ["a week", 7 * 24 * HOUR, "Updated 25 Oct, 5:30 pm IST"],
  ];
  for (const [name, age, expected] of cases) {
    it(name, () => assert.equal(freshnessLabel(ago(age), NOW), expected));
  }

  it("never says 'just now' or 'ago' for a date older than a day", () => {
    for (const age of [24 * HOUR, 30 * HOUR, 400 * 24 * HOUR]) assert.ok(!/just now|ago/.test(freshnessLabel(ago(age), NOW) ?? ""));
  });
});

describe("freshnessLabel: future-dated timestamps (5-minute clock-skew tolerance)", () => {
  it("up to and including 5 minutes ahead is treated as clock skew: Updated just now", () => {
    for (const ahead of [1000, MIN, 4 * MIN, 5 * MIN - 1, 5 * MIN]) assert.equal(freshnessLabel(from(ahead), NOW), "Updated just now", `+${ahead} ms`);
  });

  it("1 ms past the tolerance and beyond is null (Update time unknown)", () => {
    for (const ahead of [5 * MIN + 1, 5 * MIN + 59_999, 6 * MIN, HOUR, 24 * HOUR, 365 * 24 * HOUR]) assert.equal(freshnessLabel(from(ahead), NOW), null, `+${ahead} ms`);
  });
});

describe("formatIst: fixed +05:30, year only when it differs from the current IST year", () => {
  // [at, now, expected]. now defaults to NOW (2026-11-01T12:00Z, IST year 2026).
  const cases: [string, string, string][] = [
    ["2026-10-31T10:12:00Z", "", "31 Oct, 3:42 pm IST"], // the documented example: UTC + 5:30
    ["2026-10-31T10:12:59.999Z", "", "31 Oct, 3:42 pm IST"], // seconds are dropped, never rounded up
    ["2026-10-31T18:29:59Z", "", "31 Oct, 11:59 pm IST"], // last second before IST midnight
    ["2026-10-31T18:30:00Z", "", "1 Nov, 12:00 am IST"], // IST midnight: the date rolls although the UTC date is still 31 Oct
    ["2026-10-31T20:00:00Z", "", "1 Nov, 1:30 am IST"],
    ["2026-10-31T18:45:00Z", "", "1 Nov, 12:15 am IST"], // 12 am, not 0 am
    ["2026-10-31T06:29:00Z", "", "31 Oct, 11:59 am IST"],
    ["2026-10-31T06:30:00Z", "", "31 Oct, 12:00 pm IST"], // noon is 12 pm, not 0 pm
    ["2026-10-31T07:00:00Z", "", "31 Oct, 12:30 pm IST"],
    ["2026-01-01T00:00:00Z", "", "1 Jan, 5:30 am IST"], // same year: no year
    ["2025-12-31T20:00:00Z", "", "1 Jan, 1:30 am IST"], // UTC year is 2025 but the IST year is 2026 = current: no year
    ["2025-12-31T10:00:00Z", "", "31 Dec 2025, 3:30 pm IST"], // previous year: year shown
    ["2020-01-01T00:00:00Z", "", "1 Jan 2020, 5:30 am IST"],
    ["2026-12-31T19:00:00Z", "", "1 Jan 2027, 12:30 am IST"], // IST year 2027 differs from 2026
    ["2028-02-28T19:00:00Z", "", "29 Feb 2028, 12:30 am IST"], // leap day reached through the +5:30 shift
    ["2026-12-30T10:00:00Z", "2026-12-31T19:00:00Z", "30 Dec 2026, 3:30 pm IST"], // now is already 2027 in IST (UTC says 2026)
    ["2027-01-01T00:00:00Z", "2026-12-31T19:00:00Z", "1 Jan, 5:30 am IST"], // same IST year as now
    ["2026-10-31T15:42:00+05:30", "", "31 Oct, 3:42 pm IST"], // an offset in the input is honoured
    ["2026-10-31T15:42:00+00:00", "", "31 Oct, 9:12 pm IST"],
  ];
  for (const [at, now, expected] of cases) {
    it(`${at}${now ? ` (now ${now})` : ""} -> ${expected}`, () => {
      assert.equal(formatIst(new Date(at), now ? new Date(now) : NOW), expected);
    });
  }

  it("always ends in ' IST' and never in a local zone abbreviation", () => {
    for (const [at] of cases) assert.match(formatIst(new Date(at), NOW), /, \d{1,2}:\d{2} (?:am|pm) IST$/);
  });
});

describe("toDate: only a real instant gets through", () => {
  it("null, undefined, empty and unparseable values give null", () => {
    for (const bad of [null, undefined, "", "   ", "not a date", "2026-13-45", "yesterday", Number.NaN, Number.POSITIVE_INFINITY, new Date(Number.NaN)]) {
      assert.equal(toDate(bad), null, String(bad));
    }
  });

  it("Date, ISO string and epoch ms give the same instant", () => {
    const iso = "2026-10-31T10:12:00.000Z";
    const ms = Date.parse(iso);
    for (const ok of [new Date(iso), iso, ms]) assert.equal(toDate(ok)?.getTime(), ms);
  });

  // new Date("2026-10-31T15:42:00") is local time per ECMA-262: on the UTC production VM that same string would
  // mean an instant 5 h 30 m away from what an IST source meant, i.e. stale data shown as fresh (T-1).
  it("a string without a zone designator gives null instead of a host-zone guess", () => {
    for (const naive of ["2026-10-31T15:42:00", "2026-10-31T15:42:00.123", "2026-10-31T15:42", "2026-10-31", "2026-10-31 15:42:00", "31 Oct 2026 15:42"]) {
      assert.equal(toDate(naive), null, naive);
    }
  });

  it("every accepted zone form gives the same instant", () => {
    const ms = Date.parse("2026-10-31T10:12:00.000Z");
    for (const ok of ["2026-10-31T10:12:00Z", "2026-10-31T10:12:00z", "2026-10-31T10:12:00.000Z", "2026-10-31T15:42:00+05:30", "2026-10-31T15:42:00+0530", "2026-10-31T02:12:00-08:00", "2026-10-31T02:12:00-0800", "2026-10-31T10:12:00+00:00"]) {
      assert.equal(toDate(ok)?.getTime(), ms, ok);
    }
  });

  it("a Date object is unambiguous and still gets through", () => {
    const d = new Date("2026-10-31T10:12:00.000Z");
    assert.equal(toDate(d), d);
  });
});

describe("FreshnessText", () => {
  it("a recent time is a <time> element: ISO dateTime, the full IST time as title, the relative label as text", () => {
    const html = render(<FreshnessText at={ago(5 * MIN)} now={NOW} />);
    const el = only(html, "time");
    assert.equal(el.attrs.datetime, ago(5 * MIN).toISOString());
    assert.equal(el.attrs.title, "1 Nov, 5:25 pm IST");
    assert.equal(text(html), "Updated 5 min ago");
  });

  it("an old time reads as an explicit IST date, and the year appears only when it is not the current IST year", () => {
    assert.equal(text(render(<FreshnessText at="2026-10-31T10:12:00Z" now={NOW} />)), "Updated 31 Oct, 3:42 pm IST");
    assert.equal(text(render(<FreshnessText at="2025-10-31T10:12:00Z" now={NOW} />)), "Updated 31 Oct 2025, 3:42 pm IST");
  });

  it("accepts Date, ISO string and epoch ms for `at`, and Date or epoch ms for `now`", () => {
    const at = ago(2 * HOUR);
    const want = "Updated 2 hours ago";
    for (const a of [at, at.toISOString(), at.getTime()]) {
      assert.equal(text(render(<FreshnessText at={a} now={NOW} />)), want);
      assert.equal(text(render(<FreshnessText at={a} now={NOW.getTime()} />)), want);
    }
  });

  it("without `now` it uses the real clock", () => {
    assert.match(text(render(<FreshnessText at={new Date(Date.now() - 2 * MIN)} />)), /^Updated [23] min ago$/);
    assert.equal(text(render(<FreshnessText at={new Date()} />)), "Updated just now");
  });

  const UNKNOWN_INPUTS: [string, unknown][] = [
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["unparseable string", "not a date"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["Invalid Date", new Date(Number.NaN)],
    ["1 ms past the 5-minute tolerance", from(5 * MIN + 1)],
    ["6 minutes ahead", from(6 * MIN)],
    ["a day ahead", from(24 * HOUR)],
    ["year 2099", new Date("2099-01-01T00:00:00Z")],
  ];
  for (const [name, at] of UNKNOWN_INPUTS) {
    it(`${name} -> "${UPDATE_UNKNOWN}", with no <time>, no title and no relative word`, () => {
      const html = render(<FreshnessText at={at as never} now={NOW} />);
      assert.equal(text(html), "Update time unknown");
      assert.equal(tagsNamed(html, "time").length, 0);
      assert.ok(!("title" in only(html, "span").attrs));
      assert.ok(!/just now|ago|Updated/.test(html));
    });
  }

  it("within the tolerance (5 minutes ahead) it still shows a time", () => {
    assert.equal(text(render(<FreshnessText at={from(5 * MIN)} now={NOW} />)), "Updated just now");
  });

  it("the text is ink-muted, never a status colour, and there is no inline style", () => {
    for (const at of [ago(MIN), null]) {
      const html = render(<FreshnessText at={at} now={NOW} className="extra" />);
      const cls = allClasses(html);
      assert.ok(cls.includes("text-ink-muted") && cls.includes("extra"));
      assert.ok(!cls.some((c) => /status/.test(c)));
      assert.ok(!/\sstyle=/.test(html));
    }
  });
});

// The machine running the tests may well be in IST, which would hide a dependence on the local zone. So the same
// inputs are formatted by child processes started with other TZ values (one with DST, one at +14) and compared
// with literal expectations. The child sanity-checks that the TZ really took effect.
describe("time output is identical whatever the machine's TZ", () => {
  interface Row {
    at: string;
    now: string;
    /** null = the string carries no zone, so toDate rejects it and FreshnessText says "Update time unknown". */
    ist: string | null;
    fresh: string | null;
  }
  const N = "2026-11-01T12:00:00Z";
  const L = "2026-11-03T00:00:00Z";
  const ROWS: Row[] = [
    { at: "2026-11-01T11:59:30Z", now: N, ist: "1 Nov, 5:29 pm IST", fresh: "Updated just now" },
    { at: "2026-11-01T11:55:00Z", now: N, ist: "1 Nov, 5:25 pm IST", fresh: "Updated 5 min ago" },
    { at: "2026-11-01T06:00:00Z", now: N, ist: "1 Nov, 11:30 am IST", fresh: "Updated 6 hours ago" },
    { at: "2026-10-31T10:12:00Z", now: N, ist: "31 Oct, 3:42 pm IST", fresh: "Updated 31 Oct, 3:42 pm IST" },
    { at: "2026-10-31T18:29:59Z", now: L, ist: "31 Oct, 11:59 pm IST", fresh: "Updated 31 Oct, 11:59 pm IST" },
    { at: "2026-10-31T18:30:00Z", now: L, ist: "1 Nov, 12:00 am IST", fresh: "Updated 1 Nov, 12:00 am IST" },
    { at: "2026-10-31T06:30:00Z", now: L, ist: "31 Oct, 12:00 pm IST", fresh: "Updated 31 Oct, 12:00 pm IST" },
    { at: "2025-12-31T20:00:00Z", now: N, ist: "1 Jan, 1:30 am IST", fresh: "Updated 1 Jan, 1:30 am IST" },
    { at: "2025-12-31T10:00:00Z", now: N, ist: "31 Dec 2025, 3:30 pm IST", fresh: "Updated 31 Dec 2025, 3:30 pm IST" },
    { at: "2026-12-30T10:00:00Z", now: "2026-12-31T19:00:00Z", ist: "30 Dec 2026, 3:30 pm IST", fresh: "Updated 30 Dec 2026, 3:30 pm IST" },
    { at: "2026-10-31T15:42:00+05:30", now: N, ist: "31 Oct, 3:42 pm IST", fresh: "Updated 31 Oct, 3:42 pm IST" },
    { at: "2026-10-31T15:42:00+00:00", now: N, ist: "31 Oct, 9:12 pm IST", fresh: "Updated 20 hours ago" },
    { at: "2027-03-01T00:00:00Z", now: N, ist: "1 Mar 2027, 5:30 am IST", fresh: null }, // future
    { at: "2026-10-31T15:42:00+0530", now: N, ist: "31 Oct, 3:42 pm IST", fresh: "Updated 31 Oct, 3:42 pm IST" }, // compact offset
    { at: "2026-11-01T11:55:00-0800", now: N, ist: "2 Nov, 1:25 am IST", fresh: null }, // compact negative offset: future
    // Zone-less strings: rejected in every zone, so they can never become a host-zone guess (T-1).
    { at: "2026-11-01T11:55:00", now: N, ist: null, fresh: null }, // would be "Updated 5 min ago" if read as UTC
    { at: "2026-10-31T15:42:00", now: N, ist: null, fresh: null }, // the IST-date path
    { at: "2026-10-31", now: N, ist: null, fresh: null }, // date-only
  ];
  const BANNER = "You are offline. Showing data from 1 Jan 2020, 5:30 am IST.";
  const render1 = (r: Row) => render(<FreshnessText at={r.at} now={new Date(r.now)} />);

  it("in this process (whatever its TZ is) the literal expectations hold", () => {
    assert.ok(ROWS.some((r) => r.ist === null), "no zone-less row: the parsing path would go unproven");
    for (const r of ROWS) {
      if (r.ist === null) {
        assert.equal(toDate(r.at), null, r.at);
        assert.equal(text(render1(r)), UPDATE_UNKNOWN, r.at);
        continue;
      }
      assert.equal(formatIst(new Date(r.at), new Date(r.now)), r.ist, r.at);
      assert.equal(freshnessLabel(new Date(r.at), new Date(r.now)), r.fresh, r.at);
    }
    assert.equal(text(render(<OfflineBanner lastUpdated="2020-01-01T00:00:00Z" onRetry={() => {}} offline />)).slice(0, BANNER.length), BANNER);
  });

  // CommonJS child with require(): the same path as this file's own imports (package.json has no "type", so tsx
  // compiles them to require). An ESM import() of a .ts file goes through CJS interop, and its named exports are
  // missing under tsx's async hooks (Node < 24.11.1, e.g. Node 22 in CI): "formatIst is not a function".
  const CHILD = `
    const load = (f) => require(process.env.DATA_DIR + "/" + f);
    const { formatIst, freshnessLabel, toDate } = load("time.ts");
    const { FreshnessText } = load("FreshnessText.tsx");
    const { OfflineBanner } = load("OfflineBanner.tsx");
    const { createElement: h } = require("react");
    const { renderToStaticMarkup: render } = require("react-dom/server");
    const rows = JSON.parse(process.env.ROWS);
    console.log("RESULT " + JSON.stringify({
      offsets: [new Date(2026, 0, 1).getTimezoneOffset(), new Date(2026, 6, 1).getTimezoneOffset()],
      ist: rows.map((r) => (r.ist === null ? toDate(r.at) : formatIst(new Date(r.at), new Date(r.now)))),
      fresh: rows.map((r) => (r.ist === null ? toDate(r.at) : freshnessLabel(new Date(r.at), new Date(r.now)))),
      markup: rows.map((r) => render(h(FreshnessText, { at: r.at, now: new Date(r.now) }))),
      banner: render(h(OfflineBanner, { lastUpdated: "2020-01-01T00:00:00Z", onRetry() {}, offline: true })),
    }));
  `;
  // [TZ, getTimezoneOffset() on 1 Jan 2026, on 1 Jul 2026]
  const ZONES: [string, number, number][] = [
    ["Asia/Kolkata", -330, -330],
    ["UTC", 0, 0],
    ["America/Los_Angeles", 480, 420], // DST in July
    ["Pacific/Kiritimati", -840, -840], // UTC+14: a different calendar day from IST for most of the day
    ["Pacific/Pago_Pago", 660, 660], // UTC-11
  ];
  for (const [tz, jan, jul] of ZONES) {
    it(`TZ=${tz}`, () => {
      const env: NodeJS.ProcessEnv = { ...process.env, TZ: tz, DATA_DIR, ROWS: JSON.stringify(ROWS) };
      delete env.NODE_TEST_CONTEXT; // otherwise the child thinks it is a node:test worker
      const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=commonjs", "-e", CHILD], { cwd: process.cwd(), env, encoding: "utf8", timeout: 90_000 });
      assert.equal(run.status, 0, `child failed: ${run.stderr || run.error}`);
      const line = run.stdout.split("\n").find((l) => l.startsWith("RESULT "));
      assert.ok(line, `no RESULT line in: ${run.stdout}`);
      const out = JSON.parse(line.slice("RESULT ".length)) as { offsets: number[]; ist: string[]; fresh: (string | null)[]; markup: string[]; banner: string };
      assert.deepEqual(out.offsets, [jan, jul], "TZ did not take effect in the child, so this run proves nothing");
      assert.deepEqual(out.ist, ROWS.map((r) => r.ist));
      assert.deepEqual(out.fresh, ROWS.map((r) => r.fresh));
      assert.deepEqual(out.markup, ROWS.map(render1));
      assert.equal(text(out.banner).slice(0, BANNER.length), BANNER);
    });
  }
});

// ---- 3. Formatters ----

describe("formatPower", () => {
  it("null, undefined, NaN, Infinity, negatives, 0 and -0 give 'Power not listed'", () => {
    for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -50, 0, -0]) {
      assert.equal(formatPower(v), "Power not listed", String(v));
    }
  });

  it("values that would round to 0 kW give 'Power not listed', never '0 kW' or '0.0 kW'", () => {
    for (const v of [Number.MIN_VALUE, 1e-9, 0.001, 0.01, 0.04, 0.049, 0.0499999]) assert.equal(formatPower(v), "Power not listed", String(v));
  });

  it("no value in a fine sweep from 0 to 5 kW prints a zero", () => {
    for (let i = 0; i <= 5000; i++) {
      const out = formatPower(i / 1000);
      assert.ok(!/^0(?:\.0)? kW$/.test(out), `${i / 1000} -> ${out}`);
    }
  });

  it("real values format with kW", () => {
    const cases: [number, string][] = [
      [0.1, "0.1 kW"],
      [3.3, "3.3 kW"],
      [7.4, "7.4 kW"],
      [22, "22 kW"],
      [50, "50 kW"],
      [60, "60 kW"],
      [150, "150 kW"],
      [350, "350 kW"],
      [1000, "1,000 kW"],
    ];
    for (const [v, want] of cases) assert.equal(formatPower(v), want);
  });

  it("a number-like string is not a number (it is not listed, not coerced)", () => {
    assert.equal(formatPower("50" as never), "Power not listed");
  });
});

describe("formatPrice", () => {
  it("null, undefined, NaN, Infinity, negatives, 0 and -0 give 'Price not listed', never Free or 0", () => {
    for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -18, 0, -0]) {
      const out = formatPrice(v);
      assert.equal(out, "Price not listed", String(v));
      assert.ok(!/free|₹0/i.test(out));
    }
  });

  it("values that would round to ₹0 give 'Price not listed'", () => {
    for (const v of [Number.MIN_VALUE, 1e-9, 0.0001, 0.001, 0.004, 0.0049999]) assert.equal(formatPrice(v), "Price not listed", String(v));
  });

  it("no value in a fine sweep from 0 to ₹1 prints ₹0", () => {
    for (let i = 0; i <= 10_000; i++) {
      const out = formatPrice(i / 10_000);
      assert.ok(!/^₹0(?:\.0+)?\/kWh$/.test(out), `${i / 10_000} -> ${out}`);
    }
  });

  it("real values format as ₹ per kWh", () => {
    const cases: [number, string][] = [
      [0.01, "₹0.01/kWh"],
      [10, "₹10/kWh"],
      [12.75, "₹12.75/kWh"],
      [18, "₹18/kWh"],
      [18.5, "₹18.5/kWh"],
      [24, "₹24/kWh"],
      [1234.5, "₹1,234.5/kWh"],
    ];
    for (const [v, want] of cases) assert.equal(formatPrice(v), want);
  });

  it("a number-like string is not a number", () => {
    assert.equal(formatPrice("18" as never), "Price not listed");
  });
});

describe("connectorTypeLabel", () => {
  it("null and undefined give 'Connector not listed' (no default type)", () => {
    for (const v of [null, undefined]) assert.equal(connectorTypeLabel(v), "Connector not listed");
  });

  it("a type the client does not know (new server enum, lower case, empty) is 'Connector not listed', not the raw value", () => {
    for (const v of ["NACS", "ccs2", "", "OTHER", "UNKNOWN"]) assert.equal(connectorTypeLabel(v as never), "Connector not listed", v);
  });

  it("every known type has a human label, never the raw enum with underscores", () => {
    const labels = ALL_TYPES.map(connectorTypeLabel);
    assert.equal(new Set(labels).size, ALL_TYPES.length, "labels must be distinct");
    for (const [i, label] of labels.entries()) {
      assert.notEqual(label, "Connector not listed", ALL_TYPES[i]);
      assert.ok(!label.includes("_"), `${ALL_TYPES[i]} -> ${label}`);
    }
    assert.deepEqual(
      Object.fromEntries(ALL_TYPES.map((t, i) => [t, labels[i]])),
      { CCS2: "CCS2", CHADEMO: "CHAdeMO", TYPE2: "Type 2", TYPE1: "Type 1", GB_T: "GB/T", BHARAT_AC: "Bharat AC", BHARAT_DC: "Bharat DC", WALL_SOCKET: "Wall socket" },
    );
  });

  it("the not-listed texts are the spec-mobile 5.0 words, with the web wording 'Price not listed'", () => {
    assert.deepEqual({ ...NOT_LISTED }, { connector: "Connector not listed", power: "Power not listed", price: "Price not listed" });
  });
});

// ---- 4. AvailabilityBadge, StatusIcon, StatusLegend ----

describe("StatusIcon", () => {
  for (const state of STATUS_ORDER) {
    it(`${state}: an aria-hidden svg filled with ${STATUS[state].token}`, () => {
      const html = render(<StatusIcon state={state} />);
      const { svg, fill, shape, glyph } = iconOf(html);
      assert.equal(svg.attrs["aria-hidden"], "true");
      assert.equal(fill, STATUS[state].color);
      assert.ok(shape && glyph, "both paths are non-empty");
      assert.equal(svg.attrs.width, "16");
      assert.equal(svg.attrs.height, "16");
      // The word beside the icon is the accessible name: the icon adds none of its own.
      assert.ok(!/<title|<desc|aria-label|role=/.test(html));
      assert.ok(!/\sstyle=/.test(html));
    });
  }

  it("`size` sets width and height", () => {
    const { svg } = iconOf(render(<StatusIcon state="LIMITED" size={28} />));
    assert.equal(svg.attrs.width, "28");
    assert.equal(svg.attrs.height, "28");
  });

  it("the four icons are visibly different (shape + glyph) and the four colours differ (WL-A11Y-3)", () => {
    const icons = STATUS_ORDER.map((s) => iconOf(render(<StatusIcon state={s} />)));
    assert.equal(new Set(icons.map((i) => `${i.shape}|${i.glyph}`)).size, 4);
    assert.equal(new Set(icons.map((i) => i.fill)).size, 4);
  });

  it("every var(--...) the icon uses is defined in globals.css", () => {
    const theme = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    for (const state of STATUS_ORDER) {
      const vars = [...render(<StatusIcon state={state} />).matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);
      assert.ok(vars.length >= 2, "fill and stroke use tokens");
      for (const v of vars) assert.ok(theme.has(v), `${v} is not defined in globals.css`);
    }
  });

  it("an unexpected state shows the grey Unknown icon, not a blank or a crash", () => {
    const unknown = iconOf(render(<StatusIcon state="UNKNOWN" />));
    for (const bad of ["MAINTENANCE", "", undefined, null]) {
      const got = iconOf(render(<StatusIcon state={bad as never} />));
      assert.deepEqual({ ...got, svg: null }, { ...unknown, svg: null });
    }
  });
});

describe("AvailabilityBadge", () => {
  for (const state of STATUS_ORDER) {
    it(`${state}: icon + word "${STATUS[state].label}" (from status.ts), the word in ink, the icon hidden`, () => {
      const html = render(<AvailabilityBadge state={state} />);
      const root = startTags(html)[0];
      assert.equal(root.name, "span");
      assert.ok(classes(root).includes("text-ink"), "the word is ink");
      // The word is the only text outside the svg, and it is exactly the status-map label.
      assert.equal(text(withoutSvg(html)), STATUS[state].label);
      const { svg, fill } = iconOf(html);
      assert.equal(svg.attrs["aria-hidden"], "true");
      assert.equal(fill, STATUS[state].color, "the colour is on the icon");
      // Colour is never on the text: no status text/background class, no inline style.
      assert.ok(!allClasses(html).some((c) => /(?:^|:)(?:text|bg|border)-status-/.test(c)));
      assert.ok(!/\sstyle=/.test(html));
    });
  }

  it("the four badges differ in icon, colour and word, so colour is never the only signal", () => {
    const parts = STATUS_ORDER.map((s) => {
      const html = render(<AvailabilityBadge state={s} />);
      return { word: text(html), ...iconOf(html) };
    });
    for (const key of ["word", "fill"] as const) assert.equal(new Set(parts.map((p) => p[key])).size, 4, key);
    assert.equal(new Set(parts.map((p) => `${p.shape}|${p.glyph}`)).size, 4);
  });

  it("`label` replaces the word only (per-connector text); the icon still comes from `state`", () => {
    const html = render(<AvailabilityBadge state="UNAVAILABLE" label="In use" />);
    assert.equal(text(html), "In use");
    assert.equal(iconOf(html).fill, STATUS.UNAVAILABLE.color);
    assert.ok(!html.includes(STATUS.UNAVAILABLE.label));
  });

  it("className is appended to the root", () => {
    assert.ok(classes(startTags(render(<AvailabilityBadge state="AVAILABLE" className="ml-2" />))[0]).includes("ml-2"));
  });
});

describe("AvailabilityDisclaimer and StatusLegend", () => {
  it("the disclaimer is a paragraph: an aria-hidden info icon plus the text, with no verified / live claim (T-2)", () => {
    const html = render(<AvailabilityDisclaimer />);
    assert.ok(AVAILABILITY_DISCLAIMER.length > 20);
    assert.equal(text(html), AVAILABILITY_DISCLAIMER);
    assert.equal(startTags(html)[0].name, "p");
    assert.equal(only(html, "svg").attrs["aria-hidden"], "true");
    assert.ok(!/\bverified\b|\blive\b|real[- ]?time|guarantee/i.test(AVAILABILITY_DISCLAIMER), AVAILABILITY_DISCLAIMER);
  });

  for (const variant of ["cards", "list"] as const) {
    describe(`StatusLegend variant="${variant}"`, () => {
      const html = render(<StatusLegend variant={variant} />);
      const items = html.match(/<li\b[\s\S]*?<\/li>/g) ?? [];

      it("lists exactly the four states, in STATUS_ORDER, with the label and description from status.ts", () => {
        assert.equal(items.length, STATUS_ORDER.length);
        for (const [i, state] of STATUS_ORDER.entries()) {
          const li = items[i];
          const ps = tagsNamed(li, "p");
          assert.equal(text(li.slice(ps[0].end, li.indexOf("</p>", ps[0].end))), STATUS[state].label);
          assert.ok(text(li).includes(STATUS[state].description), `${state} description`);
        }
      });

      it("each item has an aria-hidden icon in the state's colour, and the word is in ink", () => {
        for (const [i, state] of STATUS_ORDER.entries()) {
          const { svg, fill } = iconOf(items[i]);
          assert.equal(svg.attrs["aria-hidden"], "true");
          assert.equal(fill, STATUS[state].color);
          const label = tagsNamed(items[i], "p")[0];
          assert.ok(classes(label).includes("text-ink"), `${state} word is ink`);
        }
        assert.ok(!allClasses(html).some((c) => /(?:^|:)(?:text|bg|border)-status-/.test(c)));
      });

      it("includes the disclaimer by default and with showDisclaimer, and omits it with showDisclaimer={false}", () => {
        assert.ok(text(html).includes(AVAILABILITY_DISCLAIMER));
        assert.ok(text(render(<StatusLegend variant={variant} showDisclaimer />)).includes(AVAILABILITY_DISCLAIMER));
        const without = render(<StatusLegend variant={variant} showDisclaimer={false} />);
        assert.ok(!text(without).includes(AVAILABILITY_DISCLAIMER));
        assert.equal(tagsNamed(without, "svg").length, STATUS_ORDER.length, "only the four status icons remain");
      });

      it("shows the disclaimer once", () => {
        assert.equal(text(html).split(AVAILABILITY_DISCLAIMER).length - 1, 1);
      });
    });
  }

  it("className reaches the root, and the variants differ in layout but not in words", () => {
    const cards = render(<StatusLegend variant="cards" className="mt-6" />);
    const list = render(<StatusLegend variant="list" className="mt-6" />);
    assert.ok(classes(startTags(cards)[0]).includes("mt-6"));
    assert.notEqual(cards, list);
    assert.equal(text(cards), text(list));
  });

  it("the default variant is cards", () => {
    assert.equal(render(<StatusLegend />), render(<StatusLegend variant="cards" />));
  });
});

// ---- 5. EmptyState, ConnectorRow ----

describe("EmptyState", () => {
  it("title in ink, a hidden default icon, and nothing else when only a title is given", () => {
    const html = render(<EmptyState title="No chargers found" />);
    const ps = tagsNamed(html, "p");
    assert.equal(ps.length, 1);
    assert.ok(classes(ps[0]).includes("text-ink"));
    assert.equal(text(html), "No chargers found");
    assert.match(html, /<span[^>]*aria-hidden="true"[^>]*><svg/, "the default icon sits inside an aria-hidden wrapper");
  });

  it("an empty or missing description renders no paragraph (and no 'undefined')", () => {
    for (const description of [undefined, "", null, false]) {
      const html = render(<EmptyState title="Nothing saved" description={description as never} />);
      assert.equal(tagsNamed(html, "p").length, 1);
      assert.ok(!/undefined|null|false/.test(html));
    }
  });

  it("description and action render, the action after the text", () => {
    const html = render(<EmptyState title="No results" description="Try a wider search." action={<a href="/app">Clear filters</a>} />);
    assert.ok(text(html).startsWith("No results Try a wider search."));
    assert.equal(only(html, "a").attrs.href, "/app");
    assert.ok(html.indexOf("Try a wider search.") < html.indexOf("Clear filters"));
    assert.ok(classes(tagsNamed(html, "p")[1]).includes("text-ink-muted"));
  });

  it("a custom icon replaces the default search glyph and stays hidden from assistive tech", () => {
    const html = render(<EmptyState title="x" icon={<i data-custom="1" />} />);
    assert.ok(html.includes('data-custom="1"'));
    assert.ok(!html.includes("<circle"), "default glyph is gone");
    assert.match(html, /<span[^>]*aria-hidden="true"[^>]*><i /);
  });

  it("is not a live region and not an alert (an error is never an empty state), and is no heading", () => {
    const html = render(<EmptyState title="No results" description="d" />);
    assert.ok(!/role=|aria-live/.test(html));
    assert.equal(tagsNamed(html, "h1").length, 0);
  });

  it("escapes the title and takes a className", () => {
    const html = render(<EmptyState title={"<script>alert(1)</script>"} className="extra" />);
    assert.ok(!html.includes("<script>"));
    assert.ok(classes(startTags(html)[0]).includes("extra"));
  });
});

describe("ConnectorRow", () => {
  const full = (
    <ConnectorRow type="CCS2" currentType="DC" powerKw={60} pricePerKwh={18} status="AVAILABLE" confidence="LIVE" updatedAt="2020-01-01T00:00:00Z" />
  );

  it("renders a single <li> as its root, so it belongs inside a <ul>", () => {
    const html = render(full);
    assert.equal(startTags(html)[0].name, "li");
    assert.ok(html.startsWith("<li") && html.endsWith("</li>"));
    assert.equal(tagsNamed(html, "li").length, 1);
    const inList = render(
      <ul>
        {full}
        {full}
      </ul>,
    );
    assert.equal(tagsNamed(inList, "li").length, 2);
  });

  it("shows type, AC/DC, power, price, status badge and its own time", () => {
    const html = render(full);
    const t = text(html);
    for (const part of ["CCS2", "DC", "60 kW", "₹18/kWh", STATUS.AVAILABLE.label, "Updated 1 Jan 2020, 5:30 am IST"]) assert.ok(t.includes(part), `${part} in ${t}`);
    assert.equal(iconOf(html).fill, STATUS.AVAILABLE.color);
  });

  it("with every value null it prints the not-listed texts and Status unknown, and not one digit or default", () => {
    const html = render(<ConnectorRow type={null} currentType={null} powerKw={null} pricePerKwh={null} status={null} confidence={null} />);
    const t = text(html);
    assert.equal(t, `${NOT_LISTED.connector} ${NOT_LISTED.power} ${NOT_LISTED.price} ${STATUS.UNKNOWN.label}`);
    assert.ok(!/\d/.test(t), `fabricated number in: ${t}`);
    assert.equal(iconOf(html).fill, STATUS.UNKNOWN.color);
  });

  it("zero, NaN and Infinity power or price are not listed (never '0 kW' or 'Free')", () => {
    for (const bad of [0, Number.NaN, Number.POSITIVE_INFINITY, -3]) {
      const t = text(render(<ConnectorRow type="TYPE2" powerKw={bad} pricePerKwh={bad} status="AVAILABLE" confidence="LIVE" />));
      assert.ok(t.includes(NOT_LISTED.power) && t.includes(NOT_LISTED.price), t);
      assert.ok(!/0 kW|free|₹|NaN|Infinity/i.test(t), t);
    }
  });

  it("an unknown connector type reads 'Connector not listed' and does not hide the other fields", () => {
    const t = text(render(<ConnectorRow type={"NACS" as never} powerKw={11} pricePerKwh={9} status="AVAILABLE" confidence="RECENT" />));
    assert.ok(t.includes("Connector not listed") && t.includes("11 kW") && t.includes("₹9/kWh") && !t.includes("NACS"));
  });

  it("AC/DC appears only when given", () => {
    const base = { type: "TYPE2", powerKw: 7.4, pricePerKwh: 10, status: "AVAILABLE", confidence: "LIVE" } as const;
    assert.ok(!/\b(AC|DC)\b/.test(text(render(<ConnectorRow {...base} />))));
    assert.ok(!/\b(AC|DC)\b/.test(text(render(<ConnectorRow {...base} currentType={null} />))));
    assert.match(text(render(<ConnectorRow {...base} currentType="AC" />)), /Type 2 AC\b/);
  });

  it("updatedAt: undefined shows no time line, null shows 'Update time unknown', a date shows its IST time, a future time is unknown", () => {
    const base = { type: "CCS2", powerKw: 50, pricePerKwh: 20, status: "AVAILABLE", confidence: "LIVE" } as const;
    const none = render(<ConnectorRow {...base} />);
    assert.ok(!/Updated|Update time unknown/.test(none));
    assert.ok(text(render(<ConnectorRow {...base} updatedAt={null} />)).includes("Update time unknown"));
    assert.equal(tagsNamed(render(<ConnectorRow {...base} updatedAt="2020-01-01T00:00:00Z" />), "time").length, 1);
    const future = render(<ConnectorRow {...base} updatedAt={new Date(Date.now() + 24 * HOUR)} />);
    assert.ok(text(future).includes("Update time unknown") && tagsNamed(future, "time").length === 0);
  });

  for (const status of SOURCE_STATUSES) {
    for (const confidence of CONFIDENCES) {
      it(`status ${String(status)} + confidence ${String(confidence)} shows the ADR-0020 word and its icon`, () => {
        const html = render(<ConnectorRow type="CCS2" powerKw={50} pricePerKwh={20} status={status ?? null} confidence={confidence ?? null} />);
        const want = expectedConnector(status, confidence);
        assert.ok(text(withoutSvg(html)).endsWith(want.label), text(html));
        assert.equal(iconOf(html).fill, STATUS[want.state].color);
      });
    }
  }

  it("never prints a raw enum (WL-APP-8): not the source status, the confidence or the connector type", () => {
    const raw = /\b(?:AVAILABLE|OCCUPIED|FAULTED|UNKNOWN|LIVE|RECENT|HISTORICAL|CHADEMO|TYPE1|TYPE2|GB_T|BHARAT_AC|BHARAT_DC|WALL_SOCKET)\b/;
    for (const type of [...ALL_TYPES, null]) {
      for (const status of SOURCE_STATUSES) {
        for (const confidence of CONFIDENCES) {
          const t = text(render(<ConnectorRow type={type} powerKw={22} pricePerKwh={12} status={status ?? null} confidence={confidence ?? null} />));
          assert.ok(!raw.test(t), `${type}/${status}/${confidence}: ${t}`);
        }
      }
    }
  });

  it("the badge word is ink, with the status colour on the icon only", () => {
    const html = render(full);
    assert.ok(!allClasses(html).some((c) => /(?:^|:)(?:text|bg|border)-status-/.test(c)));
    assert.ok(!/\sstyle=/.test(html));
  });
});

// ---- ErrorRetry and OfflineBanner: server markup only (interaction needs a browser) ----

describe("ErrorRetry (server markup only: clicking Retry needs a browser)", () => {
  const noop = () => {};

  it("is an alert with an aria-hidden icon, a title and message in ink, and a Try again button", () => {
    const html = render(<ErrorRetry onRetry={noop} />);
    assert.equal(startTags(html)[0].attrs.role, "alert");
    assert.equal(only(html, "svg").attrs["aria-hidden"], "true");
    assert.equal(text(html), "Could not load this Please try again. Try again");
    const button = only(html, "button");
    assert.equal(button.attrs.type, "button", "must not submit a surrounding form");
    assert.ok(!("disabled" in button.attrs));
    assert.equal(button.attrs["aria-busy"], "false");
    // Status red is on the icon only; no text carries it.
    for (const p of tagsNamed(html, "p")) assert.ok(!classes(p).some((c) => /status/.test(c)));
    assert.ok(classes(tagsNamed(html, "p")[0]).includes("text-ink"));
  });

  it("title and message can be replaced; an empty message renders no paragraph", () => {
    const html = render(<ErrorRetry onRetry={noop} title="Could not load stations" message="Check your connection." />);
    assert.ok(text(html).startsWith("Could not load stations Check your connection."));
    assert.equal(tagsNamed(render(<ErrorRetry onRetry={noop} message="" />), "p").length, 1);
  });

  it("while retrying the button is disabled, busy and says so", () => {
    const html = render(<ErrorRetry onRetry={noop} retrying />);
    const button = only(html, "button");
    assert.ok("disabled" in button.attrs);
    assert.equal(button.attrs["aria-busy"], "true");
    assert.ok(text(html).endsWith("Retrying..."));
  });

  it("is never shown as an empty state: no empty-state wording and no server error text", () => {
    assert.ok(!/no results|nothing|empty|not found|\b[45]\d\d\b|stack|exception/i.test(text(render(<ErrorRetry onRetry={noop} />))));
  });
});

describe("OfflineBanner (server markup only: online/offline events and Retry clicks need a browser)", () => {
  const noop = () => {};
  const LAST = "2020-01-01T00:00:00Z"; // old enough that the year is always shown, so the text is stable

  it("renders an always-present polite status region that is empty while online", () => {
    for (const html of [render(<OfflineBanner lastUpdated={LAST} onRetry={noop} offline={false} />), render(<OfflineBanner lastUpdated={LAST} onRetry={noop} />)]) {
      const root = startTags(html)[0];
      assert.equal(root.attrs.role, "status");
      assert.equal(text(html), "");
      assert.equal(tagsNamed(html, "button").length, 0);
    }
  });

  it("the server render assumes online (so hydration matches) even when the browser state is unknown", () => {
    assert.equal(render(<OfflineBanner lastUpdated={LAST} onRetry={noop} />), render(<OfflineBanner lastUpdated={LAST} onRetry={noop} offline={false} />));
  });

  it("offline: 'You are offline.', the last-updated time in IST, and a Retry button", () => {
    const html = render(<OfflineBanner lastUpdated={LAST} onRetry={noop} offline />);
    assert.equal(startTags(html)[0].attrs.role, "status");
    assert.equal(text(html), "You are offline. Showing data from 1 Jan 2020, 5:30 am IST. Retry");
    assert.equal(only(html, "svg").attrs["aria-hidden"], "true");
    const button = only(html, "button");
    assert.equal(button.attrs.type, "button");
    assert.ok(classes(only(html, "div", (t) => classes(t).includes("text-ink"))).includes("text-ink"), "text is ink");
  });

  it("accepts Date and epoch ms for lastUpdated", () => {
    const want = "Showing data from 1 Jan 2020, 5:30 am IST.";
    for (const v of [new Date(LAST), Date.parse(LAST)]) assert.ok(text(render(<OfflineBanner lastUpdated={v} onRetry={noop} offline />)).includes(want));
  });

  for (const [name, v] of [["null", null], ["undefined", undefined], ["empty", ""], ["unparseable", "not a date"], ["NaN", Number.NaN]] as [string, unknown][]) {
    it(`lastUpdated ${name}: "Update time unknown", no invented time, never presented as current`, () => {
      const t = text(render(<OfflineBanner lastUpdated={v as never} onRetry={noop} offline />));
      assert.equal(t, "You are offline. Update time unknown. Retry");
      assert.ok(!/Showing data|just now|ago|Updated|\d/.test(t));
    });
  }

  it("className reaches the status region", () => {
    assert.ok(classes(startTags(render(<OfflineBanner lastUpdated={LAST} onRetry={noop} offline className="mb-4" />))[0]).includes("mb-4"));
  });
});

// ---- 6. Source checks across src/components/data ----

describe("src/components/data source rules", () => {
  it("finds the eleven files (guards against the checks silently scanning nothing)", () => {
    const expected = [
      "AvailabilityBadge.tsx",
      "AvailabilityDisclaimer.tsx",
      "ConnectorRow.tsx",
      "EmptyState.tsx",
      "ErrorRetry.tsx",
      "FreshnessText.tsx",
      "OfflineBanner.tsx",
      "StatusIcon.tsx",
      "StatusLegend.tsx",
      "connector.ts",
      "time.ts",
    ];
    for (const f of expected) assert.ok(source.has(f), `${f} is missing`);
    assert.ok(serverFiles.length >= 9);
  });

  it('only ErrorRetry.tsx and OfflineBanner.tsx contain "use client", and it is the first statement (anywhere else it is ignored)', () => {
    const clients = [...source].filter(([, code]) => isClient(code)).map(([f]) => f).sort();
    assert.deepEqual(clients, CLIENT_FILES);
    for (const f of CLIENT_FILES) assert.match(source.get(f) ?? "", /^\s*["']use client["']/, `${f}: directive must come before the imports`);
  });

  it("server-compatible files use no React hooks", () => {
    for (const [f, code] of serverFiles) {
      assert.ok(!/\buse[A-Z]\w*\s*\(/.test(code), `${f} calls a hook`);
      assert.ok(!/import[^;]*\buse[A-Z]\w*[^;]*from\s+["']react["']/.test(code), `${f} imports a hook`);
    }
  });

  it("server-compatible files import no lucide-react, no client file, and attach no event handlers", () => {
    for (const [f, code] of serverFiles) {
      assert.ok(!/lucide-react/.test(code), `${f} imports lucide-react (its Icon is client code, 548 bytes on /)`);
      assert.ok(!/from\s+["'](?:\.\/|@\/components\/data\/)(?:ErrorRetry|OfflineBanner)["']/.test(code), `${f} imports a client component`);
      assert.ok(!/\bon[A-Z]\w+=\{/.test(code), `${f} attaches an event handler, which needs "use client"`);
    }
  });

  // Naming the client components (Dialog, Toast) was an allow-list by omission: any other ../ui/* import passed, and
  // `/` has ~799 bytes of headroom against its 150,000-byte budget. So walk the real import graph instead.
  it('no module reachable from a server-compatible file by relative import contains "use client"', () => {
    const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];
    const resolveImport = (from: string, spec: string) => {
      const base = resolve(dirname(from), spec);
      const hit = EXTS.map((e) => base + e).find((p) => existsSync(p) && statSync(p).isFile());
      assert.ok(hit, `${from}: cannot resolve import "${spec}" (the check must not pass by failing to look)`);
      return hit;
    };
    const queue = serverFiles.map(([f]) => join(DATA_DIR, f));
    const seen = new Set<string>(queue);
    for (let i = 0; i < queue.length; i++) {
      const file = queue[i];
      const code = stripComments(readFileSync(file, "utf8"));
      for (const m of code.matchAll(/(?:from|import)\s*["'](\.[^"']+)["']/g)) {
        const target = resolveImport(file, m[1]);
        if (seen.has(target)) continue;
        seen.add(target);
        const targetCode = stripComments(readFileSync(target, "utf8"));
        assert.ok(!isClient(targetCode), `${file} reaches ${target} ("use client"), which would put client JS on /`);
        queue.push(target);
      }
    }
    // Anti-vacuity: the walk must really have left the data directory and resolved the known graph.
    assert.ok(seen.size >= serverFiles.length + 1, `resolved only ${seen.size} modules: the walk found nothing to check`);
    assert.ok([...seen].some((p) => p.replace(/\\/g, "/").endsWith("src/lib/status.ts")), "the walk never reached src/lib/status.ts");
  });

  it("the two client files import no icon library either (inline SVG keeps the bundle small)", () => {
    for (const f of CLIENT_FILES) assert.ok(!/lucide-react/.test(source.get(f) ?? ""), `${f} imports lucide-react`);
  });

  it("has no index barrel (a barrel would pull the client files into every importer)", () => {
    assert.deepEqual(allFiles.filter((f) => /^index\./.test(f)), []);
    for (const ext of ["ts", "tsx", "js", "jsx", "mjs"]) assert.ok(!existsSync(join(DATA_DIR, `index.${ext}`)));
    for (const [f, code] of source) assert.ok(!/export\s+\*\s+from/.test(code), `${f} re-exports everything from another module`);
  });

  it("imports nothing from src/services, the database, auth, firebase, stores or maps (it must stay a pure UI layer)", () => {
    const banned = /from\s+["'][^"']*(?:\/services\/|\/services["']|\/lib\/db|\/lib\/auth|\/store\/|@prisma|next-auth|firebase|zustand|@tanstack|vaul|@vis\.gl|@googlemaps)/;
    for (const [f, code] of source) assert.ok(!banned.test(code), `${f} imports a server, state or map module`);
    for (const [f, code] of source) assert.ok(!/require\(/.test(code), `${f} uses require()`);
  });

  it("uses no raw colours (hex, rgb, hsl, oklch): colour comes from the tokens", () => {
    for (const [f, code] of source) {
      assert.ok(!/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/.test(code), `${f} has a hex colour`);
      assert.ok(!/\b(?:rgba?|hsla?|oklch|oklab)\(/.test(code), `${f} has a functional colour`);
    }
  });

  it("uses no legacy classes (glass, glow), no raw Tailwind palette colours and no inline style", () => {
    const palette = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
    for (const [f, code] of source) {
      assert.ok(!/(?:^|[\s"'`:])(?:glass|glow)(?:-[\w-]+)?(?![\w-])/.test(code), `${f} uses a legacy glass/glow class`);
      assert.ok(!new RegExp(`\\b(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline|shadow|accent|placeholder)-(?:${palette})-\\d`).test(code), `${f} uses a palette colour`);
      assert.ok(!/\b(?:bg|text|border|ring|fill|stroke)-(?:white|black)\b/.test(code), `${f} uses white/black instead of a token`);
      assert.ok(!/\bstyle=\{/.test(code), `${f} sets an inline style (status colour comes from SVG attributes, safe under any CSP)`);
    }
  });

  it("builds no Tailwind class from a template (bg-status-${x} is never generated)", () => {
    const utility = "bg|text|border|ring|fill|stroke|accent|outline|shadow|rounded|size|gap|min-h|min-w|max-h|max-w|[whpm][xytblrse]?";
    for (const [f, code] of source) {
      assert.ok(!/status-\$\{/.test(code), `${f} builds a status class from a template`);
      assert.ok(!new RegExp(`\\b(?:${utility})-(?:[\\w.]+-)*\\$\\{`).test(code), `${f} builds a utility class from a template`);
      assert.ok(!/["'`]\s*(?:bg|text|border)-status-["'`]\s*\+/.test(code), `${f} concatenates a status class`);
      assert.ok(!/["'`]\s*(?:bg|text|border)-["'`]\s*\+/.test(code), `${f} concatenates a colour class`);
    }
  });

  it("status colours and words are read from status.ts, never typed again", () => {
    for (const [f, code] of source) {
      assert.ok(!/--color-status-/.test(code), `${f} names a status token directly; read STATUS[state].color`);
      for (const word of [STATUS.AVAILABLE.label, STATUS.LIMITED.label, STATUS.UNAVAILABLE.label, STATUS.UNKNOWN.label]) {
        assert.ok(!new RegExp(`["'\`]${word}["'\`]`).test(code), `${f} hard-codes the status word "${word}"; read STATUS`);
      }
    }
  });

  it("every token-based utility resolves to a variable in globals.css (Tailwind silently drops unknown classes)", () => {
    const theme = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const sides = ["t", "b", "l", "r", "x", "y", "s", "e"]; // border-b etc. are widths, not colours
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
      : (family === "border" && sides.includes(name)) || builtin.color.includes(name) || theme.has(`--color-${name}`);

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
