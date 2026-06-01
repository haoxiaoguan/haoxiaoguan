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
}: DataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getRowId,
    enableColumnPinning: true,
    getCoreRowModel: getCoreRowModel(),
    state: columnPinning ? { columnPinning } : undefined,
  });

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [ping, setPing] = React.useState({ left: false, right: false });

  const syncPing = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft < maxScroll - 1;
    setPing((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  React.useEffect(() => {
    const el = scrollRef.current;
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

  return (
    <div
      data-testid={testId}
      className={cn(
        'min-w-0 overflow-hidden rounded-[10px] border border-border/80 bg-card',
        className,
      )}
    >
      <div
        ref={scrollRef}
        data-ping-left={ping.left}
        data-ping-right={ping.right}
        className="data-table-scroll relative w-full overflow-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
      >
        <table className={cn('w-full caption-bottom text-sm', tableClassName)}>
          <TableHeader className="bg-muted/25">
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
          <TableBody>
            {hasRows
              ? rows.map((row) => {
                  const attrs = rowProps?.(row);
                  const tid = attrs?.testId ?? rowTestId;
                  // Idle row tint feeds --dt-row-tint, which both pinned and
                  // non-pinned cells render. Hover/selected are layered via
                  // CSS so pinned and non-pinned stay pixel-identical.
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
                })
              : emptyState
                ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={table.getAllLeafColumns().length}>
                        {emptyState}
                      </TableCell>
                    </TableRow>
                  )
                : null}
          </TableBody>
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
