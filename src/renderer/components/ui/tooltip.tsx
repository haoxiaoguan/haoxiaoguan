import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

type TooltipVariant = "default" | "translucent"

type TooltipContentProps = React.ComponentPropsWithoutRef<
  typeof TooltipPrimitive.Content
> & {
  /**
   * Visual variant.
   * - `default`: solid white-on-black (or dark-on-light) chip with arrow.
   * - `translucent`: AiMaMi-style frosted dark pill, no arrow. Used by the
   *   sidebar in icon-collapsed mode.
   */
  variant?: TooltipVariant
}

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(({ className, sideOffset = 5, variant = "default", children, ...props }, ref) => {
  if (variant === "translucent") {
    return (
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          ref={ref}
          sideOffset={sideOffset}
          className={cn(
            // Frosted dark pill — see AiMaMi reference (screenshot 2):
            // pill-shaped, semi-transparent dark background, white label,
            // soft drop shadow, no arrow.
            "relative z-[300] max-w-sm overflow-visible rounded-full px-3 py-1.5 text-[12px] font-medium leading-none",
            "bg-[hsl(var(--tooltip-translucent))] text-[hsl(var(--tooltip-translucent-foreground))]",
            "shadow-md backdrop-blur-md",
            "duration-150 animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    )
  }

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          // 垂直 padding 不对称（pt 5 / pb 7）用于补偿字体 metrics 在 leading-none 时的视觉偏移：
          // PingFang SC / SF Pro 在 11px + line-height:1 下，字符 ink 在 line-box 内**偏下**，
          // 上下严格 6/6 时视觉上字会偏下、上方留白显得大；改成 5/7 把字"挤"向上 1px 视觉居中。
          // 总高度不变（23px），只是上下 padding 的分配变了。
          //
          // z-index：tooltip 通过 Portal 挂到 body，必须高于 DialogContent 的栈（DIALOG_STACK_Z=200，
          // 见 dialog.tsx），否则 dialog 内 hover 出来的 tooltip 会被 dialog 浮层完全压住看不见。
          // 取 z-[300] 作为「顶层悬浮提示」常驻层，仍低于原生 toast / 系统级 overlay。
          "relative z-[300] max-w-sm overflow-visible rounded-[6px] px-2 pt-[5px] pb-[7px] text-[11px] font-medium leading-none",
          "box-border text-center",
          "bg-[hsl(var(--tooltip))] text-[hsl(var(--tooltip-foreground))]",
          "shadow-sm",
          "duration-150 animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100",
          className
        )}
        {...props}
      >
        <span className="inline-flex min-h-[11px] w-full items-center justify-center">{children}</span>
        <TooltipPrimitive.Arrow
          className="fill-[hsl(var(--tooltip))]"
          width={11}
          height={5}
        />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
})
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
