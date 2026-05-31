/**
 * 主题主色（accent / primary）管理。
 *
 * 通过覆盖 CSS 变量 `--primary` / `--ring` 实现全局主色自定义。
 * 持久化到 localStorage（与 next-themes 同策略，启动时无闪烁，后端零改动）。
 *
 * CSS 变量采用 HSL 三元组格式 "H S% L%"（见 styles/index.css），
 * 因此这里统一以 HSL 字符串为内部表示。
 */

const STORAGE_KEY = 'accent-color';

/** 预设主色板：value 为 HSL 三元组字符串，hex 仅用于色板展示。 */
export interface AccentPreset {
  id: string;
  labelKey: string;
  /** HSL 三元组，例如 "217 91% 60%" */
  hsl: string;
  /** 展示用 HEX */
  hex: string;
}

export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { id: 'blue', labelKey: 'settings.accent.blue', hsl: '217 91% 60%', hex: '#3b82f6' },
  { id: 'violet', labelKey: 'settings.accent.violet', hsl: '262 83% 58%', hex: '#7c3aed' },
  { id: 'green', labelKey: 'settings.accent.green', hsl: '142 71% 45%', hex: '#22c55e' },
  { id: 'orange', labelKey: 'settings.accent.orange', hsl: '25 95% 53%', hex: '#f97316' },
  { id: 'rose', labelKey: 'settings.accent.rose', hsl: '347 77% 50%', hex: '#e11d48' },
  { id: 'cyan', labelKey: 'settings.accent.cyan', hsl: '189 94% 43%', hex: '#06b6d4' },
] as const;

/** 默认主色（与 styles/index.css 中 --primary 初始值一致）。 */
export const DEFAULT_ACCENT_HSL = '217 91% 60%';

/** 将 #RRGGBB / #RGB 转为 HSL 三元组字符串 "H S% L%"。非法输入返回 null。 */
export function hexToHsl(hex: string): string | null {
  const normalized = hex.trim().replace(/^#/, '');
  let r: number;
  let g: number;
  let b: number;

  if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
    r = parseInt(normalized[0] + normalized[0], 16);
    g = parseInt(normalized[1] + normalized[1], 16);
    b = parseInt(normalized[2] + normalized[2], 16);
  } else if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    r = parseInt(normalized.slice(0, 2), 16);
    g = parseInt(normalized.slice(2, 4), 16);
    b = parseInt(normalized.slice(4, 6), 16);
  } else {
    return null;
  }

  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rf) h = ((gf - bf) / delta) % 6;
    else if (max === gf) h = (bf - rf) / delta + 2;
    else h = (rf - gf) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return `${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** 将 HSL 三元组字符串 "H S% L%" 转为 #RRGGBB（供取色器回显）。 */
export function hslToHex(hsl: string): string {
  const match = hsl.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!match) return '#3b82f6';
  const h = parseFloat(match[1]);
  const s = parseFloat(match[2]) / 100;
  const l = parseFloat(match[3]) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let rf = 0;
  let gf = 0;
  let bf = 0;
  if (h < 60) [rf, gf, bf] = [c, x, 0];
  else if (h < 120) [rf, gf, bf] = [x, c, 0];
  else if (h < 180) [rf, gf, bf] = [0, c, x];
  else if (h < 240) [rf, gf, bf] = [0, x, c];
  else if (h < 300) [rf, gf, bf] = [x, 0, c];
  else [rf, gf, bf] = [c, 0, x];

  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(rf)}${toHex(gf)}${toHex(bf)}`;
}

/** 将主色 HSL 注入到文档根节点的 CSS 变量。 */
export function applyAccentColor(hsl: string): void {
  const root = document.documentElement;
  root.style.setProperty('--primary', hsl);
  root.style.setProperty('--ring', hsl);
}

/** 读取已持久化的主色，未设置则返回默认值。 */
export function getStoredAccentColor(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_ACCENT_HSL;
  } catch {
    return DEFAULT_ACCENT_HSL;
  }
}

/** 持久化并即时应用主色。 */
export function setAccentColor(hsl: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, hsl);
  } catch {
    // localStorage 不可用时仅内存生效
  }
  applyAccentColor(hsl);
}

/** 启动时调用：从存储恢复主色（无存储则保持 CSS 默认值，不写 style）。 */
export function initAccentColor(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) applyAccentColor(stored);
  } catch {
    // 忽略
  }
}
