// 模型组合框:自由输入 + chevron 打开下拉(portaled,不被对话框滚动区裁切)。
// 选项来自「获取模型列表」;选中即填,也可手填自定义模型。
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger, PopoverAnchor } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export function ModelCombobox({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn('relative', className)}>
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="pr-8 font-mono text-[12px]"
          />
          <PopoverTrigger asChild>
            <button
              type="button"
              tabIndex={-1}
              aria-label="选择模型"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className="size-3.5" aria-hidden />
            </button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="max-h-56 w-[var(--radix-popper-anchor-width)] min-w-[12rem] overflow-y-auto p-1"
      >
        {options.length === 0 ? (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground/60">—</div>
        ) : (
          options.map((o) => (
            <button
              key={o}
              type="button"
              className={cn(
                'block w-full truncate rounded-[6px] px-2 py-1.5 text-left font-mono text-[12px] hover:bg-accent',
                o === value && 'bg-accent/60',
              )}
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
            >
              {o}
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
