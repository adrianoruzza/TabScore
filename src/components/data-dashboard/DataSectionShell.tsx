import type { ReactNode } from 'react';
import type { StudentSupportTag } from '../../types/gradebook';

/**
 * Shared semantic palette for the three support categories across KPIs,
 * tables, legends, and comparative charts. Restrained, accessible, and
 * always paired with explicit text labels (never hue-only).
 */
export const SUPPORT_CATEGORY_META: Record<
  StudentSupportTag,
  {
    id: StudentSupportTag;
    label: string;
    fullName: string;
    barColor: string;
    textClass: string;
    softBgClass: string;
  }
> = {
  DSA: {
    id: 'DSA',
    label: 'DSA',
    fullName: "Disturbi Specifici dell'Apprendimento",
    barColor: '#2563eb', // blue-600
    textClass: 'text-blue-700',
    softBgClass: 'bg-blue-50/70',
  },
  BES: {
    id: 'BES',
    label: 'BES',
    fullName: 'Bisogni Educativi Speciali',
    barColor: '#d97706', // amber-600
    textClass: 'text-amber-700',
    softBgClass: 'bg-amber-50/70',
  },
  H: {
    id: 'H',
    label: 'H',
    fullName: 'Disabilità (Legge 104)',
    barColor: '#0d9488', // teal-600
    textClass: 'text-teal-700',
    softBgClass: 'bg-teal-50/70',
  },
};

/**
 * Extensible registry of thematic dashboard section identifiers.
 * Future sections (e.g. evaluations, plate deliveries, folder delays,
 * demographic breakdowns) can be appended here and rendered as sibling
 * modules inside DataDashboardView without changing existing layout geometry.
 */
export type DataDashboardSectionId =
  | 'population_overview'
  | 'year_distribution'
  | 'support_distribution';

interface DataSectionShellProps {
  id: string;
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  children: ReactNode;
}

export function DataSectionShell({
  id,
  title,
  subtitle,
  headerRight,
  children,
}: DataSectionShellProps) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="rounded-lg border border-slate-200 bg-white"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2
            id={`${id}-heading`}
            className="font-display text-base font-semibold text-slate-900"
          >
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
          )}
        </div>
        {headerRight && (
          <div className="flex shrink-0 items-center gap-2">{headerRight}</div>
        )}
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}
