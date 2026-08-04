"use client";

import Filters from "@/components/layout/Filters";
import BottomDrawer from "@/components/layout/BottomDrawer";
import SearchBar from "@/components/layout/SearchBar";
import { useSession, signIn, signOut } from "next-auth/react";
import { Shield, Zap, User, LogOut, Crosshair } from "lucide-react";
import { useState, useEffect } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useStore } from "@/store/useStore";

const MapContainer = dynamic(() => import("@/components/map/Map"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-md z-50">
      <div className="relative flex h-12 w-12 items-center justify-center">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-6 w-6 bg-emerald-500"></span>
      </div>
      <p className="mt-4 text-slate-300 font-medium tracking-wide">Initializing Full Charge Map...</p>
    </div>
  ),
});

export default function Home() {
  const { data: session } = useSession();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const setUserLocation = useStore((state) => state.setUserLocation);
  const setMapCenter = useStore((state) => state.setMapCenter);
  const setMapZoom = useStore((state) => state.setMapZoom);
  const [geoLocating, setGeoLocating] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // Auto-geolocate on mount
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const loc = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setUserLocation(loc);
          setMapCenter(loc);
        },
        () => {
          // Silently fall back to Mumbai default
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    }
  }, [setUserLocation, setMapCenter]);

  // Fetch last sync time for freshness indicator
  useEffect(() => {
    const fetchSyncStatus = async () => {
      try {
        const res = await fetch("/api/admin/sync");
        if (res.ok) {
          const data = await res.json();
          if (data.lastSync?.timestamp) {
            setLastSyncTime(data.lastSync.timestamp);
          }
        }
      } catch {
        // Non-critical, ignore
      }
    };
    fetchSyncStatus();
    const interval = setInterval(fetchSyncStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleGpsClick = () => {
    if (!("geolocation" in navigator)) return;
    setGeoLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const loc = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setUserLocation(loc);
        setMapCenter(loc);
        setMapZoom(15);
        setGeoLocating(false);
      },
      () => {
        setGeoLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Compute freshness
  const getSyncFreshness = () => {
    if (!lastSyncTime) return null;
    const diffMs = Date.now() - new Date(lastSyncTime).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return { text: "Just synced", fresh: true };
    if (diffMin < 60) return { text: `Synced ${diffMin}m ago`, fresh: diffMin < 30 };
    const diffHrs = Math.floor(diffMin / 60);
    return { text: `Synced ${diffHrs}h ago`, fresh: false };
  };

  const freshness = getSyncFreshness();

  return (
    <div className="relative flex flex-col flex-1 h-screen overflow-hidden bg-[#030712] font-sans">
      {/* Header Bar */}
      <header className="flex items-center justify-between px-6 py-4 glass-header z-30 shadow-lg shadow-black/10">
        <div className="flex items-center gap-2.5">
          <div className="h-8.5 w-8.5 rounded-xl bg-gradient-to-tr from-emerald-400 to-teal-500 flex items-center justify-center text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.35)] animate-pulse">
            <Zap className="h-4.5 w-4.5 fill-slate-950 stroke-slate-950" />
          </div>
          <div>
            <h1 className="text-sm font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 bg-clip-text text-transparent leading-none">Full Charge</h1>
            <p className="text-[9px] text-slate-450 mt-0.5 tracking-widest font-semibold uppercase">India's Unified EV Network</p>
          </div>
        </div>

        {/* Search Bar (center) */}
        <div className="hidden sm:block flex-1 mx-8 max-w-md">
          <SearchBar />
        </div>

        {/* User Account / Sign In */}
        <div className="relative">
          {session ? (
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="flex h-9.5 w-9.5 items-center justify-center rounded-full border border-slate-800/80 bg-slate-900/90 hover:border-emerald-500/40 hover:scale-105 transition-all overflow-hidden cursor-pointer shadow-lg shadow-black/20"
            >
              {session.user?.image ? (
                <img 
                  src={session.user.image} 
                  alt={session.user.name || "User Avatar"} 
                  className="h-full w-full object-cover"
                />
              ) : (
                <User className="h-4.5 w-4.5 text-slate-400" />
              )}
            </button>
          ) : (
            <button
              onClick={() => signIn()}
              className="px-4.5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold transition-all text-xs shadow-md shadow-emerald-500/10 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
            >
              Sign In
            </button>
          )}

          {/* Profile Dropdown Menu */}
          {showProfileMenu && session && (
            <div className="absolute right-0 mt-3 w-56 rounded-2xl glass-panel-elevated p-2 shadow-2xl z-50 text-slate-100 animate-in fade-in slide-in-from-top-2 duration-250">
              <div className="px-3.5 py-3 border-b border-slate-800/80">
                <p className="text-xs font-bold text-white truncate">{session.user?.name}</p>
                <p className="text-[10px] text-slate-400 truncate mt-0.5">{session.user?.email}</p>
              </div>
              <div className="p-1 space-y-0.5 mt-1.5">
                {session.user?.role === "ADMIN" && (
                  <Link
                    href="/admin/sessions"
                    onClick={() => setShowProfileMenu(false)}
                    className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-xs font-bold text-emerald-400 hover:bg-slate-800/50 hover:text-emerald-300 transition-all"
                  >
                    <Shield className="h-4.5 w-4.5" />
                    Admin Panel
                  </Link>
                )}
                <button
                  onClick={() => {
                    setShowProfileMenu(false);
                    signOut();
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-xs font-bold text-rose-400 hover:bg-rose-950/20 hover:text-rose-350 transition-all text-left cursor-pointer"
                >
                  <LogOut className="h-4.5 w-4.5" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Mobile Search Bar */}
      <div className="sm:hidden px-5 pt-4">
        <SearchBar />
      </div>

      {/* Quick Filter Chips bar */}
      <Filters />

      {/* Main Map Container */}
      <div className="flex-1 relative bg-slate-950">
        <div className="absolute inset-0">
          <MapContainer />
        </div>

        {/* GPS / My Location Button */}
        <button
          onClick={handleGpsClick}
          disabled={geoLocating}
          className="absolute bottom-28 right-5 z-20 h-12 w-12 rounded-2xl bg-slate-900/90 backdrop-blur-md border border-slate-800/80 flex items-center justify-center text-emerald-400 hover:text-emerald-300 hover:border-emerald-500/40 hover:scale-105 active:scale-95 transition-all shadow-xl shadow-black/40 disabled:opacity-50 cursor-pointer"
          title="Go to my location"
        >
          {geoLocating ? (
            <div className="h-5 w-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Crosshair className="h-5.5 w-5.5" />
          )}
        </button>

        {/* Data Freshness Indicator */}
        {freshness && (
          <div className="absolute top-4 right-4 z-20 flex items-center gap-1.5 px-3 py-2 rounded-full glass-panel text-[10px] font-bold text-slate-350 shadow-md shadow-black/25">
            <span
              className={`h-2 w-2 rounded-full ${
                freshness.fresh
                  ? "bg-emerald-500 animate-pulse"
                  : "bg-amber-500"
              }`}
            />
            {freshness.text}
          </div>
        )}
      </div>

      {/* Mobile Swipeable Details Sheet */}
      <BottomDrawer />
    </div>
  );
}
