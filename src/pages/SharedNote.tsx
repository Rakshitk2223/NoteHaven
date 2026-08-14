import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import { sanitizePreview } from '@/lib/utils';

// Shared notes are reached through two SECURITY DEFINER functions
// (migration 19), never by querying `notes` / `shared_notes` directly:
//   get_shared_note(share_id)                  → the note, if the id is valid
//   update_shared_note(share_id, title, body)  → writes only when allow_edit
// The share id is the secret; the tables themselves are owner-only, so a
// recipient can no longer enumerate shares or read notes they weren't given.

interface SharedNoteRow {
  id: number;
  title: string | null;
  content: string | null;
  updated_at: string;
  allow_edit: boolean;
}

const SharedNote = () => {
  const { shareId } = useParams<{ shareId: string }>();
  const { toast } = useToast();
  const [note, setNote] = useState<SharedNoteRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allowEdit = !!note?.allow_edit;

  // Fetch the shared note by share id.
  useEffect(() => {
    const load = async () => {
      if (!shareId) return;
      setLoading(true);
      try {
        const { data, error } = await supabase
          .rpc('get_shared_note', { p_share_id: shareId });
        if (error) throw error;

        const row = (data as SharedNoteRow[] | null)?.[0];
        if (!row) throw new Error('This share link is no longer valid.');

        setNote(row);
        // Populate the DOM once; sanitize the stored HTML before injecting it.
        requestAnimationFrame(() => {
          if (titleRef.current) titleRef.current.textContent = row.title || '';
          if (contentRef.current) contentRef.current.innerHTML = sanitizePreview(row.content || '');
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unable to load shared note';
        toast({ title: 'Error', description: message, variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [shareId, toast]);

  // Flush a pending save if the tab closes mid-edit.
  useEffect(() => {
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, []);

  const pushUpdate = useCallback(async (field: 'title' | 'content', value: string) => {
    if (!allowEdit || !shareId) return;
    try {
      setSaving(true);
      const { data, error } = await supabase.rpc('update_shared_note', {
        p_share_id: shareId,
        p_title: field === 'title' ? value : null,
        p_content: field === 'content' ? value : null,
      });
      if (error) throw error;
      // The function returns 0 when the share was revoked or set to read-only
      // while this tab was open.
      if (data === 0) {
        toast({
          title: 'Not saved',
          description: 'This link is now read-only. Ask the owner for edit access.',
          variant: 'destructive',
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save change';
      toast({ title: 'Save failed', description: message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [allowEdit, shareId, toast]);

  const scheduleSave = (field: 'title' | 'content', value: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => pushUpdate(field, value), 800);
  };

  const handleTitleInput = () => {
    if (!note) return;
    const text = titleRef.current?.textContent || '';
    scheduleSave('title', text);
  };

  const handleContentInput = () => {
    if (!note) return;
    const html = sanitizePreview(contentRef.current?.innerHTML || '');
    scheduleSave('content', html);
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading shared note...</div>;
  }
  if (!note) {
    return <div className="p-8 text-center text-destructive">Shared note not found.</div>;
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Shared Note</h1>
        {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
      </div>
      <div
        ref={titleRef}
        contentEditable={allowEdit}
        suppressContentEditableWarning
        onInput={allowEdit ? handleTitleInput : undefined}
        className={`text-2xl sm:text-3xl font-bold mb-4 focus:outline-none ${allowEdit ? 'border-b border-transparent focus:border-border' : ''}`}
        aria-label="Note title"
      />
      <div
        ref={contentRef}
        contentEditable={allowEdit}
        suppressContentEditableWarning
        onInput={allowEdit ? handleContentInput : undefined}
        className={`prose dark:prose-invert max-w-none min-h-[50vh] focus:outline-none ${allowEdit ? 'border border-transparent focus:border-border rounded-md p-3' : ''}`}
        aria-label="Note content"
      />
      {!allowEdit && (
        <div className="mt-6 text-sm text-muted-foreground">Read-only share. Owner disabled editing.</div>
      )}
    </div>
  );
};

export default SharedNote;
