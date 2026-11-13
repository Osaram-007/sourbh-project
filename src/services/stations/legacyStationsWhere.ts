import type { ConnectorType, CurrentType, Prisma, StationStatus } from "@prisma/client";

export interface LegacyStationsFilters {
  north: number;
  south: number;
  east: number;
  west: number;
  providers: string[];
  connectors: string[];
  speeds: string[];
  status: string | null;
}

/**
 * Prisma `where` for the legacy GET /api/stations viewport query.
 *
 * The connector-type and AC/DC filters both constrain `connectors`. An object
 * literal holds that key only once, so spreading both let the second silently
 * replace the first; each filter therefore gets its own clause in `AND`. The
 * clauses are independent: a station matches if some connector has a requested
 * type and some connector (not necessarily the same one) has a requested
 * current type.
 */
export function buildLegacyStationsWhere({
  north,
  south,
  east,
  west,
  providers,
  connectors,
  speeds,
  status,
}: LegacyStationsFilters): Prisma.StationWhereInput {
  const and: Prisma.StationWhereInput[] = [];
  if (connectors.length > 0) and.push({ connectors: { some: { type: { in: connectors as ConnectorType[] } } } });
  if (speeds.length > 0) and.push({ connectors: { some: { currentType: { in: speeds as CurrentType[] } } } });

  return {
    latitude: { gte: south, lte: north },
    longitude: { gte: west, lte: east },
    ...(providers.length > 0 ? { source: { in: providers } } : {}),
    ...(status ? { status: status as StationStatus } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };
}
