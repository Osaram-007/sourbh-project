"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { 
  Shield, Key, AlertTriangle, CheckCircle, RefreshCw, 
  Terminal, Server, Clock, LogOut, ArrowLeft, Send,
  Database, Zap, BarChart3, Activity, PlayCircle
} from "lucide-react";
import Link from "next/link";

interface CpoCredential {
  id: string;
  cpoName: string;
  status: string;
  updatedAt: string;
  expiresAt: string | null;
  hasToken: boolean;
  headers: Record<string, string>;
  cookies: Record<string, string> | null;
  errorLogs: Array<{
    id: string;
    statusCode: number;
    message: string;
    timestamp: string;
  }>;
}

interface SyncStatus {
  lastSync: {
    timestamp: string;
    totalRaw: number;
    totalDeduplicated: number;
    scraperResults: Array<{
      name: string;
      count: number;
      status: string;
      durationMs: number;
    }>;
    error?: string;
  } | null;
  syncInProgress: boolean;
  nextSyncAt: string | null;
}

interface DbStats {
  totalStations: number;
  totalConnectors: number;
  totalUsers: number;
  totalReviews: number;
  sourceBreakdown: Array<{ source: string; count: number }>;
  connectorBreakdown: Array<{ type: string; count: number }>;
  statusBreakdown: Array<{ status: string; count: number }>;
}

export default function AdminSessionsPage() {
  const { data: session, status } = useSession();
  const [credentials, setCredentials] = useState<CpoCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sync state
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncTriggering, setSyncTriggering] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // DB stats
  const [dbStats, setDbStats] = useState<DbStats | null>(null);

  // Form states
  const [selectedCpo, setSelectedCpo] = useState("tata");
  const [authToken, setAuthToken] = useState("");
  const [headersJson, setHeadersJson] = useState('{\n  "User-Agent": "Mozilla/5.0",\n  "Content-Type": "application/json"\n}');
  const [cookiesJson, setCookiesJson] = useState("{}");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchCredentials = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/credentials");
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error("Access Denied. You must have an ADMIN role.");
        }
        throw new Error("Failed to load credentials");
      }
      const data = await res.json();
      setCredentials(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchSyncStatus = async () => {
    try {
      const res = await fetch("/api/admin/sync");
      if (res.ok) {
        const data = await res.json();
        setSyncStatus(data);
      }
    } catch {
      // Non-critical
    }
  };

  const fetchDbStats = async () => {
    try {
      const res = await fetch("/api/admin/stats");
      if (res.ok) {
        const data = await res.json();
        setDbStats(data);
      }
    } catch {
      // Non-critical
    }
  };

  useEffect(() => {
    if (session?.user?.role === "ADMIN") {
      fetchCredentials();
      fetchSyncStatus();
      fetchDbStats();

      // Refresh sync status every 30 seconds
      const interval = setInterval(() => {
        fetchSyncStatus();
        fetchDbStats();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [session]);

  const handleTriggerSync = async () => {
    setSyncTriggering(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/admin/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setSyncMessage({ type: "success", text: `Sync complete! ${data.result.totalDeduplicated} stations saved.` });
      fetchSyncStatus();
      fetchDbStats();
    } catch (err: any) {
      setSyncMessage({ type: "error", text: err.message });
    } finally {
      setSyncTriggering(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormMessage(null);

    try {
      let parsedHeaders = {};
      let parsedCookies = {};

      try {
        parsedHeaders = JSON.parse(headersJson);
      } catch (e) {
        throw new Error("Invalid custom headers JSON syntax");
      }

      try {
        parsedCookies = JSON.parse(cookiesJson);
      } catch (e) {
        throw new Error("Invalid cookies JSON syntax");
      }

      const res = await fetch("/api/admin/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cpoName: selectedCpo,
          authToken,
          headers: parsedHeaders,
          cookies: parsedCookies,
          expiresAt: expiresAt || null
        })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to update tokens");

      setFormMessage({ type: "success", text: result.message });
      // Reset form
      setAuthToken("");
      fetchCredentials();
    } catch (err: any) {
      setFormMessage({ type: "error", text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  // Compute next sync countdown
  const getNextSyncCountdown = () => {
    if (!syncStatus?.nextSyncAt) return null;
    const diff = new Date(syncStatus.nextSyncAt).getTime() - Date.now();
    if (diff <= 0) return "Now";
    const min = Math.floor(diff / 60000);
    return `${min}m`;
  };

  // 1. Loading Session state
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
        <RefreshCw className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  // 2. Unauthenticated state
  if (status === "unauthenticated") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 px-6 text-center text-slate-100">
        <div className="p-4 rounded-full bg-slate-900 border border-slate-800 text-rose-500 mb-4 animate-bounce">
          <Shield className="h-10 w-10" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-white">Full Charge Admin Control</h2>
        <p className="mt-2 text-slate-400 text-xs max-w-sm">
          Access to this area requires an administrative session. Please sign in with your administrator account.
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

  // 3. Authenticated but NOT ADMIN role
  if (session?.user?.role !== "ADMIN") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 px-6 text-center text-slate-100">
        <div className="p-4 rounded-full bg-slate-900 border border-slate-800 text-amber-500 mb-4">
          <AlertTriangle className="h-10 w-10" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-white">Access Denied</h2>
        <p className="mt-2 text-slate-400 text-xs max-w-md">
          Your account ({session?.user?.email}) does not have administrative privileges (`role: {session?.user?.role}`). Contact the system owner.
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

  // 4. Authorized Admin Dashboard View
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="px-6 py-4 bg-slate-900/50 backdrop-blur-md border-b border-slate-900 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Shield className="h-5 w-5 text-emerald-400" />
          <h1 className="text-sm font-bold tracking-wide text-white uppercase">Admin Control Center</h1>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/admin/analytics"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 text-[10px] font-bold uppercase tracking-wider transition-all"
          >
            <BarChart3 className="h-3.5 w-3.5" /> Analytics
          </Link>
          <span className="text-xs text-slate-400">Signed in as <strong className="text-slate-200">{session?.user?.name}</strong></span>
          <button 
            onClick={() => signOut({ callbackUrl: "/" })}
            className="flex items-center gap-1 text-slate-400 hover:text-rose-400 text-xs font-semibold transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign Out
          </button>
        </div>
      </header>

      {/* Main Grid Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        
        {/* ===== TOP ROW: Stats Cards ===== */}
        {dbStats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-900">
              <div className="flex items-center gap-2 mb-2">
                <Database className="h-4 w-4 text-emerald-400" />
                <span className="text-[10px] font-bold text-slate-500 uppercase">Total Stations</span>
              </div>
              <p className="text-2xl font-extrabold text-white">{dbStats.totalStations.toLocaleString()}</p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-900">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-amber-400" />
                <span className="text-[10px] font-bold text-slate-500 uppercase">Total Connectors</span>
              </div>
              <p className="text-2xl font-extrabold text-white">{dbStats.totalConnectors.toLocaleString()}</p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-900">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-4 w-4 text-blue-400" />
                <span className="text-[10px] font-bold text-slate-500 uppercase">Users</span>
              </div>
              <p className="text-2xl font-extrabold text-white">{dbStats.totalUsers.toLocaleString()}</p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-900">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="h-4 w-4 text-rose-400" />
                <span className="text-[10px] font-bold text-slate-500 uppercase">Reviews</span>
              </div>
              <p className="text-2xl font-extrabold text-white">{dbStats.totalReviews.toLocaleString()}</p>
            </div>
          </div>
        )}

        {/* ===== SOURCE BREAKDOWN ===== */}
        {dbStats && dbStats.sourceBreakdown.length > 0 && (
          <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-900">
            <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-emerald-400" />
              Stations by Source
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {dbStats.sourceBreakdown.map((s) => (
                <div key={s.source} className="p-3 rounded-xl bg-slate-900/80 border border-slate-850 text-center">
                  <p className="text-[10px] font-bold text-slate-500 uppercase">{s.source}</p>
                  <p className="text-lg font-extrabold text-white mt-1">{s.count.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ===== LEFT COLUMN: Sync Status + CPO Credentials ===== */}
          <div className="lg:col-span-2 space-y-6">

            {/* Sync Status & Trigger Card */}
            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-900">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <PlayCircle className="h-4 w-4 text-emerald-400" />
                  Data Synchronization Engine
                </h2>
                <button
                  onClick={handleTriggerSync}
                  disabled={syncTriggering || syncStatus?.syncInProgress}
                  className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs transition-all flex items-center gap-1.5 shadow-lg shadow-emerald-500/10 disabled:opacity-50"
                >
                  {syncTriggering || syncStatus?.syncInProgress ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PlayCircle className="h-3.5 w-3.5" />
                  )}
                  {syncTriggering ? "Syncing..." : syncStatus?.syncInProgress ? "In Progress..." : "Trigger Sync Now"}
                </button>
              </div>

              {syncMessage && (
                <div className={`p-3 rounded-lg border text-xs flex items-start gap-2 mb-4 ${
                  syncMessage.type === "success" 
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                    : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                }`}>
                  {syncMessage.type === "success" ? <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}
                  <span>{syncMessage.text}</span>
                </div>
              )}

              {syncStatus?.lastSync ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-4 text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Last: {new Date(syncStatus.lastSync.timestamp).toLocaleString()}
                    </span>
                    <span>Raw: {syncStatus.lastSync.totalRaw} → Deduped: {syncStatus.lastSync.totalDeduplicated}</span>
                    {getNextSyncCountdown() && (
                      <span className="text-emerald-400">Next in: {getNextSyncCountdown()}</span>
                    )}
                  </div>
                  
                  {/* Per-Scraper Results Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="border-b border-slate-800">
                          <th className="text-left py-2 px-3 text-slate-500 font-bold uppercase">Source</th>
                          <th className="text-right py-2 px-3 text-slate-500 font-bold uppercase">Stations</th>
                          <th className="text-right py-2 px-3 text-slate-500 font-bold uppercase">Time</th>
                          <th className="text-right py-2 px-3 text-slate-500 font-bold uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {syncStatus.lastSync.scraperResults.map((sr) => (
                          <tr key={sr.name} className="border-b border-slate-900">
                            <td className="py-2 px-3 text-white font-bold capitalize">{sr.name}</td>
                            <td className="py-2 px-3 text-right text-slate-300">{sr.count}</td>
                            <td className="py-2 px-3 text-right text-slate-400">{(sr.durationMs / 1000).toFixed(1)}s</td>
                            <td className="py-2 px-3 text-right">
                              <span className={`px-1.5 py-0.5 rounded ${
                                sr.status === "Success"
                                  ? "bg-emerald-500/10 text-emerald-400"
                                  : "bg-rose-500/10 text-rose-400"
                              }`}>
                                {sr.status === "Success" ? "✓" : "✗"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 text-center py-4">No sync has been run yet. Auto-sync will trigger shortly after server start.</p>
              )}
            </div>

            {/* CPO Credentials List */}
            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-900">
              <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <Server className="h-4 w-4 text-emerald-400" />
                Aggregated Network Status
              </h2>
              
              {loading ? (
                <div className="flex justify-center py-6"><RefreshCw className="h-5 w-5 animate-spin text-emerald-400" /></div>
              ) : credentials.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">No CPO credentials configured yet. Use the setup form on the right.</p>
              ) : (
                <div className="space-y-4">
                  {credentials.map((cred) => (
                    <div key={cred.id} className="p-4 rounded-xl bg-slate-900/80 border border-slate-850 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-xs font-bold text-white capitalize">{cred.cpoName} Mobile API</h3>
                          <p className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <Clock className="h-3 w-3" /> Last token sync: {new Date(cred.updatedAt).toLocaleString()}
                          </p>
                        </div>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          cred.status === "ACTIVE" 
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                            : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                        }`}>
                          {cred.status}
                        </span>
                      </div>

                      {/* Error Logs Preview */}
                      {cred.errorLogs.length > 0 && (
                        <div className="p-3 rounded-lg bg-slate-950 border border-slate-900 space-y-1.5">
                          <p className="text-[9px] font-bold text-rose-400 flex items-center gap-1">
                            <Terminal className="h-3 w-3" /> Crawler Failures:
                          </p>
                          <div className="space-y-1">
                            {cred.errorLogs.map((log) => (
                              <div key={log.id} className="text-[9px] text-slate-400 flex justify-between gap-4 leading-normal">
                                <span className="truncate">{log.message}</span>
                                <span className="shrink-0 text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ===== RIGHT COLUMN: Update Token Form ===== */}
          <div>
            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-900">
              <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <Key className="h-4 w-4 text-emerald-400" />
                Configure Credentials
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Select CPO */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-450 uppercase mb-1.5">Target Network</label>
                  <select 
                    value={selectedCpo}
                    onChange={(e) => setSelectedCpo(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 text-xs focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="tata">Tata Power EZ Charge</option>
                    <option value="ather">Ather Grid</option>
                    <option value="statiq">Statiq</option>
                  </select>
                </div>

                {/* Auth Token */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-450 uppercase mb-1.5 font-mono">Authentication Token / Bearer JWT</label>
                  <textarea 
                    required
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    placeholder="Paste JWT, auth token, or auth header key..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-250 text-xs font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                {/* Custom Headers */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-450 uppercase mb-1.5">Spoofed Request Headers (JSON)</label>
                  <textarea 
                    value={headersJson}
                    onChange={(e) => setHeadersJson(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-250 text-xs font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                {/* Cookies */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-450 uppercase mb-1.5">Session Cookies (JSON)</label>
                  <textarea 
                    value={cookiesJson}
                    onChange={(e) => setCookiesJson(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-250 text-xs font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                {/* Expiration Date */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-450 uppercase mb-1.5">Token Expiration Date (Optional)</label>
                  <input 
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 text-xs focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                {/* Status Alert */}
                {formMessage && (
                  <div className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                    formMessage.type === "success" 
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                      : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                  }`}>
                    {formMessage.type === "success" ? <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}
                    <span>{formMessage.text}</span>
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold transition-all text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/10 disabled:opacity-50"
                >
                  {submitting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Update Credentials
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
