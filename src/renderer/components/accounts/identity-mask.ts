// 隐私模式工具：工具栏「隐藏邮箱」开关打开时，把卡片/表格上的邮箱打码
// （截图/录屏场景）。只处理含 @ 的邮箱；不含 @ 的不透明 id（auth0-user_…、
// codex_… 等）保持原样。

export function maskEmailText(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return value;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  return `${local.slice(0, 2)}***@${domain.slice(0, 2)}***`;
}
