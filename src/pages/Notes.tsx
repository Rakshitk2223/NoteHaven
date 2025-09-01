import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Trash2, Menu, Pin, Bold, Italic, Underline, Palette, Lightbulb, List, Share2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
// Removed Input for title rich text
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import AppSidebar from "@/components/AppSidebar";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface Note {
  id: number;
  user_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  is_pinned?: boolean;
  background_color?: string | null;
}

const Notes = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobileView, setIsMobileView] = useState(false);
  const [showNoteList, setShowNoteList] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  
  // Local editor states (decoupled from notes array to prevent cursor jump)
  const [localTitle, setLocalTitle] = useState(""); // HTML
  const [localContent, setLocalContent] = useState(""); // HTML
  const titleRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [activeField, setActiveField] = useState<'title' | 'content' | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [lineCount, setLineCount] = useState(0);
  const { toast } = useToast();
  // Sharing state
  const [shareOpen, setShareOpen] = useState(false);
  const [allowEditShare, setAllowEditShare] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [generatingShare, setGeneratingShare] = useState(false);

  // Debouncing for auto-save
  const [titleTimeout, setTitleTimeout] = useState<NodeJS.Timeout | null>(null);
  const [contentTimeout, setContentTimeout] = useState<NodeJS.Timeout | null>(null);

  // Check if we're on mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobileView(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Fetch notes on component mount
  useEffect(() => {
    fetchNotes();
  }, []);

  // Update form values when selected note changes
  useEffect(() => {
    if (selectedNote) {
      const t = selectedNote.title || "";
      const c = selectedNote.content || "";
  setLocalTitle(t);
  setLocalContent(c);
      requestAnimationFrame(() => {
        if (titleRef.current && titleRef.current.innerHTML !== t) titleRef.current.innerHTML = t;
        if (contentRef.current && contentRef.current.innerHTML !== c) contentRef.current.innerHTML = c;
      });
    } else {
  setLocalTitle("");
  setLocalContent("");
      if (titleRef.current) titleRef.current.innerHTML = "";
      if (contentRef.current) contentRef.current.innerHTML = "";
    }
  }, [selectedNote]);

  const fetchNotes = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { data, error } = await supabase
        .from('notes')
        .select('*')
  .order('is_pinned', { ascending: false })
  .order('updated_at', { ascending: false });

      if (error) {
        throw error;
      }

      let loaded = data || [];

      // 1. Locate existing Inbox (exact title match only now)
      let inboxNote = loaded.find(n => (n.title || '') === 'Inbox');

      // 2. If missing, create it
      if (!inboxNote) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: created, error: createErr } = await supabase
            .from('notes')
            .insert([{ title: 'Inbox', content: '', user_id: user.id }])
            .select()
            .single();
          if (!createErr && created) {
            inboxNote = created;
            loaded = [created, ...loaded];
          }
        }
      }

      // 3. Separate inbox from others explicitly
      const otherNotes = loaded.filter(n => n !== inboxNote);

      // 4. Sort remaining notes: pinned first, then by updated_at desc
      otherNotes.sort((a,b) => {
        if (a.is_pinned && !b.is_pinned) return -1;
        if (b.is_pinned && !a.is_pinned) return 1;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });

      // 5. Compose final list ensuring Inbox is always at index 0
      const finalList = inboxNote ? [inboxNote, ...otherNotes] : otherNotes;
      setNotes(finalList);
      
      // Select the first note by default
      if (finalList.length > 0 && !selectedNote) {
        setSelectedNote(finalList[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch notes');
    } finally {
      setLoading(false);
    }
  };

  const createNote = async () => {
    try {
      // Get the current authenticated user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('User not authenticated');
      }

      const newNote = {
        title: "New Note",
        content: "",
        user_id: user.id
      };

      const { data, error } = await supabase
        .from('notes')
        .insert([newNote])
        .select()
        .single();

      if (error) {
        throw error;
      }

      // Add the new note to the beginning of the list
      setNotes(prevNotes => [data, ...prevNotes]);
      setSelectedNote(data);
      
      // Reset form values
  setLocalTitle(data.title);
  setLocalContent(data.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create note');
    }
  };

  const updateNote = async (noteId: number, updates: Partial<Note>) => {
    try {
      const { error } = await supabase
        .from('notes')
        .update(updates)
        .eq('id', noteId);

      if (error) {
        throw error;
      }

      // Update timestamp + any non-editor fields (or applied after save) in local list to keep previews fresh.
      setNotes(prevNotes => prevNotes.map(note => note.id === noteId ? { ...note, ...updates, updated_at: new Date().toISOString() } : note));
      if (selectedNote && selectedNote.id === noteId) {
        // Do not overwrite localTitle/localContent here to avoid cursor jump; only bump updated_at.
        setSelectedNote(prev => prev ? { ...prev, updated_at: new Date().toISOString(), ...('background_color' in updates || 'is_pinned' in updates ? updates : {}) } : null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update note');
    }
  };

  const deleteNote = async (noteId: number) => {
    if (!window.confirm('Are you sure you want to delete this note?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('notes')
        .delete()
        .eq('id', noteId);

      if (error) {
        throw error;
      }

      // Remove the note from the list
      const updatedNotes = notes.filter(note => note.id !== noteId);
      setNotes(updatedNotes);

      // If the deleted note was selected, select the next available note
      if (selectedNote && selectedNote.id === noteId) {
        const nextNote = updatedNotes[0] || null;
        setSelectedNote(nextNote);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete note');
    }
  };

  // Debounced auto-save functions
  const saveField = useCallback(async (noteId: number, field: 'title' | 'content', value: string, previous: string) => {
    try {
      setIsSaving(true);
      const { error } = await supabase.from('notes').update({ [field]: value }).eq('id', noteId);
      if (error) throw error;
      const now = new Date().toISOString();
      // Update list & selected note with new field value so previews stay fresh, but keep DOM caret (innerHTML write guarded below)
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, [field]: value, updated_at: now } : n));
      setSelectedNote(prev => prev && prev.id === noteId ? { ...prev, [field]: value, updated_at: now } : prev);
    } catch (e:any) {
      // Revert field in list (do NOT touch local editor state; user keeps typing)
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, [field]: previous } : n));
      toast({ title: 'Save failed', description: e.message || 'Could not save note', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [toast]);

  const scheduleTitleSave = useCallback((noteId: number, newValue: string, previous: string) => {
    if (titleTimeout) clearTimeout(titleTimeout);
    const timeout = setTimeout(() => saveField(noteId, 'title', newValue, previous), 1200);
    setTitleTimeout(timeout);
  }, [titleTimeout, saveField]);

  const scheduleContentSave = useCallback((noteId: number, newValue: string, previous: string) => {
    if (contentTimeout) clearTimeout(contentTimeout);
    const timeout = setTimeout(() => saveField(noteId, 'content', newValue, previous), 1200);
    setContentTimeout(timeout);
  }, [contentTimeout, saveField]);

  const handleTitleInput = () => {
    const html = titleRef.current?.innerHTML || "";
    setLocalTitle(html);
    if (selectedNote) {
      const previous = selectedNote.title || '';
      if (html !== previous) scheduleTitleSave(selectedNote.id, html, previous);
    }
  };

  const handleContentInput = () => {
    const html = contentRef.current?.innerHTML || "";
    setLocalContent(html);
    if (selectedNote) {
      const previous = selectedNote.content || '';
      if (html !== previous) scheduleContentSave(selectedNote.id, html, previous);
    }
  };

  // Word & line count calculation
  useEffect(() => {
    const plain = localContent
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|h[1-6]|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ');
    const words = plain.trim().length === 0 ? 0 : plain.trim().split(/\s+/).length;
    const lines = plain.split(/\n/).filter(() => true).length;
    setWordCount(words);
    setLineCount(lines);
  }, [localContent]);

  // Toggle pin status for selected note
  const handleTogglePin = async () => {
    if (!selectedNote) return;
    try {
      await updateNote(selectedNote.id, { is_pinned: !selectedNote.is_pinned });
      setNotes(prev => prev.slice().sort((a,b) => (b.is_pinned?1:0) - (a.is_pinned?1:0)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pin note');
    }
  };

  // Change background color of selected note
  const handleColorChange = async (color: string | null) => {
    if (!selectedNote) return;
    try {
      await updateNote(selectedNote.id, { background_color: color });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set color');
    }
  };

  // Generate or fetch existing share link
  const generateShareLink = async () => {
    if (!selectedNote) return;
    setGeneratingShare(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      // Check existing
      const { data: existing, error: existingErr } = await supabase
        .from('shared_notes')
        .select('id, allow_edit')
        .eq('note_id', selectedNote.id)
        .eq('owner_id', user.id)
        .maybeSingle();
      let shareId: string;
      if (existing && !existingErr) {
        shareId = existing.id as string;
        // If allow_edit changed, update
        if (existing.allow_edit !== allowEditShare) {
          await supabase.from('shared_notes').update({ allow_edit: allowEditShare }).eq('id', shareId);
        }
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from('shared_notes')
          .insert([{ note_id: selectedNote.id, owner_id: user.id, allow_edit: allowEditShare }])
          .select('id')
          .single();
        if (insertErr || !inserted) throw insertErr || new Error('Failed to create share');
        shareId = inserted.id as string;
      }
      const origin = window.location.origin;
      const full = `${origin}/notes/share/${shareId}`;
      setShareLink(full);
      toast({ title: 'Share link ready', description: allowEditShare ? 'Editing enabled' : 'Read-only link created' });
    } catch (e:any) {
      toast({ title: 'Share failed', description: e.message || 'Could not create share link', variant: 'destructive' });
    } finally {
      setGeneratingShare(false);
    }
  };

  const execFormat = (command: string) => {
    document.execCommand(command, false);
    if (activeField === 'title') {
      handleTitleInput();
    } else if (activeField === 'content') {
      handleContentInput();
    } else {
      handleTitleInput();
      handleContentInput();
    }
  };
  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (titleTimeout) clearTimeout(titleTimeout);
      if (contentTimeout) clearTimeout(contentTimeout);
    };
  }, [titleTimeout, contentTimeout]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffInHours < 168) { // 7 days
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const truncateText = (text: string, maxLength: number = 50) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const renderPreviewHTML = (html: string) => {
    // strip tags but keep line breaks by replacing block tags with newline first
    const withBreaks = html
      .replace(/<(div|p|br|li|h[1-6])\b[^>]*>/gi, '\n')
      .replace(/<\/[^>]+>/g, '');
    const cleaned = withBreaks
      .replace(/\n{3,}/g, '\n\n') // collapse excess
      .trim();
    const shortened = cleaned.length > 300 ? cleaned.slice(0,300) + '…' : cleaned;
    // convert remaining newlines to <br/>
    return shortened.replace(/\n/g, '<br/>');
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar 
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        
        <div className="flex-1 lg:ml-0">
          {/* Mobile Header */}
          {isMobileView && (
            <div className="flex items-center justify-between p-4 border-b border-border bg-background">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowNoteList(!showNoteList)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <h1 className="font-heading font-bold text-lg">Notes</h1>
              <Button
                size="sm"
                onClick={createNote}
                disabled={loading}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="flex h-[calc(100vh-4rem)]">
            {/* Notes List Pane */}
            <div className={`
              ${isMobileView 
                ? (showNoteList ? 'w-full' : 'hidden') 
                : 'w-80 border-r border-border'
              }
              flex flex-col bg-card
            `}>
              {/* Desktop Header */}
              {!isMobileView && (
                <div className="p-4 border-b border-border">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-foreground">Notes</h2>
                    <Button
                      size="sm"
                      onClick={createNote}
                      disabled={loading}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      New
                    </Button>
                  </div>
                </div>
              )}

              {/* Notes List */}
              <div className="flex-1 overflow-y-auto">
                {error && (
                  <div className="m-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                    {error}
                  </div>
                )}

                {loading ? (
                  <div className="p-4 text-center">
                    <p className="text-muted-foreground">Loading notes...</p>
                  </div>
                ) : notes.length === 0 ? (
                  <div className="p-4 text-center">
                    <p className="text-muted-foreground mb-4">No notes yet</p>
                    <Button onClick={createNote} size="sm">
                      <Plus className="h-4 w-4 mr-1" />
                      Create your first note
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1 p-2">
                    {notes.map((note) => (
                      <div
                        key={note.id}
                        onClick={() => {
                          setSelectedNote(note);
                          if (isMobileView) setShowNoteList(false);
                        }}
                        className={`
                          p-3 rounded-lg cursor-pointer transition-colors
                          ${selectedNote?.id === note.id ? 'ring-2 ring-primary' : 'hover:bg-muted'}
                          ${note.background_color ? 'text-neutral-900 dark:text-neutral-900' : ''}
                        `}
                        style={{ backgroundColor: note.background_color || undefined }}
                      >
                        <div className="font-medium truncate flex items-center gap-2">
                          {note.title === 'Inbox' ? (
                            <Lightbulb className="h-3 w-3 text-amber-500" />
                          ) : note.is_pinned ? (
                            <Pin className="h-3 w-3 text-primary" />
                          ) : null}
                          <span
                            className="truncate"
                            dangerouslySetInnerHTML={{ __html: note.title || 'Untitled' }}
                          />
                        </div>
                        <div
                          className={`text-sm mt-1 whitespace-pre-wrap line-clamp-3 ${note.background_color ? 'text-gray-600 dark:text-gray-700' : 'text-muted-foreground'}`}
                          dangerouslySetInnerHTML={{ __html: renderPreviewHTML(note.content || '') }}
                        />
                        <div className={`text-xs mt-2 ${note.background_color ? 'text-gray-500 dark:text-gray-600' : 'text-muted-foreground'}`}>
                          {formatDate(note.updated_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Note Editor Pane */}
            <div className={`
              ${isMobileView 
                ? (showNoteList ? 'hidden' : 'flex-1') 
                : 'flex-1'
              }
              flex flex-col
            `}>
              {selectedNote ? (
                <>
                  {/* Editor Header */}
                  <div className="p-4 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {isSaving && <span>Saving...</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={handleTogglePin} className={selectedNote.is_pinned ? 'text-primary' : ''} title={selectedNote.is_pinned ? 'Unpin' : 'Pin note'}>
                        <Pin className={`h-4 w-4 ${selectedNote.is_pinned ? 'fill-current' : ''}`} />
                      </Button>
                      <Popover open={showPalette} onOpenChange={setShowPalette}>
                        <PopoverTrigger asChild>
                          <Button size="sm" variant="ghost" title="Change color">
                            <Palette className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-52">
                          <div className="grid grid-cols-6 gap-2">
                            {[
                              { label: 'None', value: null },
                              { label: 'Yellow', value: '#FEF3C7' },
                              { label: 'Green', value: '#DCFCE7' },
                              { label: 'Blue', value: '#DBEAFE' },
                              { label: 'Purple', value: '#EDE9FE' },
                              { label: 'Pink', value: '#FCE7F3' },
                              { label: 'Orange', value: '#FFEDD5' },
                              { label: 'Gray', value: '#F3F4F6' },
                            ].map(c => (
                              <button
                                key={c.label}
                                title={c.label}
                                onClick={() => handleColorChange(c.value)}
                                className={`w-7 h-7 rounded-full border shadow-sm transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary ${selectedNote.background_color === c.value || (!selectedNote.background_color && c.value === null) ? 'ring-2 ring-primary' : ''}`}
                                style={{ backgroundColor: c.value || '#ffffff' }}
                              />
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteNote(selectedNote.id)}
                        className="text-destructive hover:text-destructive"
                        title="Delete note"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
                        <DialogTrigger asChild>
                          <Button size="sm" variant="ghost" title="Share note">
                            <Share2 className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                          <DialogHeader>
                            <DialogTitle>Share Note</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4 py-2">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium">Allow editing</p>
                                <p className="text-xs text-muted-foreground">Others can change this note</p>
                              </div>
                              <Switch checked={allowEditShare} onCheckedChange={v => setAllowEditShare(!!v)} />
                            </div>
                            <Button size="sm" onClick={generateShareLink} disabled={generatingShare || !selectedNote} className="w-full">
                              {generatingShare ? 'Generating...' : 'Create / Update Share Link'}
                            </Button>
                            {shareLink && (
                              <div className="space-y-2">
                                <label className="text-xs font-medium text-muted-foreground">Share URL</label>
                                <div className="flex gap-2">
                                  <Input readOnly value={shareLink} className="text-xs" />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      navigator.clipboard.writeText(shareLink);
                                      toast({ title: 'Copied link to clipboard' });
                                    }}
                                  >
                                    <Check className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>

                  {/* Editor Content */}
                  <div className={`flex-1 p-4 space-y-4 flex flex-col ${selectedNote.background_color ? 'text-neutral-900 dark:text-neutral-900' : ''}`} style={{ backgroundColor: selectedNote.background_color || undefined }}>
                    <div
                      ref={titleRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={handleTitleInput}
                      onFocus={() => setActiveField('title')}
                      className="text-2xl font-semibold focus:outline-none px-1"
                      data-placeholder="Note title..."
                      aria-label="Note title"
                    />
                    <div
                      id="rich-editor"
                      ref={contentRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={handleContentInput}
                      onFocus={() => setActiveField('content')}
                      className="note-preview flex-1 border-none focus:outline-none text-base leading-relaxed min-h-[calc(100vh-320px)] px-1 whitespace-pre-wrap"
                      aria-label="Note content"
                    />
                    {/* Formatting toolbar + status bar */}
                    <div className="flex items-center justify-between pt-2 border-t border-border text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => execFormat('bold')} title="Bold (Ctrl+B)">
                          <Bold className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => execFormat('italic')} title="Italic (Ctrl+I)">
                          <Italic className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => execFormat('underline')} title="Underline (Ctrl+U)">
                          <Underline className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => execFormat('insertUnorderedList')} title="Bullet List">
                          <List className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="px-2 tabular-nums select-none">
                        Words: {wordCount} | Lines: {lineCount}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <p className="text-muted-foreground mb-4">
                      {notes.length === 0 
                        ? 'Create your first note to get started'
                        : 'Select a note to start editing'
                      }
                    </p>
                    {notes.length === 0 && (
                      <Button onClick={createNote}>
                        <Plus className="h-4 w-4 mr-2" />
                        Create Note
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Notes;
