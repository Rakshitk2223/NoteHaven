import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag as TagIcon, Search } from 'lucide-react';
import { PageShell } from '@/components/PageShell';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { TagBadge } from '@/components/TagBadge';
import { Stagger, StaggerItem } from '@/components/ui/motion';
import { fetchUserTags, type Tag } from '@/lib/tags';
import { useToast } from '@/components/ui/use-toast';

/**
 * The tag system indexes six entity types through /tags/:tagName, but there was
 * no way to see what tags exist — the only entry point was a dashboard widget
 * that is hidden by default. This is that listing.
 */
export default function TagsIndex() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setTags(await fetchUserTags());
      } catch (e) {
        toast({
          title: 'Could not load tags',
          description: e instanceof Error ? e.message : 'Failed',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? tags.filter((t) => t.name.toLowerCase().includes(q)) : tags;
    return [...list].sort((a, b) =>
      (b.usage_count ?? 0) - (a.usage_count ?? 0) || a.name.localeCompare(b.name));
  }, [tags, query]);

  const used = filtered.filter((t) => (t.usage_count ?? 0) > 0);
  const unused = filtered.filter((t) => (t.usage_count ?? 0) === 0);

  const section = (label: string, list: Tag[], hint?: string) => (
    <div>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-lg font-semibold">{label}</h2>
        <span className="text-sm text-muted-foreground">{list.length}</span>
        {hint && <span className="text-xs text-muted-foreground">· {hint}</span>}
      </div>
      <Stagger className="flex flex-wrap gap-2">
        {list.map((tag) => (
          <StaggerItem key={tag.id}>
            <button
              onClick={() => navigate(`/tags/${encodeURIComponent(tag.name)}`)}
              className="zen-card flex items-center gap-2 px-3 py-2 text-left transition-colors hover:border-border-strong"
            >
              <TagBadge tag={tag} size="sm" clickable={false} />
              <span className="text-xs tabular-nums text-muted-foreground">
                {tag.usage_count ?? 0}
              </span>
            </button>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );

  return (
    <PageShell
      title="Tags"
      icon={TagIcon}
      subtitle="Everything you've tagged, across notes, tasks, media, prompts, snippets and work"
      maxWidth="6xl"
    >
      <div className="relative mb-6 sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tags…"
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-28" />
          ))}
        </div>
      ) : tags.length === 0 ? (
        <EmptyState
          icon={TagIcon}
          title="No tags yet"
          description="Tag a note, task, media title, prompt, snippet or work project and it will show up here."
        />
      ) : filtered.length === 0 ? (
        <div className="zen-card p-8 text-center">
          <p className="mb-4 text-muted-foreground">No tags match “{query}”.</p>
          <Button variant="outline" onClick={() => setQuery('')}>Clear search</Button>
        </div>
      ) : (
        <div className="space-y-8">
          {used.length > 0 && section('In use', used)}
          {unused.length > 0 && section('Unused', unused, 'not attached to anything')}
        </div>
      )}
    </PageShell>
  );
}
