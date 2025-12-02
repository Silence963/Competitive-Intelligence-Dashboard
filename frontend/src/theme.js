// COMPA Theme: Enterprise Reputation Management
// This file defines the color palette, spacing, typography, and dark mode support

export const colors = {
  primary: '#1a365d', // Deep professional blue
  secondary: '#ffffff',
  background: '#f7fafc',
  accent: '#38a169', // Success/CTA
  warning: '#d69e2e',
  danger: '#e53e3e',
  textPrimary: '#2d3748',
  textSecondary: '#4a5568',
  textTertiary: '#718096',
  border: '#e2e8f0',
  shadow: 'rgba(26,54,93,0.08)',
  glass: 'rgba(255,255,255,0.7)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const borderRadius = {
  sm: 4,
  md: 8,
};

export const typography = {
  fontFamily: 'Inter, Arial, sans-serif',
  fontSizeBase: 16,
  fontWeightBold: 700,
  fontWeightNormal: 400,
  heading: {
    fontSize: 24,
    fontWeight: 700,
  },
  subheading: {
    fontSize: 18,
    fontWeight: 600,
  },
  body: {
    fontSize: 16,
    fontWeight: 400,
  },
  caption: {
    fontSize: 12,
    fontWeight: 400,
  },
};

export const shadows = {
  card: `0 2px 8px ${colors.shadow}`,
  modal: `0 4px 24px ${colors.shadow}`,
};

export const gradients = {
  subtle: 'linear-gradient(90deg, #f7fafc 0%, #e2e8f0 100%)',
};

export const darkMode = {
  primary: '#0a192f',
  secondary: '#1a365d',
  background: '#2d3748',
  textPrimary: '#f7fafc',
  textSecondary: '#a0aec0',
  border: '#4a5568',
};

export const breakpoints = {
  mobile: 480,
  tablet: 768,
  desktop: 1024,
  largeDesktop: 1440,
};

// Usage: import { colors, spacing, borderRadius, typography, shadows, gradients, darkMode, breakpoints } from './theme';
