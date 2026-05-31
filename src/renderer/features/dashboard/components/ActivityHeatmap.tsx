import { cn } from '@/lib/utils';

interface ActivityHeatmapProps {
  /** Daily counts, oldest first. Length should be 7 * 26 = 182 (≈half year) for AiMaMi-like density. */
  values: number[];
  /** Localised "Less" label */
  lessLabel: string;
  /** Localised "More" label */
  moreLabel: string;
  className?: string;
}

const LEVELS = 5;

function bucketize(values: number[]): number[] {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  if (max === 0) return values.map(() => 0);
  return values.map((v) => {
    if (v === 0) return 0;
    const ratio = v / max;
    return Math.min(LEVELS - 1, Math.max(1, Math.ceil(ratio * (LEVELS - 1))));
  });
}

const LEVEL_BG = [
  'bg-muted/50',
  'bg-emerald-500/25',
  'bg-emerald-500/45',
  'bg-emerald-500/65',
  'bg-emerald-500/90',
];

/**
 * GitHub-style activity heatmap — 7 rows (weekdays) × N columns (weeks).
 *
 * Visual reference: AiMaMi "Codex 活跃趋势" panel.
 * No external dep — pure flex grid of 10×10px cells with rounded corners.
 */
export function ActivityHeatmap({ values, lessLabel, moreLabel, className }: ActivityHeatmapProps) {
  const buckets = bucketize(values);
  // Group by week (column-major). Pad to multiple of 7.
  const padded = [...buckets];
  while (padded.length % 7 !== 0) padded.push(0);
  const weeks: number[][] = [];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7));
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-end gap-[3px] overflow-x-auto pb-1">
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="flex flex-col gap-[3px]">
            {week.map((level, dayIndex) => (
              <span
                key={`${weekIndex}-${dayIndex}`}
                aria-hidden
                className={cn(
                  'h-[10px] w-[10px] rounded-[2px]',
                  LEVEL_BG[Math.min(level, LEVELS - 1)],
                )}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
        <span>{lessLabel}</span>
        {Array.from({ length: LEVELS }).map((_, i) => (
          <span
            key={i}
            aria-hidden
            className={cn('h-[10px] w-[10px] rounded-[2px]', LEVEL_BG[i])}
          />
        ))}
        <span>{moreLabel}</span>
      </div>
    </div>
  );
}
