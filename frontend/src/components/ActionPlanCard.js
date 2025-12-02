import React from 'react';
import { colors, spacing, borderRadius, shadows, typography } from '../theme';

// Status badge color mapping
const statusColors = {
  done: colors.accent,
  'in-progress': colors.warning,
  pending: colors.primary,
  skipped: colors.danger,
};

const statusLabels = {
  done: 'Done',
  'in-progress': 'In Progress',
  pending: 'Pending',
  skipped: 'Skipped',
};

export default function ActionPlanCard({ title, content, status = 'pending', progress = 0, icon }) {
  return (
    <div
      style={{
        background: colors.glass,
        backdropFilter: 'blur(12px)',
        borderRadius: borderRadius.md,
        boxShadow: shadows.card,
        border: `1px solid ${colors.border}`,
        padding: spacing.lg,
        marginBottom: spacing.md,
        minWidth: 320,
        maxWidth: 480,
        position: 'relative',
        transition: 'box-shadow 0.2s',
      }}
      tabIndex={0}
      aria-label={`Action Plan Card: ${title}`}
    >
      {/* Icon */}
      {icon && (
        <span style={{ position: 'absolute', top: spacing.md, right: spacing.md, fontSize: 28, color: colors.primary }}>
          {icon}
        </span>
      )}
      {/* Title */}
      <h3 style={{ ...typography.heading, color: colors.textPrimary, marginBottom: spacing.sm }}>{title}</h3>
      {/* Status Badge */}
      <span
        style={{
          display: 'inline-block',
          padding: '4px 12px',
          borderRadius: borderRadius.sm,
          background: statusColors[status] || colors.primary,
          color: colors.secondary,
          fontWeight: typography.fontWeightBold,
          fontSize: typography.caption.fontSize,
          marginBottom: spacing.sm,
        }}
        aria-label={`Status: ${statusLabels[status]}`}
      >
        {statusLabels[status]}
      </span>
      {/* Content */}
      <div style={{ color: colors.textSecondary, marginBottom: spacing.md, fontSize: typography.body.fontSize }}>
        {content}
      </div>
      {/* Progress Bar */}
      <div style={{ height: 8, background: colors.border, borderRadius: 4, overflow: 'hidden', marginBottom: spacing.sm }}>
        <div
          style={{
            width: `${progress}%`,
            height: '100%',
            background: colors.accent,
            transition: 'width 0.3s',
          }}
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
