// Kiro 会员档位排序：数值越大档位越高（价格越贵）。
// 取数账号用「会员最高者」的 ListAvailableModels 作为权威清单（高档位通常解锁更多模型）。
// 仅按 planName/planTier 文本启发式判定；无套餐信息 → 0（最低）。纯函数。

/**
 * 排序值（高→低）：
 *   5 power/max/ultra/enterprise（顶级）
 *   4 pro+ / pro plus / pro_plus（Pro+）
 *   3 pro（Pro）
 *   2 已识别到套餐文本但非以上（未知付费档，保守置于 free 之上）
 *   1 free / trial
 *   0 无任何套餐信息
 */
export function kiroPlanRank(planName?: string, planTier?: string): number {
  const s = `${planName ?? ''} ${planTier ?? ''}`.toLowerCase().trim()
  if (s.length === 0) return 0
  if (/power|max|ultra|enterprise/.test(s)) return 5
  if (/pro\s*\+|pro[\s_-]*plus/.test(s)) return 4
  if (/\bpro\b|_pro\b|pro_|standalone[_\s]*pro/.test(s)) return 3
  if (/free|trial/.test(s)) return 1
  return 2
}
