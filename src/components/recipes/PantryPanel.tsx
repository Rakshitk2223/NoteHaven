import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Sparkles, X } from 'lucide-react';

interface PantryPanelProps {
  chips: string[];
  onChange: (chips: string[]) => void;
  /** how many recipes currently match (shown when ≥1 chip) */
  matchCount?: number;
}

/**
 * "Cook with what I have" panel — type ingredients, Enter or comma adds a
 * removable chip. The parent filters/ranks recipes while ≥1 chip is set.
 */
export function PantryPanel({ chips, onChange, matchCount }: PantryPanelProps) {
  const [input, setInput] = useState('');

  const commit = (raw: string) => {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const existing = new Set(chips.map((c) => c.toLowerCase()));
    const next = [...chips];
    for (const p of parts) {
      if (!existing.has(p.toLowerCase())) {
        existing.add(p.toLowerCase());
        next.push(p);
      }
    }
    onChange(next);
    setInput('');
  };

  return (
    <div className="zen-card space-y-3 rounded-2xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" /> What can I make?
        </p>
        <p className="text-xs text-muted-foreground">
          Add the ingredients you have — recipes are ranked by what you can cook.
        </p>
        {chips.length > 0 && (
          <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs text-muted-foreground" onClick={() => onChange([])}>
            Clear all
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="e.g. chicken, garlic, rice — Enter to add"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit(input);
            } else if (e.key === 'Backspace' && !input && chips.length > 0) {
              onChange(chips.slice(0, -1));
            }
          }}
          onBlur={() => { if (input.trim()) commit(input); }}
        />
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip}
              className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/15 py-1 pl-2.5 pr-1 text-sm"
            >
              {chip}
              <button
                type="button"
                aria-label={`Remove ${chip}`}
                onClick={() => onChange(chips.filter((c) => c !== chip))}
                className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-primary/20 hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {typeof matchCount === 'number' && (
            <span className="ml-1 text-xs text-muted-foreground">
              {matchCount} {matchCount === 1 ? 'recipe matches' : 'recipes match'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
