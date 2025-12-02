import React from 'react';
import { colors, borderRadius, typography, spacing } from '../theme';

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

export default function StatusBadge({ status = 'pending' }) {
  return (
    <span
      style={{
        display: 'inline-block',
        minWidth: 80,
        height: 24,
        padding: '0 12px',
        borderRadius: borderRadius.sm,
        background: statusColors[status] || colors.primary,
        color: colors.secondary,
        fontWeight: typography.fontWeightBold,
        fontSize: typography.caption.fontSize,
        lineHeight: '24px',
        textAlign: 'center',
        marginRight: spacing.sm,
        boxShadow: `0 1px 4px ${colors.shadow}`,
        letterSpacing: 0.5,
      }}
      aria-label={`Status: ${statusLabels[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
}
