import { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';

// The owner writes with Tiptap (StarterKit + Underline). Sanitising with the
// list-preview allowlist stripped <s> and <hr>, so a recipient's first keystroke
// permanently deleted the owner's strikethrough and rules (audit F-N06).
const sanitizeNoteHtml = (html: string) =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'hr', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre', 'span'],
    ALLOWED_ATTR: ['class'],
    ALLOW_DATA_ATTR: false,
  });

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
  // Pending values per field, sent together — one shared timer used to let a body
  // edit cancel a title edit made within 800 ms of it (audit F-N06).
  const pendingRef = useRef<{ title?: string; content?: string }>({});

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
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unable to load shared note';
        toast({ title: 'Error', description: message, variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [shareId, toast]);

  // Populate the editable DOM once per loaded note, after React has committed the
  // note view. The old requestAnimationFrame could fire while the loading view
  // was still mounted (refs null), leaving an editable-but-blank note whose first
  // keystroke would overwrite the owner's text.
  useLayoutEffect(() => {
    if (!note || loading) return;
    if (titleRef.current) titleRef.current.textContent = note.title || '';
    if (contentRef.current) contentRef.current.innerHTML = sanitizeNoteHtml(note.content || '');
    // Once per loaded note — re-running on every render would reset the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, loading]);

  const pushUpdate = useCallback(async (patch: { title?: string; content?: string }) => {
    if (!allowEdit || !shareId) return;
    try {
      setSaving(true);
      const { data, error } = await supabase.rpc('update_shared_note', {
        p_share_id: shareId,
        p_title: patch.title ?? null,
        p_content: patch.content ?? null,
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

  // Send whatever is pending now. Used by the debounce and by every exit path.
  const flush = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (patch.title !== undefined || patch.content !== undefined) void pushUpdate(patch);
  }, [pushUpdate]);

  const scheduleSave = (field: 'title' | 'content', value: string) => {
    pendingRef.current = { ...pendingRef.current, [field]: value };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 800);
  };

  // The page is going away (tab closed / hidden). supabase-js awaits the session
  // before it even calls fetch, and a closing tab never gets that far — UX saw NO
  // update_shared_note request when the tab closed within ~1 s (F-N06). A keepalive
  // fetch is dispatched synchronously and outlives the page. Same RPC, same anon
  // grant. keepalive bodies are capped (~64 KiB), so larger notes take the normal path.
  const flushOnExit = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const patch = pendingRef.current;
    if (patch.title === undefined && patch.content === undefined) return;
    if (!allowEdit || !shareId) return;
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    const body = JSON.stringify({ p_share_id: shareId, p_title: patch.title ?? null, p_content: patch.content ?? null });
    if (!url || !key || new Blob([body]).size > 60_000) { flush(); return; }
    pendingRef.current = {};
    try {
      void fetch(`${url}/rest/v1/rpc/update_shared_note`, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
        body,
      }).catch(() => undefined);
    } catch {
      // Nothing more can be done while the page unloads.
    }
  }, [allowEdit, shareId, flush]);

  // Flush (not cancel) a pending save when leaving: navigating away in-app (normal
  // path), hiding the tab or closing it (keepalive path). The old cleanup cleared
  // the timer, dropping the last edit.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const flushOnExitRef = useRef(flushOnExit);
  flushOnExitRef.current = flushOnExit;
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushOnExitRef.current(); };
    const onUnload = () => flushOnExitRef.current();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onUnload);
      flushRef.current();
    };
  }, []);

  const handleTitleInput = () => {
    if (!note) return;
    const text = titleRef.current?.textContent || '';
    scheduleSave('title', text);
  };

  const handleContentInput = () => {
    if (!note) return;
    const html = sanitizeNoteHtml(contentRef.current?.innerHTML || '');
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
