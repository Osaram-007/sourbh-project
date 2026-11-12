import { ImageResponse } from "next/og";

// Placeholder lettermark (Q-C8). #0f7d38 = --color-brand. Static at build time.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", color: "#0f7d38", fontSize: 150, fontWeight: 700 }}>F</div>,
    size,
  );
}
