import React from 'react';
import { colors, spacing, typography } from '../theme';

export function EmptyState({ title = 'No Data', description = 'Try adjusting your filters or add new items.', illustration = '/empty-state.svg', action }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
      color: colors.textSecondary,
      minHeight: 180,
    }}>
      <img src={illustration} alt="Empty" style={{ width: 80, marginBottom: spacing.md }} />
      <h3 style={{ ...typography.heading, color: colors.textPrimary, marginBottom: spacing.sm }}>{title}</h3>
      <div style={{ marginBottom: spacing.md }}>{description}</div>
      {action && <div>{action}</div>}
    </div>
  );
}
