"use client";

import { useStore } from "@/store/useStore";
import { Zap, Shield, RotateCcw, Activity } from "lucide-react";

export default function Filters() {
  const filters = useStore((state) => state.filters);
  const toggleProvider = useStore((state) => state.toggleProvider);
  const toggleConnectorType = useStore((state) => state.toggleConnectorType);
  const toggleSpeed = useStore((state) => state.toggleSpeed);
  const setStatusFilter = useStore((state) => state.setStatusFilter);
  const resetFilters = useStore((state) => state.resetFilters);

  const activeFiltersCount = 
    filters.providers.length + 
    filters.connectorTypes.length + 
    filters.speeds.length + 
    (filters.status ? 1 : 0);

  // Helper to color active CPO chips
  const getCpoChipClass = (providerId: string) => {
    const isActive = filters.providers.includes(providerId);
    if (!isActive) {
      return "bg-slate-900/40 text-slate-400 border-slate-800/80 hover:text-slate-200 hover:border-slate-700/60";
    }
    
    switch (providerId) {
      case "tata":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.2)]";
      case "ather":
        return "bg-cyan-500/10 text-cyan-400 border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.2)]";
      case "bpcl":
        return "bg-orange-500/10 text-orange-400 border-orange-500/40 shadow-[0_0_12px_rgba(249,115,22,0.2)]";
      case "statiq":
        return "bg-amber-500/10 text-amber-400 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.2)]";
      case "chargezone":
        return "bg-rose-500/10 text-rose-450 border-rose-500/45 shadow-[0_0_12px_rgba(244,63,94,0.2)]";
      default:
        return "bg-slate-800 text-white border-slate-700";
    }
  };

  return (
    <div className="flex flex-col gap-2 px-6 py-3 w-full glass-header z-30 shadow-md shadow-black/5">
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar scroll-smooth">
        {/* Quick Filter: Available Now */}
        <button
          onClick={() => setStatusFilter(filters.status === "AVAILABLE" ? null : "AVAILABLE")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border text-xs font-bold shrink-0 transition-all cursor-pointer hover:scale-103 active:scale-97 ${
            filters.status === "AVAILABLE"
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.25)]"
              : "bg-slate-900/40 text-slate-400 border-slate-800/80 hover:text-slate-200"
          }`}
        >
          <Activity className="h-3.5 w-3.5" />
          Available Now
        </button>

        {/* Quick Filter: DC Fast */}
        <button
          onClick={() => toggleSpeed("DC")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border text-xs font-bold shrink-0 transition-all cursor-pointer hover:scale-103 active:scale-97 ${
            filters.speeds.includes("DC")
              ? "bg-amber-500/10 text-amber-400 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.25)]"
              : "bg-slate-900/40 text-slate-400 border-slate-800/80 hover:text-slate-200"
          }`}
        >
          <Zap className="h-3.5 w-3.5" />
          DC Fast Chargers
        </button>

        {/* Divider */}
        <div className="h-4 w-px bg-slate-800/80 shrink-0 mx-1.5" />

        {/* Providers */}
        {[
          { id: "tata", label: "Tata Power" },
          { id: "ather", label: "Ather Grid" },
          { id: "bpcl", label: "BPCL eDrive" },
          { id: "statiq", label: "Statiq" },
          { id: "chargezone", label: "Charge Zone" },
        ].map((prov) => (
          <button
            key={prov.id}
            onClick={() => toggleProvider(prov.id)}
            className={`px-4 py-2 rounded-xl border text-xs font-bold shrink-0 transition-all cursor-pointer hover:scale-103 active:scale-97 ${getCpoChipClass(
              prov.id
            )}`}
          >
            {prov.label}
          </button>
        ))}

        {/* Reset Button */}
        {activeFiltersCount > 0 && (
          <button
            onClick={resetFilters}
            className="flex items-center gap-1 px-3 py-2 rounded-xl bg-rose-500/10 text-rose-450 hover:bg-rose-500/20 border border-rose-500/20 text-xs font-bold transition-all shrink-0 ml-auto cursor-pointer hover:scale-103 active:scale-97"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

