import React from 'react';
import type { RouteSectionId, SectionMetric } from '../app-data';

type PageMetricsContextValue = {
  setSectionMetrics: (sectionId: RouteSectionId, metrics: SectionMetric[] | null) => void;
};

export const PageMetricsContext = React.createContext<PageMetricsContextValue>({
  setSectionMetrics: () => undefined
});

export const usePageMetrics = () => React.useContext(PageMetricsContext);
