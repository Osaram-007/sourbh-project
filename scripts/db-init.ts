import { Client } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("Error: DATABASE_URL environment variable is not defined.");
  process.exit(1);
}

async function main() {
  console.log("Initializing database extensions and spatial settings...");
  
  const client = new Client({
    connectionString: databaseUrl,
  });

  try {
    await client.connect();
    console.log("Connected to database successfully.");

    // 1. Try to enable PostGIS extension
    try {
      console.log("Enabling PostGIS extension...");
      await client.query(`CREATE EXTENSION IF NOT EXISTS postgis;`);
      
      // 2. Add location geography column if PostGIS enabled successfully
      console.log("Adding location geography column to Station table...");
      await client.query(`
        ALTER TABLE "Station" 
        ADD COLUMN IF NOT EXISTS "location" geography(Point, 4326);
      `);

      // 3. Create or replace spatial trigger function
      console.log("Creating spatial trigger function...");
      await client.query(`
        CREATE OR REPLACE FUNCTION update_station_location()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      // 4. Create trigger
      console.log("Creating trigger for auto-updating geography location...");
      const triggerCheck = await client.query(`
        SELECT trigger_name 
        FROM information_schema.triggers 
        WHERE event_object_table = 'Station' 
        AND trigger_name = 'trigger_update_station_location';
      `);

      if (triggerCheck.rows.length === 0) {
        await client.query(`
          CREATE TRIGGER trigger_update_station_location
          BEFORE INSERT OR UPDATE OF latitude, longitude ON "Station"
          FOR EACH ROW
          EXECUTE FUNCTION update_station_location();
        `);
      }

      // 5. Create GiST index
      console.log("Creating GiST spatial index on Station(location)...");
      await client.query(`
        CREATE INDEX IF NOT EXISTS station_location_gist_idx 
        ON "Station" USING GIST (location);
      `);

      console.log("PostGIS spatial initialization completed successfully!");
    } catch (postgisError: any) {
      console.warn("\n[Warning] PostGIS extension is not installed or available on this PostgreSQL server.");
      console.warn("Details:", postgisError.message);
      console.warn("Skipping PostGIS spatial trigger configuration. Bounding-box float querying will be used instead.\n");
    }

    console.log("Database initialization completed successfully!");
  } catch (error) {
    console.error("Database connection/initialization failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
