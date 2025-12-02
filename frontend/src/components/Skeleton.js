import React from 'react';
import { colors, borderRadius, spacing, typography, shadows } from '../theme';

export function Skeleton({ width = '100%', height = 24, style = {} }) {
  return (
    <div
      style={{
        width,
        height,
        background: `linear-gradient(90deg, ${colors.background} 25%, ${colors.border} 50%, ${colors.background} 75%)`,
        borderRadius: borderRadius.sm,
        animation: 'compa-skeleton-shimmer 1.5s infinite',
        ...style,
      }}
      aria-busy="true"
      aria-label="Loading..."
    >
      <style>{`
        @keyframes compa-skeleton-shimmer {
          0% { background-position: -200px 0; }
          100% { background-position: 200px 0; }
        }
      `}</style>
    </div>
  );
}
