import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

interface SharedMeta {
  note_id: number;
  allow_edit: boolean;
}

interface NoteRow {
  id: number;
  title: string | null;
  content: string | null;
  updated_at: string;
}

const SharedNote = () => {
  const { shareId } = useParams<{ shareId: string }>();
  const { toast } = useToast();
  const [meta, setMeta] = useState<SharedMeta | null>(null);
  const [note, setNote] = useState<NoteRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  // Fetch shared note metadata + note data
  useEffect(() => {
    const load = async () => {
      if (!shareId) return;
      setLoading(true);
      try {
        const { data: shared, error: sharedErr } = await supabase
          .from('shared_notes')
          .select('note_id, allow_edit')
          .eq('id', shareId)
          .maybeSingle();
        if (sharedErr || !shared) throw sharedErr || new Error('Share link not found');
  setMeta({ note_id: shared.note_id, allow_edit: !!shared.allow_edit });
        const { data: noteData, error: noteErr } = await supabase
          .from('notes')
          .select('id, title, content, updated_at')
          .eq('id', shared.note_id)
          .single();
        if (noteErr || !noteData) throw noteErr || new Error('Note not found');
        setNote(noteData as NoteRow);
        // populate DOM
        requestAnimationFrame(() => {
          if (titleRef.current) titleRef.current.innerHTML = noteData.title || '';
          if (contentRef.current) contentRef.current.innerHTML = noteData.content || '';
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

  // Realtime subscription for collaborative edits
  useEffect(() => {
    if (!meta?.allow_edit || !meta.note_id) return; // only if editable
    const channel = supabase.channel(`note-${meta.note_id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes', filter: `id=eq.${meta.note_id}` }, (payload: any) => {
        const newRow = payload.new as NoteRow;
        setNote(prev => prev && prev.id === newRow.id ? { ...prev, ...newRow } : newRow);
        // Update DOM if different from local (avoid overwriting while typing)
        // Only update if element is not focused AND content actually differs
        if (titleRef.current && document.activeElement !== titleRef.current) {
          const currentTitle = titleRef.current.innerHTML || '';
          const newTitle = newRow.title || '';
          if (currentTitle !== newTitle) {
            titleRef.current.innerHTML = newTitle;
          }
        }
        if (contentRef.current && document.activeElement !== contentRef.current) {
          const currentContent = contentRef.current.innerHTML || '';
          const newContent = newRow.content || '';
          if (currentContent !== newContent) {
            contentRef.current.innerHTML = newContent;
          }
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [meta]);

  const pushUpdate = useCallback(async (field: 'title' | 'content', value: string) => {
    if (!meta?.allow_edit || !note) return;
    try {
      setSaving(true);
      const { error } = await supabase.from('notes').update({ [field]: value }).eq('id', note.id);
      if (error) throw error;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save change';
      toast({ title: 'Save failed', description: message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [meta, note, toast]);

  const scheduleSave = (field: 'title' | 'content', value: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => pushUpdate(field, value), 800);
  };

  const handleTitleInput = () => {
    if (!note) return;
    const html = titleRef.current?.innerHTML || '';
    setNote(prev => prev ? { ...prev, title: html } : prev);
    scheduleSave('title', html);
  };
  const handleContentInput = () => {
    if (!note) return;
    const html = contentRef.current?.innerHTML || '';
    setNote(prev => prev ? { ...prev, content: html } : prev);
    scheduleSave('content', html);
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading shared note...</div>;
  }
  if (!note) {
    return <div className="p-8 text-center text-destructive">Shared note not found.</div>;
  }

  return (
    <div className="min-h-screen bg-background p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Shared Note</h1>
        {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
      </div>
      <div
        ref={titleRef}
        contentEditable={meta?.allow_edit}
        suppressContentEditableWarning
        onInput={meta?.allow_edit ? handleTitleInput : undefined}
        className={`text-3xl font-bold mb-4 focus:outline-none ${meta?.allow_edit ? 'border-b border-transparent focus:border-border' : ''}`}
        aria-label="Note title"
      />
      <div
        ref={contentRef}
        contentEditable={meta?.allow_edit}
        suppressContentEditableWarning
        onInput={meta?.allow_edit ? handleContentInput : undefined}
        className={`prose dark:prose-invert max-w-none min-h-[50vh] focus:outline-none ${meta?.allow_edit ? 'border border-transparent focus:border-border rounded-md p-3' : ''}`}
        aria-label="Note content"
      />
      {!meta?.allow_edit && (
        <div className="mt-6 text-sm text-muted-foreground">Read-only share. Owner disabled editing.</div>
      )}
    </div>
  );
};

export default SharedNote;
