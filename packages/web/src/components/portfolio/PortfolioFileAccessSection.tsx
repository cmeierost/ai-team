import type { ReactNode } from 'react';
import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioFileAccessSectionProps {
  children: ReactNode;
}

export function PortfolioFileAccessSection({ children }: Readonly<PortfolioFileAccessSectionProps>) {
  return (
    <PortfolioSectionCard title="File Access" icon="📂">
      {children}
    </PortfolioSectionCard>
  );
}
