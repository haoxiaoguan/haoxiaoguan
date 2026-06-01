import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GlowCard } from '@/components/ui/glow-card';
import { ShineBorder } from '@/components/ui/shine-border';
import { AnimatedGradientText } from '@/components/ui/animated-gradient-text';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedOptions } from '@/components/ui/segmented-options';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

describe('decoration smoke', () => {
  it('renders GlowCard with required props', () => {
    // GlowCard API: color, label, value, sub (no children — it renders its own content)
    const { getByText } = render(
      <GlowCard color="blue" label="Revenue" value="$1,234" sub="vs last month" />,
    );
    expect(getByText('Revenue')).toBeInTheDocument();
    expect(getByText('$1,234')).toBeInTheDocument();
  });

  it('renders ShineBorder as decorative overlay', () => {
    // ShineBorder is a pointer-events-none absolute overlay; wrap in a relative container
    const { container } = render(
      <div className="relative">
        <ShineBorder shineColor="#3b82f6" />
        <span>content</span>
      </div>,
    );
    expect(container.textContent).toContain('content');
    // The shine border element itself should be present in the DOM
    expect(container.querySelector('[data-shine-border]')).toBeTruthy();
  });

  it('renders AnimatedGradientText', () => {
    const { container } = render(<AnimatedGradientText>grad</AnimatedGradientText>);
    expect(container.textContent).toBe('grad');
  });

  it('renders PageHeader', () => {
    const { getByText } = render(<PageHeader title="ph-title" />);
    expect(getByText('ph-title')).toBeInTheDocument();
  });

  it('renders SegmentedOptions', () => {
    // SegmentedOptions uses `items` (not `options`) and `onChange`
    const { getByRole } = render(
      <SegmentedOptions
        value="a"
        onChange={() => {}}
        items={[{ value: 'a', label: 'A' }]}
      />,
    );
    expect(getByRole('radio', { name: 'A' })).toBeInTheDocument();
  });

  it('renders ScrollArea', () => {
    const { container } = render(<ScrollArea>scroll</ScrollArea>);
    expect(container.textContent).toContain('scroll');
  });

  it('renders Tooltip primitives', () => {
    const { getByText } = render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>trigger</TooltipTrigger>
          <TooltipContent>tip</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(getByText('trigger')).toBeInTheDocument();
  });

  it('renders Sheet primitives', () => {
    const { getByText } = render(
      <Sheet>
        <SheetTrigger>open</SheetTrigger>
        <SheetContent>content</SheetContent>
      </Sheet>,
    );
    expect(getByText('open')).toBeInTheDocument();
  });
});
