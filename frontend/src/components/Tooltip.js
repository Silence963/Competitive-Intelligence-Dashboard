import React from 'react';
import { colors, borderRadius, spacing, typography, shadows } from '../theme';

export function Tooltip({ children, text }) {
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      {children}
      <span
        style={{
          visibility: 'hidden',
          opacity: 0,
          position: 'absolute',
          left: '50%',
          bottom: '120%',
          transform: 'translateX(-50%)',
          background: colors.textPrimary,
          color: colors.secondary,
          padding: `${spacing.xs}px ${spacing.sm}px`,
          borderRadius: borderRadius.sm,
          boxShadow: shadows.card,
          fontSize: typography.caption.fontSize,
          whiteSpace: 'nowrap',
          zIndex: 10,
          transition: 'opacity 0.2s',
        }}
        className="compa-tooltip"
        role="tooltip"
      >
        {text}
      </span>
      <style>{`
        .compa-tooltip:hover + .compa-tooltip,
        .compa-tooltip:focus + .compa-tooltip {
          visibility: visible;
          opacity: 1;
        }
      `}</style>
    </span>
  );
}
