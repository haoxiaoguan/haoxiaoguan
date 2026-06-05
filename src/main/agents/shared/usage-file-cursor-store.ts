/**
 * Per-file 增量游标存储（对齐 cc-switch session_log_sync 的 mtime 增量）。
 *
 * 语义：reader 在扫描前 load() 取「已记录的 文件→上次 mtime(ms)」，mtime 未变的文件
 * 直接跳过（其记录已在 usage_records 里）。本轮处理过的文件，由同步服务在 upsert
 * 成功后才 save()——「先落库再推进游标」，避免 upsert 失败却已跳过导致数据缺失。
 */
export interface ProcessedFileCursor {
  sourcePath: string
  /** 文件 mtime，毫秒（整数）。 */
  mtimeMs: number
}

export interface UsageFileCursorStore {
  /** 返回该 reader 已记录的 source_path → 上次见到的 mtime(ms)。 */
  load(readerName: string): Promise<Map<string, number>>
  /** 持久化本轮已成功入库的文件游标。 */
  save(readerName: string, entries: ProcessedFileCursor[]): Promise<void>
}
