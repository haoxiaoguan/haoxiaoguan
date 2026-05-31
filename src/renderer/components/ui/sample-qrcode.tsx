import { useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * 示例二维码（占位用）。
 *
 * 不引入二维码生成库，用确定性算法绘制一个「看起来像二维码」的 SVG 图案：
 * 三个定位角 + 由 seed 决定的伪随机填充网格。仅作占位展示，
 * 后续替换为真实二维码图片即可。
 */
interface SampleQRCodeProps {
  /** 用于生成确定性图案的种子（不同 seed 图案不同）。 */
  seed?: string;
  size?: number;
  className?: string;
}

const GRID = 21; // 经典 QR 版本 1 的模块数

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 是否属于三个定位角（7x7）的区域。 */
function isFinderArea(r: number, c: number): boolean {
  const inCorner = (br: number, bc: number) => r >= br && r < br + 7 && c >= bc && c < bc + 7;
  return inCorner(0, 0) || inCorner(0, GRID - 7) || inCorner(GRID - 7, 0);
}

/** 定位角的实心模块（外框 + 中心 3x3）。 */
function isFinderFilled(r: number, c: number): boolean {
  const corners = [
    [0, 0],
    [0, GRID - 7],
    [GRID - 7, 0],
  ];
  for (const [br, bc] of corners) {
    const lr = r - br;
    const lc = c - bc;
    if (lr < 0 || lr > 6 || lc < 0 || lc > 6) continue;
    const onBorder = lr === 0 || lr === 6 || lc === 0 || lc === 6;
    const inCenter = lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4;
    return onBorder || inCenter;
  }
  return false;
}

export function SampleQRCode({ seed = 'haoxiaoguan', size = 120, className }: SampleQRCodeProps) {
  const cells = useMemo(() => {
    const base = hashSeed(seed);
    const result: boolean[] = [];
    for (let r = 0; r < GRID; r += 1) {
      for (let c = 0; c < GRID; c += 1) {
        if (isFinderArea(r, c)) {
          result.push(isFinderFilled(r, c));
          continue;
        }
        // 确定性伪随机：按坐标与 seed 混合。
        const v = Math.imul(base ^ (r * 73856093) ^ (c * 19349663), 2654435761) >>> 0;
        result.push((v & 7) < 3);
      }
    }
    return result;
  }, [seed]);

  const cell = size / GRID;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('rounded-md bg-white', className)}
      role="img"
      aria-label="QR code placeholder"
    >
      {cells.map((filled, i) =>
        filled ? (
          <rect
            key={i}
            x={(i % GRID) * cell}
            y={Math.floor(i / GRID) * cell}
            width={cell}
            height={cell}
            fill="#0a0a0a"
          />
        ) : null,
      )}
    </svg>
  );
}
