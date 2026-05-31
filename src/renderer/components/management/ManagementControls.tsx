import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type ControlIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

export function ManagementHeaderTabs({
  tabs,
  value,
  ariaLabel,
}: {
  tabs: Array<{ value: string; label: string; to: string }>;
  value: string;
  ariaLabel: string;
}) {
  return (
    <div
      data-testid="management-header-tabs"
      role="tablist"
      aria-label={ariaLabel}
      className="no-drag flex h-full items-stretch gap-6 self-stretch"
      data-tauri-no-drag
    >
      {tabs.map((tab) => {
        const selected = value === tab.value;

        return (
          <NavLink
            key={tab.value}
            to={tab.to}
            role="tab"
            aria-selected={selected}
            className={cn(
              'relative inline-flex h-full items-center text-[16px] font-semibold leading-none transition-colors',
              selected
                ? 'text-primary after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:rounded-full after:bg-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </NavLink>
        );
      })}
    </div>
  );
}

export function ManagementInfoPill({
  icon: Icon,
  iconNode,
  tone = 'neutral',
  label,
  className,
}: {
  icon?: ControlIcon;
  iconNode?: ReactNode;
  tone?: 'neutral' | 'blue' | 'orange' | 'green' | 'purple' | 'slate';
  label: ReactNode;
  className?: string;
}) {
  const toneClassName =
    tone === 'blue'
      ? 'border-primary/15 bg-primary/5 text-primary'
      : tone === 'orange'
        ? 'border-orange-500/20 bg-orange-500/5 text-orange-600'
        : tone === 'green'
          ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600'
          : tone === 'purple'
            ? 'border-violet-500/20 bg-violet-500/5 text-violet-600'
            : tone === 'slate'
              ? 'border-slate-500/20 bg-slate-500/5 text-slate-700 dark:text-slate-300'
              : 'border-border bg-card text-foreground shadow-sm';

  return (
    <span
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border px-2 text-[12px] font-medium',
        toneClassName,
        className,
      )}
    >
      {iconNode}
      {Icon ? <Icon className="size-3.5" strokeWidth={1.9} aria-hidden /> : null}
      {label}
    </span>
  );
}

export function ManagementSearchField({
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  inputClassName?: string;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className={cn('relative min-w-[180px] flex-1 basis-[180px]', className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.9}
        aria-hidden
      />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn('h-8 rounded-[8px] bg-card pl-8 text-[12px]', inputClassName)}
      />
    </div>
  );
}

export function ManagementActionButton({
  icon: Icon,
  spin,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ComponentType<LucideProps>;
  spin?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn('h-8 rounded-[8px] bg-card px-3 text-[12px]', className)}
      {...props}
    >
      {Icon ? (
        <Icon
          data-icon="inline-start"
          className={cn(spin && 'animate-spin')}
          strokeWidth={1.9}
          aria-hidden
        />
      ) : null}
      {children}
    </Button>
  );
}

export function ManagementIconButton({
  label,
  icon: Icon,
  spin,
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string;
  icon: ComponentType<LucideProps>;
  spin?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      title={label}
      className={cn('size-8 rounded-[8px] bg-card', className)}
      {...props}
    >
      <Icon className={cn('size-3.5', spin && 'animate-spin')} strokeWidth={1.9} aria-hidden />
    </Button>
  );
}

export function ManagementPaginationBar({
  total,
  currentPage,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
  className,
  testId,
}: {
  total: number;
  currentPage: number;
  pageSize: number;
  pageSizeOptions: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  className?: string;
  testId?: string;
}) {
  if (total === 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(currentPage, totalPages);

  return (
    <div
      data-testid={testId}
      className={cn(
        'flex min-h-12 flex-col gap-3 border-t border-border/80 px-4 py-2 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div>共 {total} 项</div>
      <div className="flex items-center gap-2">
        <ManagementIconButton
          label="上一页"
          icon={ChevronLeft}
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        />
        {buildPageNumbers(totalPages, page).map((pageNumber) => (
          <Button
            key={pageNumber}
            type="button"
            size="icon"
            variant={pageNumber === page ? 'default' : 'outline'}
            aria-current={pageNumber === page ? 'page' : undefined}
            className="size-8 rounded-[8px]"
            onClick={() => onPageChange(pageNumber)}
          >
            {pageNumber}
          </Button>
        ))}
        <ManagementIconButton
          label="下一页"
          icon={ChevronRight}
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        />
        <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
          <SelectTrigger aria-label="每页数量" className="h-8 w-[92px] rounded-[8px] bg-card text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {pageSizeOptions.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option} / 页
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function buildPageNumbers(totalPages: number, currentPage: number) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  return Array.from({ length: 5 }, (_, index) => start + index);
}
