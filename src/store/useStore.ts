import { create } from "zustand";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface FilterState {
  providers: string[]; // e.g., ["tata", "ather", "statiq"]
  connectorTypes: string[]; // e.g., ["CCS2", "TYPE2", "CHADEMO"]
  speeds: string[]; // e.g., ["AC", "DC"]
  status: string | null; // e.g., "AVAILABLE" | null
}

interface AppStore {
  userLocation: LatLng | null;
  mapCenter: LatLng;
  mapZoom: number;
  selectedStationId: string | null;
  bounds: MapBounds | null;
  filters: FilterState;
  
  // Setters
  setUserLocation: (loc: LatLng) => void;
  setMapCenter: (center: LatLng) => void;
  setMapZoom: (zoom: number) => void;
  setSelectedStationId: (id: string | null) => void;
  setBounds: (bounds: MapBounds | null) => void;
  
  // Filter actions
  toggleProvider: (provider: string) => void;
  toggleConnectorType: (type: string) => void;
  toggleSpeed: (speed: string) => void;
  setStatusFilter: (status: string | null) => void;
  resetFilters: () => void;
}

const DEFAULT_CENTER = { lat: 19.0760, lng: 72.8777 }; // Mumbai default center

export const useStore = create<AppStore>((set) => ({
  userLocation: null,
  mapCenter: DEFAULT_CENTER,
  mapZoom: 12,
  selectedStationId: null,
  bounds: null,
  filters: {
    providers: [],
    connectorTypes: [],
    speeds: [],
    status: null,
  },

  setUserLocation: (loc) => set({ userLocation: loc, mapCenter: loc }),
  setMapCenter: (center) => set({ mapCenter: center }),
  setMapZoom: (zoom) => set({ mapZoom: zoom }),
  setSelectedStationId: (id) => set({ selectedStationId: id }),
  setBounds: (bounds) => set({ bounds }),

  toggleProvider: (provider) =>
    set((state) => {
      const providers = state.filters.providers.includes(provider)
        ? state.filters.providers.filter((p) => p !== provider)
        : [...state.filters.providers, provider];
      return { filters: { ...state.filters, providers } };
    }),

  toggleConnectorType: (type) =>
    set((state) => {
      const connectorTypes = state.filters.connectorTypes.includes(type)
        ? state.filters.connectorTypes.filter((t) => t !== type)
        : [...state.filters.connectorTypes, type];
      return { filters: { ...state.filters, connectorTypes } };
    }),

  toggleSpeed: (speed) =>
    set((state) => {
      const speeds = state.filters.speeds.includes(speed)
        ? state.filters.speeds.filter((s) => s !== speed)
        : [...state.filters.speeds, speed];
      return { filters: { ...state.filters, speeds } };
    }),

  setStatusFilter: (status) =>
    set((state) => ({ filters: { ...state.filters, status } })),

  resetFilters: () =>
    set({
      filters: {
        providers: [],
        connectorTypes: [],
        speeds: [],
        status: null,
      },
    }),
}));
