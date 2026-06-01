import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BentoCard } from '@/components/ui/bento-card';
import { BentoInnerPanel } from '@/components/ui/bento-inner-panel';

describe('bento smoke', () => {
  it('renders BentoCard with inner panel', () => {
    const { getByText } = render(
      <BentoCard>
        <BentoInnerPanel>inner-panel-text</BentoInnerPanel>
      </BentoCard>,
    );
    expect(getByText('inner-panel-text')).toBeInTheDocument();
  });
});
