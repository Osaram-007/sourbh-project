import { ImageResponse } from "next/og";

// Placeholder lettermark (Q-C8). #0f7d38 = --color-brand. Static at build time.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", color: "#0f7d38", fontSize: 28 }}>F</div>,
    size,
  );
}
