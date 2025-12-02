import React from 'react';
import { colors, borderRadius, shadows, spacing, typography } from '../theme';

export default function Modal({ open, onClose, title, children, actions }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(26,54,93,0.32)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      tabIndex={-1}
      aria-modal="true"
      role="dialog"
      onClick={onClose}
    >
      <div
        style={{
          background: colors.glass,
          backdropFilter: 'blur(12px)',
          borderRadius: borderRadius.md,
          boxShadow: shadows.modal,
          minWidth: 360,
          maxWidth: 520,
          padding: spacing.lg,
          position: 'relative',
          outline: 'none',
        }}
        onClick={e => e.stopPropagation()}
        tabIndex={0}
      >
        <h2 style={{ ...typography.heading, color: colors.textPrimary, marginBottom: spacing.md }}>{title}</h2>
        <div style={{ marginBottom: spacing.md }}>{children}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.sm }}>
          {actions}
        </div>
      </div>
    </div>
  );
}
