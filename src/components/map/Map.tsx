"use client";

import { useEffect, useRef, useState } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { useStore } from "@/store/useStore";
import { useQuery } from "@tanstack/react-query";
import { createCustomHTMLOverlay, CustomHTMLOverlayInstance } from "./CustomHTMLOverlay";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { CustomClusterRenderer } from "./CustomClusterRenderer";

// Helper to determine marker color coding by station status
const getStatusColorClass = (status: string) => {
  switch (status) {
    case "AVAILABLE":
      return "border-emerald-500/40 bg-slate-950/85 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:scale-108 hover:border-emerald-450 hover:text-white hover:shadow-[0_0_20px_rgba(16,185,129,0.55)]";
    case "OCCUPIED":
      return "border-amber-500/40 bg-slate-950/85 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.25)] hover:scale-108 hover:border-amber-450 hover:text-white";
    case "OFFLINE":
      return "border-rose-500/35 bg-slate-950/85 text-rose-405 shadow-[0_0_15px_rgba(244,63,94,0.2)] hover:scale-108 hover:border-rose-450 hover:text-white";
    default:
      return "border-slate-800 bg-slate-950/85 text-slate-400 hover:scale-108 hover:border-slate-700";
  }
};

// Helper for CPO abbreviations
const getCpoShortName = (source: string, operator: string | null) => {
  const op = (operator || source || "").toLowerCase();
  if (op.includes("tata")) return "Tata";
  if (op.includes("ather")) return "Ather";
  if (op.includes("statiq")) return "Statiq";
  if (op.includes("chargezone") || op.includes("charge zone")) return "Zone";
  if (op.includes("bpcl")) return "BPCL";
  return source.toUpperCase();
};

let optionsSet = false;

export default function MapContainer() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const overlaysRef = useRef<CustomHTMLOverlayInstance[]>([]);
  const clustererRef = useRef<MarkerClusterer | null>(null);

  // Zustand Store
  const mapCenter = useStore((state) => state.mapCenter);
  const mapZoom = useStore((state) => state.mapZoom);
  const setMapCenter = useStore((state) => state.setMapCenter);
  const setMapZoom = useStore((state) => state.setMapZoom);
  const setSelectedStationId = useStore((state) => state.setSelectedStationId);
  const setBounds = useStore((state) => state.setBounds);
  const bounds = useStore((state) => state.bounds);
  const filters = useStore((state) => state.filters);

  // Initialize Map
  useEffect(() => {
    if (!mapRef.current || map) return;

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
    
    // Set options globally
    if (!optionsSet) {
      setOptions({
        key: apiKey,
        v: "weekly",
      });
      optionsSet = true;
    }

    const initMap = async () => {
      try {
        const { Map } = await importLibrary("maps");
        setIsLoaded(true);

        const initializedMap = new Map(mapRef.current!, {
          center: mapCenter,
          zoom: mapZoom,
          disableDefaultUI: true,
          zoomControl: false,
          gestureHandling: "greedy",
          styles: [
            { elementType: "geometry", stylers: [{ color: "#0b0f19" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#070a13" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#4f5e74" }] },
            {
              featureType: "administrative",
              elementType: "geometry",
              stylers: [{ color: "#182030" }],
            },
            {
              featureType: "administrative.country",
              elementType: "labels.text.fill",
              stylers: [{ color: "#cbd5e1" }],
            },
            {
              featureType: "poi",
              elementType: "geometry",
              stylers: [{ color: "#0e1320" }],
            },
            {
              featureType: "poi",
              elementType: "labels.text.fill",
              stylers: [{ color: "#384557" }],
            },
            {
              featureType: "road",
              elementType: "geometry",
              stylers: [{ color: "#172033" }],
            },
            {
              featureType: "road",
              elementType: "labels.text.fill",
              stylers: [{ color: "#384557" }],
            },
            {
              featureType: "road.highway",
              elementType: "geometry",
              stylers: [{ color: "#25334f" }],
            },
            {
              featureType: "road.highway",
              elementType: "labels.text.fill",
              stylers: [{ color: "#64748b" }],
            },
            {
              featureType: "water",
              elementType: "geometry",
              stylers: [{ color: "#030712" }],
            },
            {
              featureType: "water",
              elementType: "labels.text.fill",
              stylers: [{ color: "#1e293b" }],
            },
          ],
        });

        // Initialize MarkerClusterer with custom renderer and click zoom
        clustererRef.current = new MarkerClusterer({
          map: initializedMap,
          renderer: new CustomClusterRenderer(),
          onClusterClick: (_event, cluster, mapInstance) => {
            if (cluster.bounds) {
              mapInstance.fitBounds(cluster.bounds);
            }
          },
        });

        setMap(initializedMap);

        // Listeners for bounds/zoom/center changes
        initializedMap.addListener("idle", () => {
          const center = initializedMap.getCenter();
          const zoom = initializedMap.getZoom();
          const mapBounds = initializedMap.getBounds();

          if (center) setMapCenter({ lat: center.lat(), lng: center.lng() });
          if (zoom) setMapZoom(zoom);
          if (mapBounds) {
            const ne = mapBounds.getNorthEast();
            const sw = mapBounds.getSouthWest();
            setBounds({
              north: ne.lat(),
              south: sw.lat(),
              east: ne.lng(),
              west: sw.lng(),
            });
          }
        });
      } catch (err) {
        console.error("Failed to initialize Google Maps:", err);
      }
    };

    initMap();
  }, [map]);

  // Sync zoom and center from store if updated outside (e.g. user geolocated)
  useEffect(() => {
    if (!map) return;
    const currentCenter = map.getCenter();
    if (!currentCenter || 
      Math.abs(currentCenter.lat() - mapCenter.lat) > 0.0001 || 
      Math.abs(currentCenter.lng() - mapCenter.lng) > 0.0001) {
      map.panTo(mapCenter);
    }
  }, [mapCenter, map]);

  // Query stations from API inside viewport
  const { data: stations = [] } = useQuery({
    queryKey: ["stations", bounds, filters],
    queryFn: async () => {
      if (!bounds) return [];
      
      const queryParams = new URLSearchParams({
        north: String(bounds.north),
        south: String(bounds.south),
        east: String(bounds.east),
        west: String(bounds.west),
        providers: filters.providers.join(","),
        connectors: filters.connectorTypes.join(","),
        speeds: filters.speeds.join(","),
      });
      if (filters.status) queryParams.append("status", filters.status);

      const res = await fetch(`/api/stations?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch stations");
      return res.json();
    },
    enabled: !!bounds,
    refetchInterval: 15000,
  });

  // Render Clustered Markers & Custom Overlays
  useEffect(() => {
    if (!map || !isLoaded) return;

    // Clear old overlays
    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];

    if (clustererRef.current) {
      clustererRef.current.clearMarkers(true);
    }

    const clusterMarkers: google.maps.Marker[] = [];
    const newOverlays: CustomHTMLOverlayInstance[] = [];

    const currentZoom = map.getZoom() || 12;

    for (const station of stations) {
      const position = new google.maps.LatLng(station.latitude, station.longitude);

      // Create marker for clusterer
      const marker = new google.maps.Marker({
        position,
        title: station.name,
      });
      marker.addListener("click", () => {
        setSelectedStationId(station.id);
      });
      clusterMarkers.push(marker);

      // Create custom detailed HTML overlay badge when zoomed in (zoom >= 11)
      if (currentZoom >= 11) {
        const div = document.createElement("div");
        div.className = `flex items-center gap-1.5 px-3 py-1.5 rounded-2xl border backdrop-blur-md transition-all duration-200 select-none cursor-pointer shadow-lg ${getStatusColorClass(
          station.status
        )}`;

        const cpoShort = getCpoShortName(station.source, station.operator);
        const maxPower = station.connectors?.length > 0
          ? Math.max(...station.connectors.map((c: any) => c.powerKw || 0))
          : 0;

        const powerHtml = maxPower > 0
          ? `<span class="px-1.5 py-0.5 text-[8.5px] font-black bg-white/10 rounded-md border border-white/5 ml-1 leading-none uppercase">${maxPower}kW</span>`
          : "";

        const pulseHtml = station.status === "AVAILABLE"
          ? `<span class="relative flex h-2 w-2">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
             </span>`
          : `<span class="h-1.5 w-1.5 rounded-full ${
              station.status === "OCCUPIED" ? "bg-amber-500" : (station.status === "OFFLINE" ? "bg-rose-500" : "bg-slate-450")
            }"></span>`;

        div.innerHTML = `
          ${pulseHtml}
          <span class="text-[10px] font-extrabold tracking-wide uppercase leading-none">${cpoShort}</span>
          ${powerHtml}
        `;

        const overlay = createCustomHTMLOverlay(position, div, () => {
          setSelectedStationId(station.id);
        });

        overlay.setMap(map);
        newOverlays.push(overlay);
      }
    }

    overlaysRef.current = newOverlays;

    if (clustererRef.current) {
      clustererRef.current.addMarkers(clusterMarkers);
    }
  }, [stations, map, isLoaded, setSelectedStationId]);

  return (
    <div className="relative w-full h-full bg-slate-900">
      <div ref={mapRef} className="w-full h-full" />
      
      {!isLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-md z-50">
          <div className="relative flex h-12 w-12 items-center justify-center">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-6 w-6 bg-emerald-500"></span>
          </div>
          <p className="mt-4 text-slate-300 font-medium tracking-wide">Initializing Full Charge Map...</p>
        </div>
      )}
    </div>
  );
}
