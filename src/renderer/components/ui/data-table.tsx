import * as React from 'react';
import {
  type Column,
  type ColumnDef,
  type ColumnPinningState,
  type Row,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface RowAttributes {
  className?: string;
  /** Maps to data-state="selected"; drives the selected-row background. */
  selected?: boolean;
  onDoubleClick?: () => void;
  /** Forwarded to the row's data-testid. */
  testId?: string;
  /**
   * Translucent background tint painted on the row in its idle state. Both
   * pinned and non-pinned cells composite this on top of an opaque base, so
   * fixed columns track active/highlighted/etc. coloring exactly. CSS color
   * value (e.g. 'hsl(142 71% 45% / 0.04)'); leave undefined for no tint.
   */
  tint?: string;
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  /** Stable row id; defaults to tanstack's index-based id. */
  getRowId?: (row: TData) => string;
  /** Which columns stick to the left / right edges (antd-style fixed columns). */
  columnPinning?: ColumnPinningState;
  /** Per-row className / selected state / double-click handler. */
  rowProps?: (row: Row<TData>) => RowAttributes;
  /** Stable data-testid forwarded to every row. Equivalent to a constant `testId` in rowProps. */
  rowTestId?: string;
  /** Override class for every header cell — defaults to the standard padding/typography. */
  headCellClassName?: string;
  /** Override class for every body cell — defaults to the standard padding. */
  cellClassName?: string;
  /** Class for the `<table>` element — set a min-width here so pinning has room to scroll. */
  tableClassName?: string;
  /** Class for the bordered outer wrapper. */
  className?: string;
  /** Rendered in place of the body when there are no rows. */
  emptyState?: React.ReactNode;
  testId?: string;
  /**
   * Vertical scroll container (e.g. a page ScrollArea viewport). When provided
   * and measurable, body rows are virtualized with @tanstack/react-virtual so
   * only on-screen rows mount. Falls back to rendering every row when absent or
   * unmeasurable (so non-scrolling hosts and tests behave unchanged).
   */
  scrollRef?: React.RefObject<HTMLElement | null>;
  /** Fixed row height (px) used for virtualization estimates. */
  estimateRowHeight?: number;
}

const DEFAULT_HEAD_CELL = 'h-10 px-3 text-[12px] font-medium text-muted-foreground';
const DEFAULT_BODY_CELL = 'px-3 py-2.5';

/**
 * antd-style data table. Owns:
 *   - Horizontal scrolling with antd-style scroll-linked gradient shadows on
 *     the inner edge of the boundary fixed columns.
 *   - Sticky pinned columns built on @tanstack/react-table's column pinning.
 *   - Row coloring (idle tint, hover, selected) driven by a single CSS variable
 *     so pinned and non-pinned cells composite the *same* color, edge to edge.
 *
 * Consumers pass columns + data + (optional) columnPinning. Sensible defaults
 * cover header / cell padding, the bordered wrapper, and per-row test ids — no
 * styling boilerplate per page.
 */
export function DataTable<TData>({
  columns,
  data,
  getRowId,
  columnPinning,
  rowProps,
  rowTestId,
  headCellClassName = DEFAULT_HEAD_CELL,
  cellClassName = DEFAULT_BODY_CELL,
  tableClassName,
  className,
  emptyState,
  testId,
  scrollRef,
  estimateRowHeight = 48,
}: DataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getRowId,
    enableColumnPinning: true,
    getCoreRowModel: getCoreRowModel(),
    state: columnPinning ? { columnPinning } : undefined,
  });

  const hScrollRef = React.useRef<HTMLDivElement>(null);
  const [ping, setPing] = React.useState({ left: false, right: false });

  const syncPing = React.useCallback(() => {
    const el = hScrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft < maxScroll - 1;
    setPing((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  React.useEffect(() => {
    const el = hScrollRef.current;
    if (!el) return;
    syncPing();
    el.addEventListener('scroll', syncPing, { passive: true });
    const observer = new ResizeObserver(syncPing);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', syncPing);
      observer.disconnect();
    };
  }, [syncPing]);

  // Re-measure when the row/column shape changes (rows added/removed).
  React.useEffect(syncPing, [syncPing, data.length, columns.length]);

  const rows = table.getRowModel().rows;
  const hasRows = rows.length > 0;
  const leafColumnCount = table.getAllLeafColumns().length;

  // Optional row virtualization against an external vertical scroll container.
  // We measure the viewport height (→ whether to virtualize) and the body's
  // offset within the scroll content (→ react-virtual scrollMargin). When the
  // container is absent or unmeasurable (e.g. jsdom), we render every row.
  const bodyRef = React.useRef<HTMLTableSectionElement>(null);
  const [viewportHeight, setViewportHeight] = React.useState(0);
  const [rowScrollMargin, setRowScrollMargin] = React.useState(0);

  React.useLayoutEffect(() => {
    // 优先用外部滚动容器（页面 ScrollArea）；未提供时回退到表格自身的滚动容器
    // （antd 式：表格占满父高、内部纵向滚动、表头吸顶）。
    const scroller = scrollRef?.current ?? hScrollRef.current;
    if (!scroller) return;
    const measure = () => {
      setViewportHeight(scroller.clientHeight);
      const body = bodyRef.current;
      if (body) {
        const offset =
          body.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop;
        setRowScrollMargin(Math.max(0, offset));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollRef, rows.length]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef?.current ?? hScrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 10,
    scrollMargin: rowScrollMargin,
  });

  const virtualizeRows =
    Boolean(scrollRef?.current ?? hScrollRef.current) && viewportHeight > 0 && hasRows;

  const renderRow = (row: Row<TData>) => {
    const attrs = rowProps?.(row);
    const tid = attrs?.testId ?? rowTestId;
    // Idle row tint feeds --dt-row-tint, which both pinned and non-pinned cells
    // render. Hover/selected are layered via CSS so pinned and non-pinned stay
    // pixel-identical.
    const style = attrs?.tint
      ? ({ '--dt-row-tint': attrs.tint } as React.CSSProperties)
      : undefined;
    return (
      <TableRow
        key={row.id}
        data-testid={tid}
        data-state={attrs?.selected ? 'selected' : undefined}
        className={cn('group dt-row', attrs?.className)}
        style={style}
        onDoubleClick={attrs?.onDoubleClick}
      >
        {row.getVisibleCells().map((cell) => (
          <TableCell
            key={cell.id}
            className={cn(cellClassName, pinClasses(cell.column, false))}
            style={pinStyle(cell.column)}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        ))}
      </TableRow>
    );
  };

  const renderBody = () => {
    if (!hasRows) {
      return emptyState ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={leafColumnCount}>{emptyState}</TableCell>
        </TableRow>
      ) : null;
    }
    if (!virtualizeRows) return rows.map(renderRow);

    const items = rowVirtualizer.getVirtualItems();
    if (items.length === 0) return rows.map(renderRow);
    const totalSize = rowVirtualizer.getTotalSize();
    const paddingTop = items[0].start - rowScrollMargin;
    const paddingBottom = totalSize - (items[items.length - 1].end - rowScrollMargin);
    return (
      <>
        {paddingTop > 0 ? (
          <tr aria-hidden="true">
            <td colSpan={leafColumnCount} style={{ height: paddingTop, padding: 0, border: 0 }} />
          </tr>
        ) : null}
        {items.map((item) => renderRow(rows[item.index]))}
        {paddingBottom > 0 ? (
          <tr aria-hidden="true">
            <td
              colSpan={leafColumnCount}
              style={{ height: paddingBottom, padding: 0, border: 0 }}
            />
          </tr>
        ) : null}
      </>
    );
  };

  return (
    <div
      data-testid={testId}
      className={cn(
        // antd 式：占满父容器高度（父需给定高度，如 min-h-0 flex-1），纵横滚动都收在表格内部。
        'flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[10px] border border-border/80 bg-card',
        className,
      )}
    >
      <div
        ref={hScrollRef}
        data-ping-left={ping.left}
        data-ping-right={ping.right}
        className="data-table-scroll relative min-h-0 w-full flex-1 overflow-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
      >
        <table className={cn('w-full caption-bottom text-sm', tableClassName)}>
          <TableHeader className="dt-head-sticky sticky top-0 z-40 [&_tr]:border-b [&_tr]:border-border">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(headCellClassName, pinClasses(header.column, true))}
                    style={pinStyle(header.column)}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody ref={bodyRef}>{renderBody()}</TableBody>
        </table>
      </div>
    </div>
  );
}

function pinStyle<TData>(column: Column<TData, unknown>): React.CSSProperties {
  const pinned = column.getIsPinned();
  const size = column.getSize();
  return {
    width: size,
    minWidth: size,
    maxWidth: size,
    left: pinned === 'left' ? column.getStart('left') : undefined,
    right: pinned === 'right' ? column.getAfter('right') : undefined,
  };
}

function pinClasses<TData>(column: Column<TData, unknown>, isHeader: boolean): string {
  const pinned = column.getIsPinned();
  if (!pinned) return '';
  const isLastLeft = pinned === 'left' && column.getIsLastColumn('left');
  const isFirstRight = pinned === 'right' && column.getIsFirstColumn('right');
  return cn(
    'sticky',
    // Right-pinned wins over left-pinned where they could overlap.
    isHeader ? (pinned === 'right' ? 'z-40' : 'z-30') : pinned === 'right' ? 'z-30' : 'z-20',
    // Opaque-but-color-matched backgrounds: pinned cells composite the same
    // tint over an opaque card base, so they look identical to non-pinned
    // cells in idle / hover / selected.
    isHeader ? 'dt-head-pinned' : 'dt-cell-pinned',
    // Boundary cells host the scroll-linked gradient shadow (see index.css).
    isLastLeft && 'dt-pin-left-last',
    isFirstRight && 'dt-pin-right-first',
  );
}
