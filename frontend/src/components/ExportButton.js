import React from 'react';
import { colors, borderRadius, spacing, typography } from '../theme';

export default function ExportButton({ onClick, loading, label = 'Export', icon }) {
  return (
    <button
      style={{
        background: colors.primary,
        color: colors.secondary,
        border: 'none',
        borderRadius: borderRadius.md,
        padding: `${spacing.sm}px ${spacing.lg}px`,
        fontWeight: typography.fontWeightBold,
        fontSize: typography.body.fontSize,
        boxShadow: `0 2px 8px ${colors.shadow}`,
        cursor: loading ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: spacing.sm,
        position: 'relative',
        minWidth: 120,
        transition: 'background 0.2s',
        outline: 'none',
      }}
      disabled={loading}
      aria-busy={loading}
      aria-label={label}
      onClick={onClick}
    >
      {icon && <span style={{ fontSize: 20 }}>{icon}</span>}
      {label}
      {loading && (
        <span style={{ position: 'absolute', right: spacing.sm, top: '50%', transform: 'translateY(-50%)' }}>
          <svg width="20" height="20" viewBox="0 0 50 50">
            <circle cx="25" cy="25" r="20" fill="none" stroke={colors.secondary} strokeWidth="4" strokeDasharray="31.4 31.4" strokeDashoffset="0">
              <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite" />
            </circle>
          </svg>
        </span>
      )}
    </button>
  );
}
