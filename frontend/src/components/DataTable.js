import React from 'react';
import { colors, borderRadius, spacing, typography, gradients } from '../theme';

export default function DataTable({ columns, data, loading }) {
  return (
    <div style={{
      background: colors.secondary,
      borderRadius: borderRadius.md,
      boxShadow: `0 2px 8px ${colors.shadow}`,
      overflow: 'auto',
      marginBottom: spacing.lg,
      minWidth: 320,
      maxWidth: '100%',
    }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        background: gradients.subtle,
      }}>
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                style={{
                  padding: spacing.md,
                  background: colors.background,
                  color: colors.textPrimary,
                  fontWeight: typography.fontWeightBold,
                  fontSize: typography.body.fontSize,
                  borderBottom: `2px solid ${colors.border}`,
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  textAlign: col.align || 'left',
                  cursor: col.sortable ? 'pointer' : 'default',
                }}
                aria-sort={col.sortable ? 'none' : undefined}
              >
                {col.label}
                {col.sortable && <span style={{ marginLeft: 4, fontSize: 14 }}>▼</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} style={{ textAlign: 'center', padding: spacing.lg }}>
                <div style={{ color: colors.textSecondary }}>Loading...</div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ textAlign: 'center', padding: spacing.lg }}>
                <div style={{ color: colors.textSecondary }}>
                  <img src="/empty-state.svg" alt="No data" style={{ width: 64, marginBottom: spacing.sm }} />
                  <div>No data available. Try adjusting your filters.</div>
                </div>
              </td>
            </tr>
          ) : (
            data.map((row, idx) => (
              <tr key={idx} style={{ background: idx % 2 === 0 ? colors.secondary : colors.background, transition: 'background 0.2s' }}>
                {columns.map(col => (
                  <td
                    key={col.key}
                    style={{
                      padding: spacing.md,
                      color: colors.textPrimary,
                      fontSize: typography.body.fontSize,
                      borderBottom: `1px solid ${colors.border}`,
                      textAlign: col.align || 'left',
                      minWidth: col.minWidth || 80,
                      maxWidth: col.maxWidth || 240,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
