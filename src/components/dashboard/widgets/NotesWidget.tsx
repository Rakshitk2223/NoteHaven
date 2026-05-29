import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WidgetWrapper } from '../WidgetWrapper';
import { sanitizeHtml } from '@/lib/utils';
import type { WidgetProps } from '@/lib/dashboard';

interface Note {
  id: number;
  title: string | null;
  updated_at: string;
}

interface NotesWidgetProps extends WidgetProps {
  notes: Note[];
  onViewAll: () => void;
  onNoteClick: (noteId: number) => void;
}

export function NotesWidget({
  widget,
  notes,
  isLoading,
  onViewAll,
  onNoteClick
}: NotesWidgetProps) {
  const emptyState = (
    <div className="text-center py-8">
      <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
      <p className="text-muted-foreground">No notes yet</p>
    </div>
  );

  return (
    <WidgetWrapper
      widget={widget}
      isLoading={isLoading}
      isEmpty={notes.length === 0}
      emptyState={emptyState}
    >
      <div className="flex items-center justify-end mb-5">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={onViewAll}
          className="h-8 px-3 text-xs font-medium hover:bg-primary hover:text-primary-foreground transition-colors"
        >
          View All →
        </Button>
      </div>

      <div className="space-y-4">
        {notes.slice(0, 5).map((note) => (
          <div
            key={note.id}
            onClick={() => onNoteClick(note.id)}
            className="p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
          >
            <p
              className="font-semibold text-sm text-foreground mb-1 line-clamp-1 leading-tight"
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(note.title || 'Untitled')
              }}
            />
            <p className="text-xs text-muted-foreground">
              {new Date(note.updated_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              })}
            </p>
          </div>
        ))}
      </div>
    </WidgetWrapper>
  );
}
