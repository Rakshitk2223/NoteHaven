// Shared building blocks for the Settings page. Every section is composed from
// <SettingsSection> (a titled card) wrapping a stack of <SettingRow>s
// (label + description on the left, control on the right).

import * as React from 'react';
import { cn } from '@/lib/utils';

interface SectionProps {
  title: string;
  description?: string;
  icon?: React.ElementType;
  /** Optional right-aligned header control (e.g. a Reset button). */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function SettingsSection({ title, description, icon: Icon, action, children, className }: SectionProps) {
  return (
    <section className={cn('zen-card p-5 sm:p-6', className)}>
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          {Icon && (
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-brand-soft text-primary ring-1 ring-primary/15">
              <Icon className="h-4.5 w-4.5" />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight">{title}</h2>
            {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
          </div>
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </header>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

interface RowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  /** Stack the control below the label instead of inline-right (for wide controls). */
  stacked?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function SettingRow({ label, description, htmlFor, stacked, children, className }: RowProps) {
  return (
    <div
      className={cn(
        'py-3 border-b border-border/40 last:border-0',
        stacked ? 'space-y-2.5' : 'flex items-center justify-between gap-4',
        className,
      )}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium cursor-pointer">{label}</label>
        ) : (
          <p className="text-sm font-medium">{label}</p>
        )}
        {description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>}
      </div>
      {children && <div className={cn(stacked ? '' : 'flex-shrink-0')}>{children}</div>}
    </div>
  );
}

/** A horizontal set of pill choices — used for mode, density, radius, etc. */
interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; icon?: React.ElementType }[];
  className?: string;
}

export function Segmented<T extends string>({ value, onChange, options, className }: SegmentedProps<T>) {
  return (
    <div className={cn('inline-flex items-center gap-1 rounded-xl bg-secondary/60 p-1', className)}>
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              active ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
