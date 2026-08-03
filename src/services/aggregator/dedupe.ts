import { ScrapedStation, ScrapedConnector } from "./types";
import { getDistance } from "geolib";
import { ConnectorType, CurrentType, StationStatus, ConnectorStatus } from "@prisma/client";
import { db } from "@/lib/db";

// Source hierarchy priority: lower index = higher priority
const SOURCE_PRIORITY = ["tata", "ather", "bpcl", "chargezone", "statiq", "ocm", "evyatra", "osm"];

export class DeduplicationEngine {
  /**
   * Deduplicates a list of scraped stations using a grid-based spatial search.
   * Stations within 50 meters of each other are merged.
   */
  static deduplicate(stations: ScrapedStation[]): ScrapedStation[] {
    console.log(`Deduplicating ${stations.length} stations...`);
    
    // Grid size: ~0.0005 degrees latitude/longitude is roughly 50 meters
    // We group by grid cells to avoid O(N^2) comparison.
    // cell size: ~500 meters (0.005 degrees) to find 50m neighbors safely.
    const GRID_SIZE = 0.005;
    const grid: Map<string, ScrapedStation[]> = new Map();

    const getGridKey = (lat: number, lng: number) => {
      const latGrid = Math.floor(lat / GRID_SIZE);
      const lngGrid = Math.floor(lng / GRID_SIZE);
      return `${latGrid},${lngGrid}`;
    };

    const mergedStations: ScrapedStation[] = [];

    for (const station of stations) {
      const key = getGridKey(station.latitude, station.longitude);
      
      // Get neighboring cells (9 cells total)
      const latGrid = Math.floor(station.latitude / GRID_SIZE);
      const lngGrid = Math.floor(station.longitude / GRID_SIZE);
      
      let matchedStation: ScrapedStation | null = null;
      let minDistance = 50; // Max 50 meters threshold

      for (let dl = -1; dl <= 1; dl++) {
        for (let dg = -1; dg <= 1; dg++) {
          const neighborKey = `${latGrid + dl},${lngGrid + dg}`;
          const neighborStations = grid.get(neighborKey) || [];
          
          for (const candidate of neighborStations) {
            const dist = getDistance(
              { latitude: station.latitude, longitude: station.longitude },
              { latitude: candidate.latitude, longitude: candidate.longitude }
            );

            if (dist < minDistance) {
              minDistance = dist;
              matchedStation = candidate;
            }
          }
        }
      }

      if (matchedStation) {
        // Merge station into matchedStation
        this.mergeStations(matchedStation, station);
      } else {
        // Create new entry
        const cellStations = grid.get(key) || [];
        cellStations.push(station);
        grid.set(key, cellStations);
        mergedStations.push(station);
      }
    }

    console.log(`Deduplication completed. Reduced to ${mergedStations.length} stations.`);
    return mergedStations;
  }

  /**
   * Merges duplicateStation into primaryStation in-place based on source priority.
   */
  private static mergeStations(primary: ScrapedStation, duplicate: ScrapedStation) {
    const primaryPriority = SOURCE_PRIORITY.indexOf(primary.source);
    const duplicatePriority = SOURCE_PRIORITY.indexOf(duplicate.source);

    // If duplicate has higher priority (lower index), swap their roles
    if (duplicatePriority !== -1 && (primaryPriority === -1 || duplicatePriority < primaryPriority)) {
      // Swap content
      const tempSource = primary.source;
      const tempExternalId = primary.externalId;
      const tempName = primary.name;
      const tempOperator = primary.operator;
      const tempAddress = primary.address;
      const tempStatus = primary.status;
      const tempPricing = primary.pricingInfo;
      const tempHours = primary.operatingHours;
      const tempImage = primary.imageUrl;

      primary.source = duplicate.source;
      primary.externalId = duplicate.externalId;
      primary.name = duplicate.name;
      primary.operator = duplicate.operator;
      primary.address = duplicate.address;
      primary.status = duplicate.status;
      primary.pricingInfo = duplicate.pricingInfo;
      primary.operatingHours = duplicate.operatingHours;
      primary.imageUrl = duplicate.imageUrl;

      // Retain the connectors from the higher-priority source
      primary.connectors = duplicate.connectors;

      // Put primary values into duplicate variables to merge in
      duplicate.source = tempSource;
      duplicate.externalId = tempExternalId;
      duplicate.name = tempName;
      duplicate.operator = tempOperator;
      duplicate.address = tempAddress;
      duplicate.status = tempStatus;
      duplicate.pricingInfo = tempPricing;
      duplicate.operatingHours = tempHours;
      duplicate.imageUrl = tempImage;
    }

    // Merge amenities
    const amenitiesSet = new Set([...primary.amenities, ...duplicate.amenities]);
    primary.amenities = Array.from(amenitiesSet);

    // Merge connectors if primary is OCM/OSM/EVYatra and we can combine their list.
    // If primary is a direct CPO source (tata, ather, bpcl, chargezone, statiq), we prefer keeping direct CPO connectors for accuracy.
    const isPrimaryCpo = ["tata", "ather", "bpcl", "chargezone", "statiq"].includes(primary.source);
    const isDuplicateCpo = ["tata", "ather", "bpcl", "chargezone", "statiq"].includes(duplicate.source);

    if (!isPrimaryCpo && !isDuplicateCpo) {
      // Merge connectors based on matching connector types and preserve higher powerKw
      for (const dConn of duplicate.connectors) {
        const matchingConn = primary.connectors.find(pConn => pConn.type === dConn.type);
        if (matchingConn) {
          if ((dConn.powerKw || 0) > (matchingConn.powerKw || 0)) {
            matchingConn.powerKw = dConn.powerKw;
          }
        } else {
          primary.connectors.push(dConn);
        }
      }
    }
  }

  /**
   * Persists deduplicated stations to the database in batched transactions.
   */
  static async saveToDatabase(stations: ScrapedStation[]): Promise<void> {
    console.log(`Saving ${stations.length} stations to the database in batches...`);
    const BATCH_SIZE = 100;
    
    for (let i = 0; i < stations.length; i += BATCH_SIZE) {
      const batch = stations.slice(i, i + BATCH_SIZE);
      try {
        await db.$transaction(async (tx) => {
          for (const station of batch) {
            const dbStation = await tx.station.upsert({
              where: {
                source_externalId: {
                  source: station.source,
                  externalId: station.externalId
                }
              },
              create: {
                externalId: station.externalId,
                source: station.source,
                name: station.name,
                operator: station.operator,
                address: station.address,
                city: station.city,
                state: station.state,
                pincode: station.pincode,
                latitude: station.latitude,
                longitude: station.longitude,
                status: station.status,
                operatingHours: station.operatingHours,
                imageUrl: station.imageUrl,
                pricingInfo: station.pricingInfo,
                amenities: station.amenities,
                lastSynced: new Date(),
                lastUpdated: new Date()
              },
              update: {
                name: station.name,
                operator: station.operator,
                address: station.address,
                city: station.city,
                state: station.state,
                pincode: station.pincode,
                latitude: station.latitude,
                longitude: station.longitude,
                status: station.status,
                operatingHours: station.operatingHours,
                imageUrl: station.imageUrl,
                pricingInfo: station.pricingInfo,
                amenities: station.amenities,
                lastSynced: new Date()
              }
            });

            await tx.connector.deleteMany({
              where: { stationId: dbStation.id }
            });

            if (station.connectors.length > 0) {
              await tx.connector.createMany({
                data: station.connectors.map(c => ({
                  stationId: dbStation.id,
                  externalId: c.externalId,
                  type: c.type,
                  powerKw: c.powerKw,
                  currentType: c.currentType,
                  status: c.status,
                  pricing: c.pricing
                }))
              });
            }
          }
        });
      } catch (err) {
        console.error(`Failed to save batch ${i} to ${i + BATCH_SIZE} to database:`, err);
      }
    }

    console.log("Database save complete!");
  }
}
