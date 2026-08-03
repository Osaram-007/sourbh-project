"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X, MapPin, Zap } from "lucide-react";
import { useStore } from "@/store/useStore";

interface SearchResult {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  operator: string | null;
  source: string;
  status: string;
  latitude: number;
  longitude: number;
}

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const setMapCenter = useStore((state) => state.setMapCenter);
  const setMapZoom = useStore((state) => state.setMapZoom);
  const setSelectedStationId = useStore((state) => state.setSelectedStationId);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/stations/search?q=${encodeURIComponent(query.trim())}`
        );
        if (res.ok) {
          const data = await res.json();
          setResults(data);
          setIsOpen(data.length > 0);
        }
      } catch {
        // Silently fail
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSelect = (result: SearchResult) => {
    setMapCenter({ lat: result.latitude, lng: result.longitude });
    setMapZoom(16);
    setSelectedStationId(result.id);
    setQuery("");
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Search Input */}
      <div className="relative group">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400 group-focus-within:text-emerald-450 transition-colors" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="Search stations, cities, operators..."
          className="w-full pl-10 pr-10 py-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/70 focus:ring-4 focus:ring-emerald-500/10 transition-all font-medium"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setResults([]);
              setIsOpen(false);
            }}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {isSearching && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
            <div className="h-4.5 w-4.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && (
        <div className="absolute top-full mt-3 w-full glass-panel-elevated rounded-2xl shadow-2xl overflow-hidden z-[100] max-h-80 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
          {results.map((result) => {
            const isTata = result.source === "tata";
            const isAther = result.source === "ather";
            const isBpcl = result.source === "bpcl";
            const isStatiq = result.source === "statiq";
            const isCz = result.source === "chargezone";
            const badgeClass = isTata 
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
              : isAther 
              ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" 
              : isBpcl
              ? "bg-orange-500/10 text-orange-400 border border-orange-500/20"
              : isStatiq 
              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" 
              : isCz 
              ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" 
              : "bg-slate-800 text-slate-405 border border-slate-700";

            return (
              <button
                key={result.id}
                onClick={() => handleSelect(result)}
                className="w-full flex items-start gap-3.5 px-4.5 py-3.5 hover:bg-slate-800/40 transition-all text-left border-b border-slate-950 last:border-0 cursor-pointer"
              >
                <div className="mt-0.5 shrink-0 p-1 bg-slate-950/40 rounded-lg border border-slate-850">
                  <MapPin className="h-4 w-4 text-emerald-405" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-white truncate">
                    {result.name}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate mt-0.5 font-medium">
                    {[result.city, result.state].filter(Boolean).join(", ") ||
                      "India"}
                    {result.operator && ` • ${result.operator}`}
                  </p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider ${badgeClass}`}>
                    {result.source}
                  </span>
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      result.status === "AVAILABLE"
                        ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                        : result.status === "OCCUPIED"
                        ? "bg-amber-550 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                        : "bg-slate-500"
                    }`}
                  />
                </div>
              </button>
            );
          })}
          {results.length === 0 && query.length >= 2 && !isSearching && (
            <div className="px-4 py-6 text-center text-slate-500 text-xs font-medium">
              No stations found for "{query}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
