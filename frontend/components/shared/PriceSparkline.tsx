"use client";

import { useMemo, useState } from "react";

type PricePoint = {
  timestamp: number;
  price: number;
};

type Props = {
  data?: PricePoint[];
};

export default function PriceSparkline({ data }: Props) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const displayData = useMemo(() => data ?? [], [data]);

  // ✅ Limit points for performance
  const sliced = useMemo(() => displayData.slice(-50), [displayData]);

  const { points, normalized } = useMemo(() => {
    if (sliced.length === 0) {
      return { points: "", normalized: [] as Array<PricePoint & { x: number; y: number }> };
    }

    const max = Math.max(...sliced.map((d) => d.price));
    const min = Math.min(...sliced.map((d) => d.price));

    const normalized = sliced.map((d, i) => {
      const x = (i / (sliced.length - 1)) * 100;
      const y =
        max === min
          ? 50
          : 100 - ((d.price - min) / (max - min)) * 100;

      return { x, y, ...d };
    });

    const points = normalized.map(p => `${p.x},${p.y}`).join(" ");

    return { points, normalized };
  }, [sliced]);

  if (sliced.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No price data (24h)
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="w-full h-16 relative">
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = x / rect.width;

            const index = Math.min(
              normalized.length - 1,
              Math.max(0, Math.round(percent * (normalized.length - 1)))
            );

            setHoveredIndex(index);
          }}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            points={points}
          />

          {/* Optional hover dot */}
          {hoveredIndex !== null && normalized[hoveredIndex] && (
            <circle
              cx={normalized[hoveredIndex].x}
              cy={normalized[hoveredIndex].y}
              r="2"
              fill="currentColor"
            />
          )}
        </svg>
      </div>

      {/* ✅ Tooltip */}
      {hoveredIndex !== null && normalized[hoveredIndex] && (
        <div className="text-xs mt-1 text-muted-foreground tabular-nums">
          {new Date(normalized[hoveredIndex].timestamp).toLocaleTimeString()} —{" "}
          {normalized[hoveredIndex].price.toFixed(2)}
        </div>
      )}
    </div>
  );
}