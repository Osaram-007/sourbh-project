"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState, useMemo } from "react";
import {
  Shield, ArrowLeft, RefreshCw, BarChart3, Activity,
  TrendingUp, TrendingDown, Clock, Zap, Database,
  Search, ChevronDown, LogOut, AlertTriangle, CheckCircle
} from "lucide-react";
import Link from "next/link";

// ===================================================================
// Types
// ===================================================================

interface FleetOverview {
  totalStationsTracked: number;
  totalSnapshots: number;
  avgUptimePercent: number;
  avgReliabilityScore: number;
  mostReliable: StationSummary[];
  leastReliable: StationSummary[];
  networkComparison: Record<string, NetworkStats>;
  statusDistribution: { status: string; percent: number }[];
}

interface StationSummary {
  stationId: string;
  stationName: string;
  operator: string | null;
  source: string;
  uptimePercent: number;
  reliabilityScore: number;
  totalSnapshots: number;
}

interface NetworkStats {
  stationCount: number;
  avgUptime: number;
  avgReliability: number;
}

interface StationBehavior {
  stationId: string;
  stationName: string;
  operator: string | null;
  source: string;
  timeRange: string;
  totalSnapshots: number;
  uptimePercent: number;
  offlinePercent: number;
  occupiedPercent: number;
  unknownPercent: number;
  reliabilityScore: number;
  statusTransitions: number;
  hourlyHeatmap: { hour: number; availableCount: number; occupiedCount: number; offlineCount: number; unknownCount: number; totalSnapshots: number }[];
  statusTimeline: { status: string; from: string; to: string; durationMinutes: number }[];
  connectorBreakdown: { connectorType: string; currentType: string; powerKw: number | null; totalSnapshots: number; availablePercent: number; occupiedPercent: number; faultedPercent: number }[];
}

// ===================================================================
// Helper Components
// ===================================================================

/** Simple horizontal bar chart rendered with CSS */
const BarFill = ({ percent, color }: { percent: number; color: string }) => (
  <div className="flex-1 h-3 rounded-full bg-slate-900 overflow-hidden">
    <div
      className={`h-full rounded-full transition-all duration-700 ${color}`}
      style={{ width: `${Math.min(percent, 100)}%` }}
    />
  </div>
);

/** Reliability score badge */
const ReliabilityBadge = ({ score }: { score: number }) => {
  const badgeClass =
    score >= 4.0
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      : score >= 2.5
      ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
      : "bg-rose-500/10 text-rose-400 border-rose-500/20";
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-md border ${badgeClass}`}>
      <Activity className="h-3 w-3" />
      {score.toFixed(1)}
    </span>
  );
};

/** Source color class helper */
const getSourceColor = (source: string) => {
  switch (source) {
    case "tata": return "text-emerald-400";
    case "ather": return "text-cyan-400";
    case "statiq": return "text-amber-400";
    case "chargezone": return "text-rose-400";
    case "ocm": return "text-violet-400";
    case "evyatra": return "text-blue-400";
    case "osm": return "text-sky-400";
    default: return "text-slate-400";
  }
};

const getBarColor = (source: string) => {
  switch (source) {
    case "tata": return "bg-emerald-500";
    case "ather": return "bg-cyan-500";
    case "statiq": return "bg-amber-500";
    case "chargezone": return "bg-rose-500";
    case "ocm": return "bg-violet-500";
    case "evyatra": return "bg-blue-500";
    case "osm": return "bg-sky-500";
    default: return "bg-slate-500";
  }
};

/** Status badge color helper */
const getStatusColor = (status: string) => {
  switch (status) {
    case "AVAILABLE": return "bg-emerald-500";
    case "OCCUPIED": return "bg-amber-500";
    case "OFFLINE": return "bg-rose-500";
    default: return "bg-slate-500";
  }
};

// ===================================================================
// Hourly Heatmap Component
// ===================================================================

const HourlyHeatmap = ({ heatmap }: { heatmap: StationBehavior["hourlyHeatmap"] }) => {
  const maxTotal = Math.max(...heatmap.map(h => h.totalSnapshots), 1);

  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">24-Hour Occupancy Heatmap</h4>
      <div className="flex gap-0.5 items-end h-20">
        {heatmap.map((bucket) => {
          const occupiedRatio = bucket.totalSnapshots > 0 ? bucket.occupiedCount / bucket.totalSnapshots : 0;
          const heightPercent = bucket.totalSnapshots > 0 ? (bucket.totalSnapshots / maxTotal) * 100 : 2;
          
          // Color intensity based on occupancy
          const bg = occupiedRatio > 0.6
            ? "bg-rose-500"
            : occupiedRatio > 0.3
            ? "bg-amber-500"
            : occupiedRatio > 0.1
            ? "bg-emerald-500"
            : "bg-slate-700";

          return (
            <div key={bucket.hour} className="flex-1 flex flex-col items-center gap-0.5" title={`${bucket.hour}:00 — ${bucket.occupiedCount}/${bucket.totalSnapshots} occupied`}>
              <div
                className={`w-full rounded-sm transition-all duration-500 ${bg} opacity-80 hover:opacity-100`}
                style={{ height: `${heightPercent}%`, minHeight: "2px" }}
              />
              {bucket.hour % 6 === 0 && (
                <span className="text-[7px] text-slate-500 font-bold">{bucket.hour}h</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 text-[8px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-slate-700" /> Low</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Moderate</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> High</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Very High</span>
      </div>
    </div>
  );
};

// ===================================================================
// Main Page Component
// ===================================================================

export default function AdminAnalyticsPage() {
  const { data: session, status } = useSession();
  const [timeRange, setTimeRange] = useState("7d");
  const [fleetData, setFleetData] = useState<FleetOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-station deep dive
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [stationBehavior, setStationBehavior] = useState<StationBehavior | null>(null);
  const [stationLoading, setStationLoading] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch fleet overview
  const fetchFleetData = async (range: string) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/analytics/fleet?range=${range}`);
      if (!res.ok) throw new Error("Failed to load fleet analytics");
      const data = await res.json();
      setFleetData(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch per-station behavior
  const fetchStationBehavior = async (stationId: string) => {
    try {
      setStationLoading(true);
      const res = await fetch(`/api/analytics/station/${stationId}?range=${timeRange}`);
      if (!res.ok) throw new Error("Failed to load station analytics");
      const data = await res.json();
      setStationBehavior(data);
    } catch (err: any) {
      console.error("Station analytics error:", err);
      setStationBehavior(null);
    } finally {
      setStationLoading(false);
    }
  };

  useEffect(() => {
    if (session?.user?.role === "ADMIN") {
      fetchFleetData(timeRange);
    }
  }, [session, timeRange]);

  useEffect(() => {
    if (selectedStationId) {
      fetchStationBehavior(selectedStationId);
    }
  }, [selectedStationId, timeRange]);

  // Filter stations by search
  const filteredMostReliable = useMemo(() => {
    if (!fleetData) return [];
    if (!searchQuery) return fleetData.mostReliable;
    const q = searchQuery.toLowerCase();
    return fleetData.mostReliable.filter(s =>
      s.stationName.toLowerCase().includes(q) || s.source.toLowerCase().includes(q)
    );
  }, [fleetData, searchQuery]);

  const filteredLeastReliable = useMemo(() => {
    if (!fleetData) return [];
    if (!searchQuery) return fleetData.leastReliable;
    const q = searchQuery.toLowerCase();
    return fleetData.leastReliable.filter(s =>
      s.stationName.toLowerCase().includes(q) || s.source.toLowerCase().includes(q)
    );
  }, [fleetData, searchQuery]);

  // Auth guards
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
        <RefreshCw className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 px-6 text-center text-slate-100">
        <div className="p-4 rounded-full bg-slate-900 border border-slate-800 text-rose-500 mb-4 animate-bounce">
          <Shield className="h-10 w-10" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-white">Analytics Dashboard</h2>
        <p className="mt-2 text-slate-400 text-xs max-w-sm">
          Sign in with an administrator account to access charger behavior analytics.
        </p>
        <button
          onClick={() => signIn()}
          className="mt-6 px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold transition-all shadow-lg shadow-emerald-500/20 text-sm"
        >
          Sign In as Administrator
        </button>
      </div>
    );
  }

  if (session?.user?.role !== "ADMIN") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 px-6 text-center text-slate-100">
        <div className="p-4 rounded-full bg-slate-900 border border-slate-800 text-amber-500 mb-4">
          <AlertTriangle className="h-10 w-10" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-white">Access Denied</h2>
        <p className="mt-2 text-slate-400 text-xs max-w-md">
          Your account ({session?.user?.email}) requires ADMIN privileges to access analytics.
        </p>
        <div className="flex gap-4 mt-6">
          <button
            onClick={() => signOut()}
            className="px-5 py-2.5 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 transition-all text-xs font-semibold"
          >
            Sign Out
          </button>
          <Link
            href="/"
            className="px-5 py-2.5 rounded-lg bg-slate-100 hover:bg-white text-slate-950 transition-all text-xs font-bold flex items-center gap-1.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Map
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 bg-slate-900/50 backdrop-blur-md border-b border-slate-900 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/sessions" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <BarChart3 className="h-5 w-5 text-emerald-400" />
          <h1 className="text-sm font-bold tracking-wide text-white uppercase">Charger Behavior Analytics</h1>
        </div>
        <div className="flex items-center gap-4">
          {/* Time Range Selector */}
          <div className="flex items-center gap-1 bg-slate-900 rounded-lg p-0.5 border border-slate-800">
            {["24h", "7d", "30d"].map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${
                  timeRange === range
                    ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {range}
              </button>
            ))}
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="flex items-center gap-1 text-slate-400 hover:text-rose-400 text-xs font-semibold transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign Out
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <RefreshCw className="h-8 w-8 animate-spin text-emerald-400" />
          </div>
        ) : error ? (
          <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            {error}
          </div>
        ) : fleetData ? (
          <>
            {/* ===== TOP ROW: Fleet Overview Cards ===== */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-900 hover:border-slate-800 transition-all">
                <div className="flex items-center gap-2 mb-2">
                  <Database className="h-4 w-4 text-emerald-400" />
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Stations Tracked</span>
                </div>
                <p className="text-3xl font-extrabold text-white">{fleetData.totalStationsTracked.toLocaleString()}</p>
                <p className="text-[10px] text-slate-500 mt-1">{fleetData.totalSnapshots.toLocaleString()} total snapshots</p>
              </div>
              <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-900 hover:border-slate-800 transition-all">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Avg. Uptime</span>
                </div>
                <p className="text-3xl font-extrabold text-white">{fleetData.avgUptimePercent}%</p>
                <p className="text-[10px] text-slate-500 mt-1">across all networks</p>
              </div>
              <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-900 hover:border-slate-800 transition-all">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-4 w-4 text-amber-400" />
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Avg. Reliability</span>
                </div>
                <p className="text-3xl font-extrabold text-white">{fleetData.avgReliabilityScore}</p>
                <p className="text-[10px] text-slate-500 mt-1">out of 5.0</p>
              </div>
              <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-900 hover:border-slate-800 transition-all">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-4 w-4 text-blue-400" />
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Time Range</span>
                </div>
                <p className="text-3xl font-extrabold text-white">{timeRange === "24h" ? "24H" : timeRange === "7d" ? "7 Days" : "30 Days"}</p>
                <p className="text-[10px] text-slate-500 mt-1">analysis window</p>
              </div>
            </div>

            {/* ===== STATUS DISTRIBUTION ===== */}
            {fleetData.statusDistribution.length > 0 && (
              <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-900">
                <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                  <Zap className="h-4 w-4 text-emerald-400" />
                  Status Distribution (Across All Snapshots)
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {fleetData.statusDistribution.map((sd) => (
                    <div key={sd.status} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">{sd.status}</span>
                        <span className="text-xs font-extrabold text-white">{sd.percent}%</span>
                      </div>
                      <BarFill percent={sd.percent} color={getStatusColor(sd.status)} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ===== NETWORK COMPARISON ===== */}
            {Object.keys(fleetData.networkComparison).length > 0 && (
              <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-900">
                <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-emerald-400" />
                  Network Uptime Comparison
                </h2>
                <div className="space-y-3">
                  {Object.entries(fleetData.networkComparison)
                    .sort(([, a], [, b]) => b.avgUptime - a.avgUptime)
                    .map(([source, stats]) => (
                      <div key={source} className="flex items-center gap-4">
                        <span className={`w-24 text-xs font-bold uppercase ${getSourceColor(source)}`}>
                          {source}
                        </span>
                        <BarFill percent={stats.avgUptime} color={getBarColor(source)} />
                        <div className="flex items-center gap-3 shrink-0 w-36">
                          <span className="text-xs font-extrabold text-white w-12 text-right">{stats.avgUptime}%</span>
                          <ReliabilityBadge score={stats.avgReliability} />
                          <span className="text-[9px] text-slate-500">({stats.stationCount})</span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* ===== MOST / LEAST RELIABLE ===== */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Search Bar */}
              <div className="lg:col-span-2">
                <div className="relative max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search chargers by name or network..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Most Reliable */}
              <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-900">
                <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  Most Reliable Chargers
                </h2>
                <div className="space-y-2">
                  {filteredMostReliable.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-4">No data available</p>
                  ) : (
                    filteredMostReliable.map((station, idx) => (
                      <button
                        key={station.stationId}
                        onClick={() => setSelectedStationId(station.stationId)}
                        className={`w-full flex items-center justify-between p-3 rounded-xl transition-all text-left cursor-pointer ${
                          selectedStationId === station.stationId
                            ? "bg-emerald-500/10 border border-emerald-500/20"
                            : "bg-slate-900/60 border border-slate-850 hover:border-slate-750 hover:bg-slate-900"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-[10px] font-extrabold text-slate-500 w-4">#{idx + 1}</span>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white truncate">{station.stationName}</p>
                            <p className={`text-[9px] font-bold uppercase ${getSourceColor(station.source)}`}>{station.source}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-extrabold text-emerald-400">{station.uptimePercent}%</span>
                          <ReliabilityBadge score={station.reliabilityScore} />
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Least Reliable */}
              <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-900">
                <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-rose-400" />
                  Least Reliable Chargers
                </h2>
                <div className="space-y-2">
                  {filteredLeastReliable.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-4">No data available</p>
                  ) : (
                    filteredLeastReliable.map((station, idx) => (
                      <button
                        key={station.stationId}
                        onClick={() => setSelectedStationId(station.stationId)}
                        className={`w-full flex items-center justify-between p-3 rounded-xl transition-all text-left cursor-pointer ${
                          selectedStationId === station.stationId
                            ? "bg-rose-500/10 border border-rose-500/20"
                            : "bg-slate-900/60 border border-slate-850 hover:border-slate-750 hover:bg-slate-900"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-[10px] font-extrabold text-slate-500 w-4">#{idx + 1}</span>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white truncate">{station.stationName}</p>
                            <p className={`text-[9px] font-bold uppercase ${getSourceColor(station.source)}`}>{station.source}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-extrabold text-rose-400">{station.uptimePercent}%</span>
                          <ReliabilityBadge score={station.reliabilityScore} />
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* ===== PER-CHARGER DEEP DIVE ===== */}
            {selectedStationId && (
              <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-900 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    <Activity className="h-4 w-4 text-emerald-400" />
                    Charger Behavior Deep Dive
                  </h2>
                  <button
                    onClick={() => { setSelectedStationId(null); setStationBehavior(null); }}
                    className="text-[10px] font-bold text-slate-400 hover:text-white transition-colors px-3 py-1 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer"
                  >
                    Close
                  </button>
                </div>

                {stationLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw className="h-6 w-6 animate-spin text-emerald-400" />
                  </div>
                ) : stationBehavior ? (
                  <div className="space-y-6">
                    {/* Station Header */}
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-lg font-black text-white">{stationBehavior.stationName}</h3>
                        <p className="text-xs text-slate-400 mt-0.5 font-semibold">
                          {stationBehavior.operator || "Independent"} • <span className={`uppercase font-bold ${getSourceColor(stationBehavior.source)}`}>{stationBehavior.source}</span>
                        </p>
                      </div>
                      <ReliabilityBadge score={stationBehavior.reliabilityScore} />
                    </div>

                    {/* Key Metrics */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="p-3 rounded-xl bg-slate-950 border border-slate-900 text-center">
                        <p className="text-[9px] font-bold text-slate-500 uppercase">Uptime</p>
                        <p className="text-xl font-extrabold text-emerald-400 mt-1">{stationBehavior.uptimePercent}%</p>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-950 border border-slate-900 text-center">
                        <p className="text-[9px] font-bold text-slate-500 uppercase">Occupied</p>
                        <p className="text-xl font-extrabold text-amber-400 mt-1">{stationBehavior.occupiedPercent}%</p>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-950 border border-slate-900 text-center">
                        <p className="text-[9px] font-bold text-slate-500 uppercase">Offline</p>
                        <p className="text-xl font-extrabold text-rose-400 mt-1">{stationBehavior.offlinePercent}%</p>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-950 border border-slate-900 text-center">
                        <p className="text-[9px] font-bold text-slate-500 uppercase">Transitions</p>
                        <p className="text-xl font-extrabold text-blue-400 mt-1">{stationBehavior.statusTransitions}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-950 border border-slate-900 text-center">
                        <p className="text-[9px] font-bold text-slate-500 uppercase">Snapshots</p>
                        <p className="text-xl font-extrabold text-slate-300 mt-1">{stationBehavior.totalSnapshots}</p>
                      </div>
                    </div>

                    {/* Status Breakdown Bar */}
                    <div className="space-y-2">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status Breakdown</h4>
                      <div className="h-4 rounded-full overflow-hidden flex bg-slate-900">
                        {stationBehavior.uptimePercent > 0 && (
                          <div className="bg-emerald-500 transition-all duration-700" style={{ width: `${stationBehavior.uptimePercent}%` }} title={`Available: ${stationBehavior.uptimePercent}%`} />
                        )}
                        {stationBehavior.occupiedPercent > 0 && (
                          <div className="bg-amber-500 transition-all duration-700" style={{ width: `${stationBehavior.occupiedPercent}%` }} title={`Occupied: ${stationBehavior.occupiedPercent}%`} />
                        )}
                        {stationBehavior.offlinePercent > 0 && (
                          <div className="bg-rose-500 transition-all duration-700" style={{ width: `${stationBehavior.offlinePercent}%` }} title={`Offline: ${stationBehavior.offlinePercent}%`} />
                        )}
                        {stationBehavior.unknownPercent > 0 && (
                          <div className="bg-slate-600 transition-all duration-700" style={{ width: `${stationBehavior.unknownPercent}%` }} title={`Unknown: ${stationBehavior.unknownPercent}%`} />
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-[9px] text-slate-400">
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Available {stationBehavior.uptimePercent}%</span>
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Occupied {stationBehavior.occupiedPercent}%</span>
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> Offline {stationBehavior.offlinePercent}%</span>
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-600" /> Unknown {stationBehavior.unknownPercent}%</span>
                      </div>
                    </div>

                    {/* Hourly Heatmap */}
                    <HourlyHeatmap heatmap={stationBehavior.hourlyHeatmap} />

                    {/* Connector Breakdown */}
                    {stationBehavior.connectorBreakdown.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Connector-Level Analysis</h4>
                        <div className="space-y-2">
                          {stationBehavior.connectorBreakdown.map((conn, idx) => (
                            <div key={idx} className="p-3 rounded-xl bg-slate-950 border border-slate-900 flex items-center justify-between">
                              <div>
                                <p className="text-xs font-bold text-white">{conn.connectorType} ({conn.currentType})</p>
                                <p className="text-[9px] text-slate-500 mt-0.5">{conn.powerKw ? `${conn.powerKw} kW` : "Variable"} • {conn.totalSnapshots} readings</p>
                              </div>
                              <div className="flex items-center gap-3 text-[9px] font-bold">
                                <span className="text-emerald-400">{conn.availablePercent}% avail</span>
                                <span className="text-amber-400">{conn.occupiedPercent}% occup</span>
                                {conn.faultedPercent > 0 && <span className="text-rose-400">{conn.faultedPercent}% fault</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recent Status Timeline */}
                    {stationBehavior.statusTimeline.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Recent Status Changes (Last {stationBehavior.statusTimeline.length})</h4>
                        <div className="space-y-1 max-h-48 overflow-y-auto no-scrollbar">
                          {stationBehavior.statusTimeline.slice(-15).reverse().map((entry, idx) => (
                            <div key={idx} className="flex items-center gap-3 text-[10px] py-1.5 px-3 rounded-lg bg-slate-950/50">
                              <span className={`h-2 w-2 rounded-full shrink-0 ${getStatusColor(entry.status)}`} />
                              <span className="font-bold text-white w-20">{entry.status}</span>
                              <span className="text-slate-500">{entry.durationMinutes}m</span>
                              <span className="text-slate-600 text-[9px]">
                                {new Date(entry.from).toLocaleString()} → {new Date(entry.to).toLocaleTimeString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 text-center py-8">No analytics data available for this station.</p>
                )}
              </div>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
