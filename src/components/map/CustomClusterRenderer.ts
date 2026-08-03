import { Cluster, ClusterStats, Renderer } from "@googlemaps/markerclusterer";

export class CustomClusterRenderer implements Renderer {
  render(cluster: Cluster, stats: ClusterStats, map: google.maps.Map): google.maps.Marker {
    const count = cluster.count;
    const position = cluster.position;

    // Dynamic sizing based on cluster magnitude
    const size = count >= 100 ? 54 : count >= 20 ? 46 : 40;
    const radius = size / 2;
    const strokeWidth = count >= 100 ? 3 : 2.5;

    // Color gradient coding: emerald green for smaller clusters, cyan for medium, amber/teal for massive clusters
    const strokeColor = count >= 100 ? "#06b6d4" : count >= 20 ? "#10b981" : "#10b981";
    const textColor = "#ffffff";
    const displayCount = count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);

    // Dark glassmorphism SVG icon payload
    const svg = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="glow-${count}" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        <!-- Outer Glow Ring -->
        <circle cx="${radius}" cy="${radius}" r="${radius - 3}" fill="#030712" fill-opacity="0.88" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-opacity="0.9" />
        <!-- Inner Core -->
        <circle cx="${radius}" cy="${radius}" r="${radius - 7}" fill="#0f172a" fill-opacity="0.95" />
        <!-- Cluster Count Text -->
        <text 
          x="${radius}" 
          y="${radius}" 
          font-family="system-ui, -apple-system, sans-serif" 
          font-size="${count >= 100 ? 12 : 13}" 
          font-weight="800" 
          fill="${textColor}" 
          text-anchor="middle" 
          dominant-baseline="central"
          letter-spacing="-0.5px"
        >${displayCount}</text>
      </svg>
    `;

    const svgUrl = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

    return new google.maps.Marker({
      position,
      icon: {
        url: svgUrl,
        scaledSize: new google.maps.Size(size, size),
        anchor: new google.maps.Point(radius, radius),
      },
      title: `${count} EV Charging Stations`,
      zIndex: Number(google.maps.Marker.MAX_ZINDEX) + count,
    });
  }
}
