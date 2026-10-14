// Regression tests for the legacy GET /api/stations `where` builder (T0-03, spec API-4).
// Run: npx tsx --test tests/backend/legacyStationsWhere.test.ts
//
// The bug: the route spread two objects that both used the key `connectors`, so with both
// the `connectors` (connector type) and `speeds` (AC/DC) params set, the second replaced
// the first and the connector-type filter was silently dropped.
// Intended semantics: a station matches if SOME connector has a requested type AND SOME
// connector (not necessarily the same one) has a requested current type.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLegacyStationsWhere, type LegacyStationsFilters } from "@/services/stations/legacyStationsWhere";

// Four distinct, non-round values: a swapped north/south or east/west, or any rounding
// (the route rounds only for its cache key), changes the result.
const N = 19.30417;
const S = 18.80233;
const E = 73.20781;
const W = 72.70146;

// What every result must contain for that viewport, written out independently of the
// implementation: latitude runs south..north, longitude runs west..east.
const BBOX = { latitude: { gte: S, lte: N }, longitude: { gte: W, lte: E } };

const NO_FILTERS: LegacyStationsFilters = {
  north: N,
  south: S,
  east: E,
  west: W,
  providers: [],
  connectors: [],
  speeds: [],
  status: null,
};
const build = (filters: Partial<LegacyStationsFilters> = {}) => buildLegacyStationsWhere({ ...NO_FILTERS, ...filters });

describe("buildLegacyStationsWhere", () => {
  describe("regression: connector type and AC/DC set together", () => {
    it("keeps both as separate AND clauses and has no top-level `connectors` key", () => {
      const where = build({ connectors: ["CCS2", "TYPE2"], speeds: ["DC"] });

      assert.deepEqual(
        where.AND,
        [
          { connectors: { some: { type: { in: ["CCS2", "TYPE2"] } } } },
          { connectors: { some: { currentType: { in: ["DC"] } } } },
        ],
        "each filter needs its own clause; one `some` holding both would force a single connector to satisfy both",
      );
      // The original bug: a second top-level `connectors` key replaced the first.
      assert.equal("connectors" in where, false);
    });

    it("holds for multi-valued lists on both sides, with the bbox alongside", () => {
      assert.deepEqual(build({ connectors: ["CHADEMO", "CCS2", "BHARAT_DC"], speeds: ["AC", "DC"] }), {
        ...BBOX,
        AND: [
          { connectors: { some: { type: { in: ["CHADEMO", "CCS2", "BHARAT_DC"] } } } },
          { connectors: { some: { currentType: { in: ["AC", "DC"] } } } },
        ],
      });
    });
  });

  describe("one connector filter set", () => {
    it("connector types only: AND holds exactly that one clause", () => {
      assert.deepEqual(build({ connectors: ["CHADEMO"] }), {
        ...BBOX,
        AND: [{ connectors: { some: { type: { in: ["CHADEMO"] } } } }],
      });
    });

    it("speeds only: AND holds exactly that one clause", () => {
      assert.deepEqual(build({ speeds: ["AC", "DC"] }), {
        ...BBOX,
        AND: [{ connectors: { some: { currentType: { in: ["AC", "DC"] } } } }],
      });
    });
  });

  describe("neither connector filter set", () => {
    it("returns just the exact, unrounded bbox and no AND key", () => {
      const where = build();

      assert.deepEqual(where, {
        latitude: { gte: 18.80233, lte: 19.30417 },
        longitude: { gte: 72.70146, lte: 73.20781 },
      });
      assert.equal("AND" in where, false);
    });
  });

  describe("other filters pass through unchanged", () => {
    it("providers become `source in`, in the order given", () => {
      assert.deepEqual(build({ providers: ["tata", "ocm"] }), { ...BBOX, source: { in: ["tata", "ocm"] } });
    });

    it("every station status becomes a plain `status` equality", () => {
      for (const status of ["AVAILABLE", "OCCUPIED", "OFFLINE", "UNKNOWN"]) {
        assert.deepEqual(build({ status }), { ...BBOX, status });
      }
    });

    it("providers, status and both connector filters at once: nothing dropped, nothing moved into AND", () => {
      assert.deepEqual(
        build({
          providers: ["ocm", "tata"],
          status: "OCCUPIED",
          connectors: ["CCS2", "TYPE2"],
          speeds: ["DC"],
        }),
        {
          ...BBOX,
          source: { in: ["ocm", "tata"] },
          status: "OCCUPIED",
          AND: [
            { connectors: { some: { type: { in: ["CCS2", "TYPE2"] } } } },
            { connectors: { some: { currentType: { in: ["DC"] } } } },
          ],
        },
      );
    });
  });

  describe("empty and absent filters add no clause", () => {
    it("empty arrays and a null status leave only the bbox", () => {
      assert.deepEqual(build({ providers: [], connectors: [], speeds: [], status: null }), BBOX);
    });

    it("an empty-string status counts as absent (the route also maps '' to null)", () => {
      assert.deepEqual(build({ status: "" }), BBOX);
    });
  });

  describe("unrecognised enum strings", () => {
    // Pins CURRENT behaviour, not the desired behaviour. The helper casts to the Prisma enums
    // without validating, so unknown values go straight into the query, where Prisma rejects
    // them (PrismaClientValidationError) and the route's catch-all turns that into a 500.
    // That is a known gap, scheduled for the v1 API (spec API-4: invalid values return 400),
    // not for T0-03. When validation lands, change this test to assert the rejection.
    it("are passed through untouched: nothing is validated, dropped or normalised", () => {
      assert.deepEqual(build({ connectors: ["CCS2", "NOT_A_CONNECTOR"], speeds: ["TURBO"], status: "BROKEN" }), {
        ...BBOX,
        status: "BROKEN",
        AND: [
          { connectors: { some: { type: { in: ["CCS2", "NOT_A_CONNECTOR"] } } } },
          { connectors: { some: { currentType: { in: ["TURBO"] } } } },
        ],
      });
    });
  });
});
