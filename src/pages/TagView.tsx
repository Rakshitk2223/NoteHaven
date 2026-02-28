import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, CheckSquare, Play, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import AppSidebar from '@/components/AppSidebar';
import { TagBadge } from '@/components/TagBadge';
import { searchByTag, type TaggedItems, type Tag } from '@/lib/tags';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';

export default function TagView() {
  const { tagName } = useParams<{ tagName: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<TaggedItems>({
    notes: [],
    tasks: [],
    media: [],
    prompts: [],
    snippets: []
  });
  const [tag, setTag] = useState<Tag | null>(null);

  useEffect(() => {
    if (tagName) {
      loadTaggedItems();
    }
  }, [tagName]);

  const loadTaggedItems = async () => {
    try {
      setLoading(true);
      
      // Decode the tag name from URL
      const decodedTagName = decodeURIComponent(tagName || '');
      
      // Get the tag info
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: tagData } = await supabase
        .from('tags')
        .select('*')
        .eq('user_id', user.id)
        .eq('name', decodedTagName.toLowerCase())
        .single();

      if (tagData) {
        setTag(tagData);
      }

      // Get all tagged items
      const taggedItems = await searchByTag(decodedTagName);
      setItems(taggedItems);
    } catch (error) {
      console.error('Error loading tagged items:', error);
      toast({
        title: 'Error',
        description: 'Failed to load tagged items',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const totalItems = items.notes.length + items.tasks.length + items.media.length + items.prompts.length;

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar />
        
        <div className="flex-1 p-6">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(-1)}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </div>

          {/* Tag Info */}
          <div className="mb-8">
            {loading ? (
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-4 w-24" />
              </div>
            ) : tag ? (
              <div className="flex items-center gap-3">
                <TagBadge tag={tag} size="md" />
                <span className="text-muted-foreground">
                  {totalItems} item{totalItems !== 1 ? 's' : ''}
                </span>
              </div>
            ) : (
              <div>
                <h1 className="text-2xl font-bold">#{tagName}</h1>
                <p className="text-muted-foreground">Tag not found</p>
              </div>
            )}
          </div>

          {/* Content Sections */}
          {loading ? (
            <div className="space-y-8">
              {[...Array(4)].map((_, i) => (
                <div key={i}>
                  <Skeleton className="h-6 w-32 mb-4" />
                  <div className="space-y-2">
                    {[...Array(3)].map((_, j) => (
                      <Skeleton key={j} className="h-12 w-full" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : totalItems === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No items found with this tag.</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => navigate('/dashboard')}
              >
                Go to Dashboard
              </Button>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Notes Section */}
              {items.notes.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">Notes ({items.notes.length})</h2>
                  </div>
                  <div className="grid gap-2">
                    {items.notes.map(note => (
                      <button
                        key={note.id}
                        onClick={() => navigate(`/notes?note=${note.id}`)}
                        className="text-left p-3 rounded-lg border hover:bg-accent transition-colors"
                      >
                        <p className="font-medium truncate">
                          {note.title || 'Untitled Note'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Updated {new Date(note.updated_at).toLocaleDateString()}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Tasks Section */}
              {items.tasks.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <CheckSquare className="h-5 w-5 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">Tasks ({items.tasks.length})</h2>
                  </div>
                  <div className="grid gap-2">
                    {items.tasks.map(task => (
                      <button
                        key={task.id}
                        onClick={() => navigate(`/tasks?task=${task.id}`)}
                        className="text-left p-3 rounded-lg border hover:bg-accent transition-colors"
                      >
                        <p className={task.is_completed ? 'line-through text-muted-foreground' : ''}>
                          {task.task_text}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {task.is_completed ? 'Completed' : 'Pending'}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Media Section */}
              {items.media.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <Play className="h-5 w-5 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">Media ({items.media.length})</h2>
                  </div>
                  <div className="grid gap-2">
                    {items.media.map(media => (
                      <button
                        key={media.id}
                        onClick={() => navigate(`/media?media=${media.id}`)}
                        className="text-left p-3 rounded-lg border hover:bg-accent transition-colors"
                      >
                        <p className="font-medium">{media.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {media.type} • {media.status}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Prompts Section */}
              {items.prompts.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <MessageSquare className="h-5 w-5 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">Prompts ({items.prompts.length})</h2>
                  </div>
                  <div className="grid gap-2">
                    {items.prompts.map(prompt => (
                      <button
                        key={prompt.id}
                        onClick={() => navigate('/library')}
                        className="text-left p-3 rounded-lg border hover:bg-accent transition-colors"
                      >
                        <p className="font-medium">{prompt.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {prompt.is_favorited && '★ Favorite'}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
