// activity-scan-state.entity.ts
import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'activity_scan_state' })
export class ActivityScanStateEntity {
  @PrimaryKey({ type: 'text' })
  id!: string // 恒为 'default'

  /** 上次扫描见到的最大文件 mtime（毫秒） */
  @Property({ type: 'bigint', fieldName: 'last_scan_at' })
  lastScanAt!: number
}
