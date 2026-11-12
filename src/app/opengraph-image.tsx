import { ImageResponse } from "next/og";

// Placeholder wordmark + deck section 13 line (Q-C8). #0f7d38 = --color-brand. Static at build time.
export const alt = "FullCharge: Find an EV charger. See the details before you go.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#fff" }}>
      <div style={{ fontSize: 120, color: "#0f7d38" }}>FullCharge</div>
      <div style={{ fontSize: 40, marginTop: 24, color: "#1f2937" }}>Find an EV charger. See the details before you go.</div>
    </div>,
    size,
  );
}
