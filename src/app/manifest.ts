import type { MetadataRoute } from "next";

// Placeholder colours = --color-brand / --color-surface in globals.css (Q-C8: swap with the final hex).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FullCharge",
    short_name: "FullCharge",
    start_url: "/app",
    display: "standalone",
    theme_color: "#0f7d38",
    background_color: "#ffffff",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
