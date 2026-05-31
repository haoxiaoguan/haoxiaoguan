import { cn } from "@/lib/utils";
import { AnimatedSegmentedControl } from "@/components/ui/animated-segmented-control";

type SegmentedOption = {
  value: string;
  label: string;
};

export function SegmentedOptions({
  items,
  value,
  onChange,
  className,
  fullWidth = false,
}: {
  items: readonly SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  fullWidth?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-full bg-muted p-0.5 dark:bg-white/[0.06]",
        fullWidth ? "flex w-full" : "inline-flex",
        className,
      )}
    >
      <AnimatedSegmentedControl
        items={items}
        value={value}
        onValueChange={(nextValue) => onChange(nextValue)}
        equalWidth={fullWidth}
        className={cn("gap-0.5", fullWidth && "w-full")}
        indicatorClassName="rounded-full bg-primary shadow-sm"
        itemClassName="rounded-full px-[18px] py-[5px] text-[13px] font-medium whitespace-nowrap"
        activeItemClassName="text-primary-foreground"
        inactiveItemClassName="text-muted-foreground hover:text-foreground"
      />
    </div>
  );
}
