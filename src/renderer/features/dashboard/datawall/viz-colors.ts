/**
 * Shared data-visualization color constants.
 * These values work in both light and dark themes.
 */
export const VIZ = {
  blue:   '#2563eb',
  violet: '#8b5cf6',
  green:  '#22c55e',
  amber:  '#f59e0b',
  gray:   '#94a3b8',
  red:    '#ef4444',
} as const

export type VizColor = keyof typeof VIZ
