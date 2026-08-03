"use client";

import { Drawer } from "vaul";
import { useStore } from "@/store/useStore";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  MapPin, Clock, Shield, Star, Navigation, 
  X, Compass, Heart, Share2, Wifi, Coffee, HelpCircle, Send, MessageSquare, Activity
} from "lucide-react";
import { useSession, signIn } from "next-auth/react";
import { useState } from "react";

// Map connector type to label and power speed icon
const getConnectorTypeLabel = (type: string) => {
  switch (type) {
    case "CCS2":
      return "CCS2 (DC Fast)";
    case "CHADEMO":
      return "CHAdeMO (DC)";
    case "TYPE2":
      return "Type 2 (AC)";
    case "GB_T":
      return "GB/T (Fast)";
    case "BHARAT_AC":
      return "Bharat AC-001";
    case "BHARAT_DC":
      return "Bharat DC-001";
    case "WALL_SOCKET":
      return "Wall Socket (16A)";
    default:
      return type;
  }
};

const getStatusBadgeClass = (status: string) => {
  switch (status) {
    case "AVAILABLE":
      return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
    case "OCCUPIED":
      return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
    case "OFFLINE":
      return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
    default:
      return "bg-slate-500/10 text-slate-400 border border-slate-500/20";
  }
};

const AmenityIcon = ({ name }: { name: string }) => {
  switch (name) {
    case "WIFI":
      return <div className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 border border-slate-700"><Wifi className="h-3.5 w-3.5" /> Wi-Fi</div>;
    case "FOOD_COURT":
      return <div className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 border border-slate-700"><Coffee className="h-3.5 w-3.5" /> Food & Cafe</div>;
    case "RESTROOMS":
      return <div className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 border border-slate-700">Restrooms</div>;
    case "PARKING":
      return <div className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 border border-slate-700">Dedicated Parking</div>;
    default:
      return <div className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 border border-slate-700"><HelpCircle className="h-3.5 w-3.5" /> {name}</div>;
  }
};

// Star Rating Component
const StarRating = ({ rating, onRate, interactive = false }: { rating: number; onRate?: (r: number) => void; interactive?: boolean }) => {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={!interactive}
          onClick={() => onRate?.(star)}
          className={`transition-all ${interactive ? "cursor-pointer hover:scale-110" : "cursor-default"}`}
        >
          <Star
            className={`h-4 w-4 ${
              star <= rating
                ? "text-amber-400 fill-amber-400"
                : "text-slate-600"
            }`}
          />
        </button>
      ))}
    </div>
  );
};

export default function BottomDrawer() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const selectedStationId = useStore((state) => state.selectedStationId);
  const setSelectedStationId = useStore((state) => state.setSelectedStationId);
  const mapBounds = useStore((state) => state.bounds);

  // Review form state
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [isListClosed, setIsListClosed] = useState(false);

  // Fetch Station Details when selectedStationId is present
  const { data: station, isLoading } = useQuery({
    queryKey: ["station", selectedStationId],
    queryFn: async () => {
      if (!selectedStationId) return null;
      const res = await fetch(`/api/stations/${selectedStationId}`);
      if (!res.ok) throw new Error("Failed to fetch station details");
      return res.json();
    },
    enabled: !!selectedStationId,
  });

  // Fetch user's favorites
  const { data: favoritesData } = useQuery({
    queryKey: ["favorites"],
    queryFn: async () => {
      const res = await fetch("/api/favorites");
      if (!res.ok) return { favoriteIds: [] };
      return res.json();
    },
    enabled: !!session,
  });

  const isFavorited = favoritesData?.favoriteIds?.includes(selectedStationId) || false;

  // Favorite toggle mutation
  const favoriteMutation = useMutation({
    mutationFn: async (stationId: string) => {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationId }),
      });
      if (!res.ok) throw new Error("Failed to toggle favorite");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["favorites"] });
    },
  });

  // Fetch reviews for the selected station
  const { data: reviewsData } = useQuery({
    queryKey: ["reviews", selectedStationId],
    queryFn: async () => {
      const res = await fetch(`/api/reviews?stationId=${selectedStationId}`);
      if (!res.ok) return { reviews: [], averageRating: 0, totalRatings: 0 };
      return res.json();
    },
    enabled: !!selectedStationId,
  });

  // Fetch reliability score for selected station
  const { data: reliabilityData } = useQuery({
    queryKey: ["reliability", selectedStationId],
    queryFn: async () => {
      if (!selectedStationId) return null;
      const res = await fetch(`/api/analytics/station/${selectedStationId}?quick=true`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedStationId,
  });

  // Submit review mutation
  const reviewMutation = useMutation({
    mutationFn: async (data: { stationId: string; rating: number; comment: string }) => {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to submit review");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reviews", selectedStationId] });
      setReviewRating(0);
      setReviewComment("");
      setShowReviewForm(false);
    },
  });

  // Fetch all stations in view for the general listing
  const { data: viewStations = [] } = useQuery({
    queryKey: ["stations-list", mapBounds],
    queryFn: async () => {
      if (!mapBounds) return [];
      const queryParams = new URLSearchParams({
        north: String(mapBounds.north),
        south: String(mapBounds.south),
        east: String(mapBounds.east),
        west: String(mapBounds.west),
      });
      const res = await fetch(`/api/stations?${queryParams.toString()}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !selectedStationId && !!mapBounds,
  });

  const handleNavigate = () => {
    if (!station) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${station.latitude},${station.longitude}`;
    window.open(url, "_blank");
  };

  const handleShare = () => {
    if (!station) return;
    if (navigator.share) {
      navigator.share({
        title: station.name,
        text: `Find ${station.name} EV charger on Full Charge`,
        url: window.location.href,
      }).catch(console.error);
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert("Link copied to clipboard!");
    }
  };

  const handleFavoriteClick = () => {
    if (!session) {
      signIn();
      return;
    }
    if (selectedStationId) {
      favoriteMutation.mutate(selectedStationId);
    }
  };

  const handleSubmitReview = () => {
    if (!session) {
      signIn();
      return;
    }
    if (selectedStationId && reviewRating > 0) {
      reviewMutation.mutate({
        stationId: selectedStationId,
        rating: reviewRating,
        comment: reviewComment,
      });
    }
  };

  return (
    <>
      <Drawer.Root 
        open={!!selectedStationId || (viewStations.length > 0 && !isListClosed)} 
        dismissible={true} 
        onOpenChange={(open) => {
          if (!open) {
            if (selectedStationId) {
              setSelectedStationId(null);
            } else {
              setIsListClosed(true);
            }
          }
        }}
        modal={false}
      >
        <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-slate-950/40 z-40 pointer-events-none transition-opacity duration-300" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 max-h-[85vh] flex flex-col bg-[#030712]/95 backdrop-blur-xl border-t border-slate-800/80 text-slate-100 rounded-t-[30px] focus:outline-none z-50 shadow-[0_-15px_40px_rgba(0,0,0,0.6)]">
          {/* Swipable Handle */}
          <div className="flex justify-center p-3.5 border-b border-slate-900/60 cursor-grab active:cursor-grabbing">
            <div className="w-12 h-1.5 rounded-full bg-slate-805" />
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 no-scrollbar">
            {selectedStationId ? (
              // ------------------- STATION DETAIL VIEW -------------------
              isLoading ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-9.5 w-9.5 border-b-2 border-emerald-450"></div>
                  <p className="mt-4 text-slate-400 text-xs font-semibold tracking-wide">Fetching Station Details...</p>
                </div>
              ) : station ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                  {/* Title & Operator */}
                  <div className="relative">
                    <button 
                      onClick={() => setSelectedStationId(null)}
                      className="absolute top-0 right-0 p-2 rounded-xl bg-slate-900/80 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:scale-105 active:scale-95 transition-all cursor-pointer shadow-md"
                    >
                      <X className="h-4.5 w-4.5" />
                    </button>
                    
                    <div className="flex items-center gap-2">
                      {(() => {
                        const isTata = station.source === "tata";
                        const isAther = station.source === "ather";
                        const isStatiq = station.source === "statiq";
                        const isCz = station.source === "chargezone";
                        const badgeClass = isTata 
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                          : isAther 
                          ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" 
                          : isStatiq 
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" 
                          : isCz 
                          ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" 
                          : "bg-slate-800 text-slate-400";
                        return (
                          <span className={`text-[9px] font-extrabold px-2.5 py-0.5 rounded-md uppercase tracking-wider ${badgeClass}`}>
                            {station.source}
                          </span>
                        );
                      })()}
                      <span className={`text-[9px] font-extrabold px-2.5 py-0.5 rounded-md uppercase tracking-wider ${getStatusBadgeClass(station.status)}`}>
                        {station.status}
                      </span>
                      {/* Average Rating */}
                      {reviewsData && reviewsData.totalRatings > 0 && (
                        <span className="flex items-center gap-1 text-xs font-bold text-amber-400 bg-amber-500/5 px-2 py-0.5 rounded-md border border-amber-500/10">
                          <Star className="h-3.5 w-3.5 fill-amber-400 stroke-amber-400" />
                          {reviewsData.averageRating}
                          <span className="text-slate-500 font-medium">({reviewsData.totalRatings})</span>
                        </span>
                      )}
                    </div>

                    <h2 className="mt-3.5 pr-12 text-xl font-black tracking-tight text-white leading-snug">{station.name}</h2>
                    <p className="text-slate-400 text-xs mt-1 font-semibold">Operated by {station.operator || "Independent"}</p>

                    {/* Reliability Badge */}
                    {reliabilityData && reliabilityData.totalSnapshots > 0 && (
                      <div className="mt-3 flex items-center gap-2">
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-extrabold uppercase tracking-wider border ${
                          reliabilityData.reliabilityScore >= 4.0
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : reliabilityData.reliabilityScore >= 2.5
                            ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                            : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                        }`}>
                          <Activity className="h-3 w-3" />
                          {reliabilityData.reliabilityScore >= 4.0
                            ? "Highly Reliable"
                            : reliabilityData.reliabilityScore >= 2.5
                            ? "Moderately Reliable"
                            : "Unreliable"}
                        </div>
                        <span className="text-[10px] font-bold text-slate-400">
                          {reliabilityData.uptimePercent}% uptime (7d)
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Actions (Navigate, Save, Share) */}
                  <div className="grid grid-cols-3 gap-3">
                    <button 
                      onClick={handleNavigate}
                      className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-450 hover:to-teal-450 hover:scale-[1.02] active:scale-98 text-slate-950 font-extrabold transition-all text-xs shadow-lg shadow-emerald-500/20 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] cursor-pointer"
                    >
                      <Navigation className="h-4.5 w-4.5 fill-slate-950 stroke-slate-950" />
                      Navigate
                    </button>
                    <button 
                      onClick={handleFavoriteClick}
                      disabled={favoriteMutation.isPending}
                      className={`flex items-center justify-center gap-2 py-3 rounded-2xl border hover:scale-[1.02] active:scale-98 transition-all text-xs font-bold cursor-pointer ${
                        isFavorited
                          ? "bg-rose-500/10 border-rose-500/30 text-rose-400 shadow-md shadow-rose-500/5"
                          : "bg-slate-900/50 border-slate-800 text-slate-300 hover:text-white hover:border-slate-700"
                      }`}
                    >
                      <Heart className={`h-4.5 w-4.5 ${isFavorited ? "fill-rose-400 stroke-rose-450" : ""}`} />
                      {isFavorited ? "Saved" : "Favorite"}
                    </button>
                    <button 
                      onClick={handleShare}
                      className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-slate-700 text-slate-350 hover:text-white transition-all text-xs font-bold cursor-pointer hover:scale-[1.02] active:scale-98"
                    >
                      <Share2 className="h-4.5 w-4.5" />
                      Share
                    </button>
                  </div>

                  {/* Address */}
                  <div className="flex gap-3 text-sm text-slate-300 bg-slate-900/30 p-4 rounded-2xl border border-slate-850/80">
                    <div className="p-1.5 bg-emerald-950/30 rounded-xl border border-emerald-500/20 shrink-0 h-fit">
                      <MapPin className="h-4.5 w-4.5 text-emerald-450" />
                    </div>
                    <div>
                      <p className="font-bold text-white text-xs">Location Address</p>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed font-medium">{station.address}</p>
                    </div>
                  </div>

                  {/* Connectors */}
                  <div>
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400 mb-3">Available Connectors</h3>
                    <div className="space-y-3">
                      {station.connectors?.map((conn: any) => (
                        <div 
                          key={conn.id} 
                          className="flex items-center justify-between p-4 rounded-2xl bg-slate-900/35 border border-slate-850 hover:border-slate-750 transition-all hover:-translate-y-0.5 duration-200"
                        >
                          <div className="flex items-center gap-3.5">
                            <div className="h-10 w-10 rounded-xl bg-slate-950 border border-emerald-500/20 flex flex-col items-center justify-center text-emerald-450 text-[10px] font-extrabold shadow-sm">
                              {conn.powerKw ? `${conn.powerKw}k` : "AC"}
                              <span className="text-[7px] text-slate-500 uppercase -mt-0.5">Power</span>
                            </div>
                            <div>
                              <p className="text-xs font-bold text-white leading-none">{getConnectorTypeLabel(conn.type)}</p>
                              <p className="text-[10px] text-slate-400 mt-1.5 font-medium leading-none">
                                {conn.currentType} • {conn.pricing ? `₹${conn.pricing}/kWh` : "Pricing details at station"}
                              </p>
                            </div>
                          </div>
                          <span className={`text-[9px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider ${
                            conn.status === "AVAILABLE" 
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          }`}>
                            {conn.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Amenities */}
                  {station.amenities?.length > 0 && (
                    <div>
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400 mb-3">Station Amenities</h3>
                      <div className="flex flex-wrap gap-2.5">
                        {station.amenities.map((am: string) => (
                          <AmenityIcon key={am} name={am} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Reviews Section */}
                  <div>
                    <div className="flex items-center justify-between mb-3.5">
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <MessageSquare className="h-4 w-4 text-emerald-405" />
                        User Reviews
                        {reviewsData && reviewsData.totalRatings > 0 && (
                          <span className="text-slate-500 font-medium">({reviewsData.totalRatings})</span>
                        )}
                      </h3>
                      <button
                        onClick={() => {
                          if (!session) { signIn(); return; }
                          setShowReviewForm(!showReviewForm);
                        }}
                        className="text-[10px] font-bold text-emerald-450 hover:text-emerald-300 transition-colors cursor-pointer"
                      >
                        {showReviewForm ? "Cancel" : "Add Review"}
                      </button>
                    </div>

                    {/* Review Form */}
                    {showReviewForm && (
                      <div className="p-5 rounded-2xl bg-slate-900/50 border border-slate-805/80 mb-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Your Rating</p>
                          <StarRating rating={reviewRating} onRate={setReviewRating} interactive />
                        </div>
                        <textarea
                          value={reviewComment}
                          onChange={(e) => setReviewComment(e.target.value)}
                          placeholder="Share your charging experience with the community..."
                          rows={2.5}
                          className="w-full px-3.5 py-3 rounded-xl bg-slate-950 border border-slate-850 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50 font-medium leading-relaxed"
                        />
                        <button
                          onClick={handleSubmitReview}
                          disabled={reviewRating === 0 || reviewMutation.isPending}
                          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer shadow-md shadow-emerald-500/5"
                        >
                          <Send className="h-3.5 w-3.5" />
                          {reviewMutation.isPending ? "Submitting..." : "Submit Review"}
                        </button>
                      </div>
                    )}

                    {/* Reviews List */}
                    {reviewsData?.reviews?.length > 0 ? (
                      <div className="space-y-3">
                        {reviewsData.reviews.slice(0, 5).map((review: any) => (
                          <div key={review.id} className="p-4 rounded-2xl bg-slate-900/25 border border-slate-850/60 shadow-sm">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2.5">
                                <div className="h-6 w-6 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center text-[9px] font-extrabold text-emerald-400 shadow-inner">
                                  {review.user?.name?.[0]?.toUpperCase() || "U"}
                                </div>
                                <span className="text-[10px] font-bold text-slate-350">{review.user?.name || "Anonymous"}</span>
                              </div>
                              <StarRating rating={review.rating} />
                            </div>
                            {review.comment && (
                              <p className="text-[10px] text-slate-400 leading-relaxed font-medium mt-1.5">{review.comment}</p>
                            )}
                            <p className="text-[9px] text-slate-500 mt-2 font-medium">{new Date(review.createdAt).toLocaleDateString()}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-slate-500 text-xs font-semibold">
                        No reviews yet. Be the first to review!
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 text-slate-400 text-sm font-semibold">Station details not found.</div>
              )
            ) : (
              // ------------------- VIEWPORT LISTINGS VIEW -------------------
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-extrabold text-white">Nearby Charging Stations ({viewStations.length})</h3>
                    <p className="text-[10px] text-slate-500 mt-1 font-semibold leading-none">Drag or zoom map to filter</p>
                  </div>
                  <button 
                    onClick={() => setIsListClosed(true)}
                    className="p-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-450 hover:text-slate-205 transition-colors cursor-pointer shadow-md"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                
                {viewStations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-xs space-y-3">
                    <div className="p-3 bg-slate-900/30 rounded-2xl border border-slate-850">
                      <Compass className="h-8 w-8 animate-pulse text-slate-605" />
                    </div>
                    <p className="font-semibold text-slate-500">No stations found in this area. Move map to explore.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {viewStations.slice(0, 10).map((st: any) => {
                      const isTata = st.source === "tata";
                      const isAther = st.source === "ather";
                      const isStatiq = st.source === "statiq";
                      const isCz = st.source === "chargezone";
                      const badgeClass = isTata 
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                        : isAther 
                        ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" 
                        : isStatiq 
                        ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" 
                        : isCz 
                        ? "bg-rose-500/10 text-rose-450 border border-rose-500/20" 
                        : "bg-slate-800 text-slate-400";

                      return (
                        <div 
                          key={st.id} 
                          onClick={() => setSelectedStationId(st.id)}
                          className="p-4 rounded-2xl bg-slate-900/30 border border-slate-850 hover:border-slate-700/60 hover:bg-slate-900/60 transition-all cursor-pointer flex items-center justify-between hover:-translate-y-0.5 duration-200"
                        >
                          <div className="space-y-1.5 pr-4 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-[8px] font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider ${badgeClass}`}>
                                {st.source}
                              </span>
                              <span className={`h-1.5 w-1.5 rounded-full ${
                                st.status === "AVAILABLE" 
                                  ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" 
                                  : (st.status === "OCCUPIED" ? "bg-amber-500" : "bg-slate-550")
                              }`} />
                            </div>
                            <h4 className="text-xs font-bold text-white truncate leading-snug">{st.name}</h4>
                            <p className="text-[10px] text-slate-450 truncate font-semibold">{st.address}</p>
                          </div>
                          <div className="shrink-0 flex flex-col items-end gap-1">
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-slate-950/60 text-slate-400 border border-slate-850 leading-none">
                              {st.connectors?.length || 0} plugs
                            </span>
                            <span className="text-[9px] font-extrabold text-emerald-450">
                              {st.connectors?.length > 0
                                ? `${Math.max(...st.connectors.map((c: any) => c.powerKw || 0))} kW`
                                : ""}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {viewStations.length > 10 && (
                      <p className="text-[9px] text-center text-slate-500 font-semibold pt-1 tracking-wider uppercase">And {viewStations.length - 10} more stations in this region</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>

    {/* Floating Toggle Button when list is closed */}
    {isListClosed && !selectedStationId && viewStations.length > 0 && (
      <button
        onClick={() => setIsListClosed(false)}
        className="absolute bottom-28 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-5 py-3 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-extrabold transition-all text-xs shadow-xl shadow-emerald-500/20 hover:scale-105 active:scale-95 cursor-pointer"
      >
        <Compass className="h-4.5 w-4.5" />
        Show Stations ({viewStations.length})
      </button>
    )}
  </>
  );
}
