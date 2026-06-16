import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import AccountCard from './AccountCard'
import type { Account, AgentId } from '../../types'

interface AccountCardGridProps {
  accounts: Account[]
  /** Vertical scroll container (the page's ScrollArea viewport). */
  scrollRef: React.RefObject<HTMLElement | null>
  getDisplayName: (platform: AgentId) => string
  selectedIds: Set<string>
  highlightedId: string | null
  switchingId: string | null
  hideEmail?: boolean
  poolable?: boolean
  pooledIds?: Set<string>
  onToggleSelect: (account: Account) => void
  onSwitch: (account: Account) => void
  onDelete: (account: Account) => void
  onOpen: (account: Account) => void
  onEdit: (account: Account) => void
  onExport: (account: Account) => void
  onTogglePool: (account: Account, pooled: boolean) => void
}

// Matches the `.accounts-card-grid` CSS contract (--accounts-card-min /
// --accounts-card-gap) so the JS-computed column count lines up with what the
// auto-fill grid would have produced for the same width.
const CARD_MIN_PX = 360 // 22.5rem
const CARD_GAP_PX = 12 // 0.75rem
const ROW_ESTIMATE_PX = 236 // card min-height (224) + gap

function columnsForWidth(width: number): number {
  if (width <= 0) return 1
  return Math.max(1, Math.floor((width + CARD_GAP_PX) / (CARD_MIN_PX + CARD_GAP_PX)))
}

/**
 * Card view for the accounts page. Renders one `AccountCard` per account but
 * windows them with @tanstack/react-virtual so only the on-screen rows are
 * mounted — keeping the page smooth from hundreds to thousands of accounts.
 *
 * Falls back to a plain CSS `accounts-card-grid` (every card rendered) whenever
 * the scroll viewport can't be measured (e.g. jsdom / before first layout), so
 * behaviour and tests stay correct without a measurable container.
 */
export function AccountCardGrid(props: AccountCardGridProps) {
  const {
    accounts,
    scrollRef,
    getDisplayName,
    selectedIds,
    highlightedId,
    switchingId,
    hideEmail,
    poolable,
    pooledIds,
  } = props

  const regionRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [scrollMargin, setScrollMargin] = useState(0)

  // Track the region width (→ column count) and the scroll viewport height
  // (→ whether we can virtualize at all) plus the region's offset inside the
  // scroll content (→ react-virtual scrollMargin).
  useLayoutEffect(() => {
    const region = regionRef.current
    const scroller = scrollRef.current
    if (!region) return

    const measure = () => {
      setWidth(region.clientWidth)
      if (scroller) {
        setViewportHeight(scroller.clientHeight)
        const offset =
          region.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop
        setScrollMargin(Math.max(0, offset))
      }
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(region)
    if (scroller) observer.observe(scroller)
    return () => observer.disconnect()
  }, [scrollRef])

  const columns = columnsForWidth(width)
  const rowCount = Math.ceil(accounts.length / columns)
  const canVirtualize = viewportHeight > 0 && width > 0 && accounts.length > 0

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 3,
    scrollMargin,
  })

  // Re-measure rows when the column count changes (row composition changes).
  useEffect(() => {
    rowVirtualizer.measure()
  }, [columns, rowVirtualizer])

  const renderCard = useCallback(
    (account: Account) => (
      <AccountCard
        key={account.id}
        account={account}
        platformDisplayName={getDisplayName(account.platform)}
        selected={selectedIds.has(account.id)}
        active={account.isActive}
        highlighted={highlightedId === account.id}
        switching={switchingId === account.id}
        onToggleSelect={props.onToggleSelect}
        onSwitch={props.onSwitch}
        onDelete={props.onDelete}
        onOpen={props.onOpen}
        onEdit={props.onEdit}
        onExport={props.onExport}
        hideEmail={hideEmail}
        poolable={poolable}
        pooled={poolable ? (pooledIds?.has(account.id) ?? false) : undefined}
        onTogglePool={props.onTogglePool}
      />
    ),
    [
      getDisplayName,
      selectedIds,
      highlightedId,
      switchingId,
      hideEmail,
      poolable,
      pooledIds,
      props.onToggleSelect,
      props.onSwitch,
      props.onDelete,
      props.onOpen,
      props.onEdit,
      props.onExport,
      props.onTogglePool,
    ],
  )

  if (!canVirtualize) {
    return (
      <div ref={regionRef} className="accounts-card-region min-w-0">
        <div className="accounts-card-grid">{accounts.map(renderCard)}</div>
      </div>
    )
  }

  const virtualRows = rowVirtualizer.getVirtualItems()

  return (
    <div ref={regionRef} className="accounts-card-region min-w-0">
      <div style={{ position: 'relative', width: '100%', height: rowVirtualizer.getTotalSize() }}>
        {virtualRows.map((virtualRow) => {
          const start = virtualRow.index * columns
          const rowAccounts = accounts.slice(start, start + columns)
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: `${CARD_GAP_PX}px`,
                paddingBottom: `${CARD_GAP_PX}px`,
              }}
            >
              {rowAccounts.map(renderCard)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default AccountCardGrid
