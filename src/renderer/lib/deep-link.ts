/**
 * deep-link 解析工具 —— 把 haoxiaoguan://import/{provider}?... 拆成 { provider, url }。
 */

const SCHEME = 'haoxiaoguan://';

export interface ParsedDeepLink {
  provider: string;
  url: string;
}

export function parseImportDeepLink(raw: string): ParsedDeepLink | null {
  if (!raw.startsWith(SCHEME)) return null;
  const path = raw.slice(SCHEME.length);
  // 期望：import/<provider>[?<query>]
  const match = path.match(/^import\/([^?#]+)/);
  if (!match) return null;
  const provider = match[1];
  return { provider, url: raw };
}
