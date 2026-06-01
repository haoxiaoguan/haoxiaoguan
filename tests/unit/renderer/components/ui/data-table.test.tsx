import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ColumnDef, ColumnPinningState } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';

interface Row {
  id: string;
  name: string;
  value: string;
  action: string;
}

const columns: ColumnDef<Row>[] = [
  { id: 'name', size: 120, header: () => 'Name', cell: ({ row }) => row.original.name },
  { id: 'value', size: 200, header: () => 'Value', cell: ({ row }) => row.original.value },
  { id: 'action', size: 80, header: () => 'Action', cell: ({ row }) => row.original.action },
];

const data: Row[] = [
  { id: 'a', name: 'Alice', value: 'v1', action: 'edit' },
  { id: 'b', name: 'Bob', value: 'v2', action: 'edit' },
];

const PINNING: ColumnPinningState = { left: ['name'], right: ['action'] };

describe('DataTable', () => {
  it('renders headers and rows', () => {
    render(<DataTable testId="t" columns={columns} data={data} getRowId={(r) => r.id} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('exposes ping data attributes on the scroll container for the shadow gate', () => {
    const { container } = render(
      <DataTable testId="t" columns={columns} data={data} getRowId={(r) => r.id} columnPinning={PINNING} />,
    );
    const scroll = container.querySelector('.data-table-scroll');
    expect(scroll).toHaveAttribute('data-ping-left', 'false');
    expect(scroll).toHaveAttribute('data-ping-right', 'false');
  });

  it('marks the boundary pinned cells with the gradient-shadow classes', () => {
    const { container } = render(
      <DataTable testId="t" columns={columns} data={data} getRowId={(r) => r.id} columnPinning={PINNING} />,
    );
    // Last left-pinned column and first right-pinned column carry the shadow hooks.
    expect(container.querySelectorAll('.dt-pin-left-last').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.dt-pin-right-first').length).toBeGreaterThan(0);
  });

  it('applies the selected state and renders the empty state when there are no rows', () => {
    const { rerender } = render(
      <DataTable
        testId="t"
        columns={columns}
        data={data}
        getRowId={(r) => r.id}
        rowProps={(row) => ({ selected: row.original.id === 'a' })}
      />,
    );
    expect(document.querySelectorAll('tr[data-state="selected"]').length).toBe(1);

    rerender(
      <DataTable
        testId="t"
        columns={columns}
        data={[]}
        getRowId={(r) => r.id}
        emptyState={<span>No data</span>}
      />,
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
  });
});
