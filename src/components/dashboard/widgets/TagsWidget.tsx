import { TagCloud } from '@/components/TagCloud';
import { WidgetWrapper } from '../WidgetWrapper';
import type { Tag } from '@/lib/tags';
import type { WidgetProps } from '@/lib/dashboard';

interface TagsWidgetProps extends WidgetProps {
  tags: Tag[];
  onTagClick: (tag: Tag) => void;
}

export function TagsWidget({
  widget,
  tags,
  isLoading,
  onTagClick
}: TagsWidgetProps) {
  const emptyState = (
    <div className="text-center py-8">
      <p className="text-sm text-muted-foreground">No tags yet.</p>
      <p className="text-xs text-muted-foreground mt-1">
        Add tags to your items to organize them!
      </p>
    </div>
  );

  return (
    <WidgetWrapper
      widget={widget}
      isLoading={isLoading}
      isEmpty={tags.length === 0}
      emptyState={emptyState}
    >
      <TagCloud
        tags={tags.slice(0, 12)}
        selectedTags={[]}
        onTagClick={(tag) => onTagClick(tag)}
        showCount={true}
        className="max-h-48"
      />
    </WidgetWrapper>
  );
}
