import { useState, useEffect, useCallback, useRef, type CSSProperties } from "react";
import { useLocation } from "react-router-dom";
import { Plus, Trash2, Menu, Pin, Bold, Italic, Underline as UnderlineIcon, Palette, Lightbulb, List, Share2, Check, ListOrdered, Search, X, Undo, Redo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
// Markdown-based editor now replaces previous contentEditable implementation
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
// Removed Textarea split-view in favor of Tiptap WYSIWYG
import AppSidebar from "@/components/AppSidebar";
import { supabase } from "@/integrations/supabase/client";
import { cn, getContrastTextColor } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
// Removed markdown rendering libraries; now storing & rendering raw HTML
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Gapcursor from '@tiptap/extension-gapcursor';
// Markdown conversion utilities removed with HTML-only pivot

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

// HTML-only persistence: any legacy markdown handling removed

const Notes = () => {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobileView, setIsMobileView] = useState(false);
  const [showNoteList, setShowNoteList] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  
  // Local editor states (HTML persistence)
  const [titleValue, setTitleValue] = useState("");
  const [contentValue, setContentValue] = useState(""); // HTML string persisted
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [lineCount, setLineCount] = useState(0);
  const [lastServerUpdate, setLastServerUpdate] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [notesPerPage] = useState(50); // Pagination: load 50 notes at a time
  const [currentPage, setCurrentPage] = useState(1);
  const { toast } = useToast();
  // Sharing state
  const [shareOpen, setShareOpen] = useState(false);
  const [allowEditShare, setAllowEditShare] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [generatingShare, setGeneratingShare] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<Note | null>(null);
  // Semantic note categories with theme-integrated styling (Microsoft Sticky Notes inspired)
  const noteCategories = [
    { 
      label: 'Default', 
      value: null, 
      icon: '📝',
      description: 'No color',
      borderColor: 'transparent',
      bgLight: 'transparent',
      bgDark: 'transparent'
    },
    { 
      label: 'Yellow', 
      value: 'yellow', 
      icon: '💛',
      description: 'Ideas & notes',
      borderColor: '#F59E0B',
      bgLight: 'rgba(253, 224, 71, 0.2)',
      bgDark: 'rgba(161, 98, 7, 0.25)'
    },
    { 
      label: 'Green', 
      value: 'green', 
      icon: '💚',
      description: 'Tasks & success',
      borderColor: '#10B981',
      bgLight: 'rgba(134, 239, 172, 0.25)',
      bgDark: 'rgba(6, 95, 70, 0.3)'
    },
    { 
      label: 'Blue', 
      value: 'blue', 
      icon: '💙',
      description: 'Information',
      borderColor: '#3B82F6',
      bgLight: 'rgba(147, 197, 253, 0.25)',
      bgDark: 'rgba(30, 64, 175, 0.3)'
    },
    { 
      label: 'Purple', 
      value: 'purple', 
      icon: '💜',
      description: 'Creative ideas',
      borderColor: '#A855F7',
      bgLight: 'rgba(216, 180, 254, 0.25)',
      bgDark: 'rgba(107, 33, 168, 0.3)'
    },
    { 
      label: 'Pink', 
      value: 'pink', 
      icon: '💗',
      description: 'Important',
      borderColor: '#EC4899',
      bgLight: 'rgba(251, 207, 232, 0.3)',
      bgDark: 'rgba(131, 24, 67, 0.3)'
    },
    { 
      label: 'Red', 
      value: 'red', 
      icon: '❤️',
      description: 'Urgent',
      borderColor: '#EF4444',
      bgLight: 'rgba(254, 202, 202, 0.3)',
      bgDark: 'rgba(127, 29, 29, 0.35)'
    },
    { 
      label: 'Orange', 
      value: 'orange', 
      icon: '🧡',
      description: 'Reminders',
      borderColor: '#F97316',
      bgLight: 'rgba(254, 215, 170, 0.3)',
      bgDark: 'rgba(124, 45, 18, 0.35)'
    },
    { 
      label: 'Gray', 
      value: 'gray', 
      icon: '🩶',
      description: 'Archive',
      borderColor: '#6B7280',
      bgLight: 'rgba(229, 231, 235, 0.4)',
      bgDark: 'rgba(55, 65, 81, 0.3)'
    }
  ];

  // Get category styling for a note
  const getCategoryStyle = (category: string | null) => {
    const cat = noteCategories.find(c => c.value === category);
    if (!cat || !cat.value) {
      return {
        borderLeft: '4px solid transparent',
        backgroundColor: 'transparent'
      };
    }
    
    const isDark = document.documentElement.classList.contains('dark');
    return {
      borderLeft: `4px solid ${cat.borderColor}`,
      backgroundColor: isDark ? cat.bgDark : cat.bgLight
    };
  };

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

  // Initialize Tiptap editor (v2) once (HTML internal & persisted)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false }),
      Underline,
      Gapcursor,
    ],
    editable: true,
    content: '',
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
    if (html !== contentValue) handleContentChange(html);
    }
  });
  editorRef.current = editor;

  // Load selected note into editor (HTML direct)
  useEffect(() => {
    if (!editor) return;
    
    // Save any pending changes before switching notes
    if (titleTimeout) {
      clearTimeout(titleTimeout);
      setTitleTimeout(null);
    }
    if (contentTimeout) {
      clearTimeout(contentTimeout);
      setContentTimeout(null);
    }
    
    if (selectedNote) {
      const title = selectedNote.title || '';
    const html = selectedNote.content || '';
    setTitleValue(title);
    setContentValue(html);
    setLastServerUpdate(selectedNote.updated_at);
    editor.commands.setContent(html);
    } else {
      setTitleValue('');
      setContentValue('');
      setLastServerUpdate(null);
      editor.commands.clearContent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNote, editor]);

  // If URL has ?note=ID, select that note once notes are loaded
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const noteIdParam = params.get('note');
    if (!noteIdParam || notes.length === 0) return;
    const targetId = Number(noteIdParam);
    if (!Number.isFinite(targetId)) return;
    const target = notes.find(n => n.id === targetId);
    if (target) {
      setSelectedNote(target);
      // If on mobile, ensure editor is shown
      setShowNoteList(false);
    }
  }, [location.search, notes]);

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
  setTitleValue(data.title || "");
  setContentValue(data.content || "");
  editor?.commands.setContent(data.content || '');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create note';
      setError(message);
      toast({ title: 'Error', description: 'Failed to create note.', variant: 'destructive' });
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
      const message = err instanceof Error ? err.message : 'Failed to update note';
      setError(message);
      toast({ title: 'Error', description: 'Failed to update note.', variant: 'destructive' });
    }
  };

  const deleteNote = async (noteId: number) => {
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
      
      toast({ title: 'Note deleted', description: 'The note has been permanently deleted.' });
      setDeleteConfirmOpen(false);
      setNoteToDelete(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete note';
      setError(message);
      toast({ title: 'Error', description: 'Failed to delete note.', variant: 'destructive' });
    }
  };

  const confirmDeleteNote = (note: Note) => {
    setNoteToDelete(note);
    setDeleteConfirmOpen(true);
  };

  // Debounced auto-save functions
  const saveField = useCallback(async (noteId: number, field: 'title' | 'content', value: string, previous: string) => {
    try {
      setIsSaving(true);
      
      // Check for conflicts before saving (if we have a last known server update time)
      if (lastServerUpdate) {
        const { data: serverNote, error: checkError } = await supabase
          .from('notes')
          .select('updated_at, title, content')
          .eq('id', noteId)
          .single();
        
        if (!checkError && serverNote) {
          const serverTime = new Date(serverNote.updated_at).getTime();
          const localTime = new Date(lastServerUpdate).getTime();
          
          // Only show conflict if server was updated AND the content actually differs
          // This prevents false positives from our own saves
          if (serverTime > localTime) {
            const hasRealConflict = field === 'title' 
              ? serverNote.title !== previous 
              : serverNote.content !== previous;
              
            if (hasRealConflict) {
              // Just show a toast notification instead of blocking confirmation
              toast({ 
                title: 'Note conflict detected', 
                description: 'This note was modified elsewhere. Saving your changes anyway.', 
                variant: 'default' 
              });
              // Continue with save
            }
          }
        }
      }
      
      const { error } = await supabase.from('notes').update({ [field]: value }).eq('id', noteId);
      if (error) throw error;
      const now = new Date().toISOString();
      setLastServerUpdate(now);
  // Update list & selected note with new field value so previews stay fresh
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, [field]: value, updated_at: now } : n));
      setSelectedNote(prev => prev && prev.id === noteId ? { ...prev, [field]: value, updated_at: now } : prev);
    } catch (e:any) {
      // Revert field in list (do NOT touch local editor state; user keeps typing)
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, [field]: previous } : n));
      toast({ title: 'Save failed', description: e.message || 'Could not save note', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [toast, lastServerUpdate, editor]);

  const scheduleTitleSave = useCallback((noteId: number, newValue: string, previous: string) => {
    if (titleTimeout) clearTimeout(titleTimeout);
    const timeout = setTimeout(() => saveField(noteId, 'title', newValue, previous), 2000);
    setTitleTimeout(timeout);
  }, [titleTimeout, saveField]);

  const scheduleContentSave = useCallback((noteId: number, newValue: string, previous: string) => {
    if (contentTimeout) clearTimeout(contentTimeout);
    const timeout = setTimeout(() => saveField(noteId, 'content', newValue, previous), 2000);
    setContentTimeout(timeout);
  }, [contentTimeout, saveField]);

  const handleTitleChange = (val: string) => {
    setTitleValue(val);
    if (selectedNote) {
      const previous = selectedNote.title || '';
      if (val !== previous) scheduleTitleSave(selectedNote.id, val, previous);
    }
  };

  const handleContentChange = (html: string) => {
    setContentValue(html);
    if (selectedNote) {
      const previous = selectedNote.content || '';
      if (html !== previous) scheduleContentSave(selectedNote.id, html, previous);
    }
    if (editor && editor.getHTML() !== html) {
      editor.commands.setContent(html);
    }
  };

  // Word & line count calculation
  useEffect(() => {
    // Strip HTML tags to compute word count
    const text = contentValue
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ') // tags
      .replace(/&nbsp;/g, ' ') // entities
      .replace(/&amp;/g, '&');
    const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
    // Approximate line count: treat block tags & br as breaks
    const lineText = contentValue
      .replace(/<(p|div|br|li|h[1-6])[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    const lines = lineText === '' ? 0 : lineText.split(/\n+/).length;
    setWordCount(words);
    setLineCount(lines);
  }, [contentValue]);

  // Toggle pin status for selected note
  const handleTogglePin = async () => {
    if (!selectedNote) return;
    try {
      await updateNote(selectedNote.id, { is_pinned: !selectedNote.is_pinned });
      setNotes(prev => prev.slice().sort((a,b) => (b.is_pinned?1:0) - (a.is_pinned?1:0)));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to pin note';
      setError(message);
      toast({ title: 'Error', description: 'Failed to pin/unpin note.', variant: 'destructive' });
    }
  };

  // Change category of selected note
  const handleCategoryChange = async (category: string | null) => {
    if (!selectedNote) return;
    try {
      await updateNote(selectedNote.id, { background_color: category });
      toast({ 
        title: 'Category updated', 
        description: `Note marked as ${category || 'default'}`,
        variant: 'default' 
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to set category';
      setError(message);
      toast({ title: 'Error', description: 'Failed to change category.', variant: 'destructive' });
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

  // Tiptap toolbar helpers
  const run = (cb: (e: any) => any) => () => { if (editor) { editor.chain().focus(); cb(editor); } };
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

  // Sanitize HTML for preview display (removes scripts and dangerous attributes)
  const sanitizePreview = (html: string) => {
    const text = html
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
      .replace(/on\w+="[^"]*"/gi, '')
      .replace(/on\w+='[^']*'/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/<object[\s\S]*?<\/object>/gi, '')
      .replace(/<embed[\s\S]*?>/gi, '');
    return text;
  };

  // Filter notes based on search query
  const filteredNotes = notes.filter(note => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const title = (note.title || '').toLowerCase();
    const contentText = (note.content || '')
      .replace(/<[^>]+>/g, ' ')
      .toLowerCase();
    return title.includes(query) || contentText.includes(query);
  });

  // Paginate filtered notes
  const totalPages = Math.ceil(filteredNotes.length / notesPerPage);
  const paginatedNotes = filteredNotes.slice(
    (currentPage - 1) * notesPerPage,
    currentPage * notesPerPage
  );

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

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
            <div className="sticky top-0 z-30 flex items-center justify-between p-3 sm:p-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  className="touch-manipulation"
                  title="Main menu"
                >
                  <Menu className="h-5 w-5" />
                </Button>
                {showNoteList && (
                  <span className="text-muted-foreground text-sm">|</span>
                )}
                <Button
                  variant={showNoteList ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setShowNoteList(!showNoteList)}
                  className="touch-manipulation"
                  title="Toggle notes list"
                >
                  <List className="h-5 w-5" />
                </Button>
              </div>
              <h1 className="font-heading font-bold text-base sm:text-lg">{showNoteList ? 'All Notes' : (selectedNote?.title || 'Notes')}</h1>
              <Button
                size="sm"
                onClick={createNote}
                disabled={loading}
                className="touch-manipulation"
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
                : 'w-72 md:w-80 lg:w-96 border-r border-border'
              }
              flex flex-col bg-card
            `}>
              {/* Desktop Header */}
              {!isMobileView && (
                <div className="p-3 md:p-4 border-b border-border sticky top-0 bg-card z-10">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-base md:text-lg font-semibold text-foreground">Notes</h2>
                    <Button
                      size="sm"
                      onClick={createNote}
                      disabled={loading}
                      className="touch-manipulation"
                    >
                      <Plus className="h-4 w-4 md:mr-1" />
                      <span className="hidden md:inline">New</span>
                    </Button>
                  </div>
                  {/* Search Bar */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search notes..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 pr-8 text-sm"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground touch-manipulation"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
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
                  <div className="p-4 space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="p-3 rounded-lg border">
                        <Skeleton className="h-4 w-40 mb-2" />
                        <Skeleton className="h-3 w-full mb-1" />
                        <Skeleton className="h-3 w-5/6" />
                      </div>
                    ))}
                  </div>
                ) : notes.length === 0 ? (
                  <div className="p-4 text-center">
                    <p className="text-muted-foreground mb-4">No notes yet</p>
                    <Button onClick={createNote} size="sm">
                      <Plus className="h-4 w-4 mr-1" />
                      Create your first note
                    </Button>
                  </div>
                ) : filteredNotes.length === 0 ? (
                  <div className="p-4 text-center">
                    <Search className="h-12 w-12 mx-auto mb-2 text-muted-foreground/50" />
                    <p className="text-muted-foreground mb-2">No notes found</p>
                    <p className="text-sm text-muted-foreground">Try a different search term</p>
                    <Button onClick={() => setSearchQuery('')} size="sm" variant="ghost" className="mt-2">
                      Clear search
                    </Button>
                  </div>
                ) : (
                  <motion.div
                    className="space-y-1 p-2 w-full"
                    initial="hidden"
                    animate="show"
                    variants={{ 
                      hidden: { opacity: 0 }, 
                      show: { 
                        opacity: 1, 
                        transition: { 
                          staggerChildren: 0.04,
                          delayChildren: 0.1
                        } 
                      } 
                    }}
                  >
                    {paginatedNotes.map((note) => (
                      <motion.div
                        key={note.id}
                        onClick={() => {
                          setSelectedNote(note);
                          if (isMobileView) setShowNoteList(false);
                        }}
                        className={`
                          p-3 rounded-lg cursor-pointer transition-all duration-200 ease-out
                          ${selectedNote?.id === note.id ? 'ring-2 ring-primary shadow-md' : 'hover:bg-muted hover:shadow-sm'}
                          max-w-full overflow-hidden
                        `}
                        style={getCategoryStyle(note.background_color)}
                        variants={{ 
                          hidden: { opacity: 0, y: 8, scale: 0.98 }, 
                          show: { 
                            opacity: 1, 
                            y: 0, 
                            scale: 1,
                            transition: {
                              duration: 0.3,
                              ease: [0.4, 0, 0.2, 1]
                            }
                          } 
                        }}
                        whileHover={{ scale: 1.01, transition: { duration: 0.15 } }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <div className="font-semibold truncate flex items-center gap-2 min-w-0">
                          {note.title === 'Inbox' ? (
                            <Lightbulb className="h-3 w-3 text-amber-500 flex-shrink-0" />
                          ) : note.is_pinned ? (
                            <Pin className="h-3 w-3 text-primary flex-shrink-0" />
                          ) : null}
                          <span className="truncate min-w-0">{truncateText(note.title || 'Untitled', 80)}</span>
                        </div>
                        <div 
                          className="text-sm mt-1 line-clamp-3 text-foreground/80 prose dark:prose-invert max-w-none break-words overflow-hidden" 
                          style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                          dangerouslySetInnerHTML={{ __html: sanitizePreview(note.content || '') }} 
                        />
                        <div className="text-xs mt-2 text-foreground/60">
                          {formatDate(note.updated_at)}
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
                
                {/* Pagination Controls */}
                {filteredNotes.length > notesPerPage && (
                  <div className="p-4 border-t border-border flex items-center justify-between text-xs">
                    <div className="text-muted-foreground">
                      Showing {((currentPage - 1) * notesPerPage) + 1}-{Math.min(currentPage * notesPerPage, filteredNotes.length)} of {filteredNotes.length}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <div className="px-2">
                        Page {currentPage} of {totalPages}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                      >
                        Next
                      </Button>
                    </div>
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
                  {/* Editor Header (title + actions) */}
                  <div
                    className="sticky top-0 z-20 p-3 sm:p-4 border-b border-border flex items-center justify-between gap-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
                  >
                    <Input
                      value={titleValue}
                      onChange={(e) => handleTitleChange(e.target.value)}
                      placeholder="Note title..."
                      className="text-base sm:text-lg md:text-xl font-semibold border-0 focus-visible:ring-0 px-0"
                    />
                    <div className="flex items-center gap-0.5 sm:gap-1 ml-2 flex-shrink-0">
                      <div className="flex items-center gap-2 text-xs">
                        {isSaving && <span>Saving...</span>}
                      </div>
                      <Button size="sm" variant="ghost" onClick={handleTogglePin} title={selectedNote.is_pinned ? 'Unpin' : 'Pin note'}>
                        <Pin className="h-4 w-4" />
                      </Button>
                      <Popover open={showPalette} onOpenChange={setShowPalette}>
                        <PopoverTrigger asChild>
                          <Button size="sm" variant="ghost" title="Change color">
                            <Palette className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-80">
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Note Color</p>
                            <div className="grid grid-cols-3 gap-2">
                              {noteCategories.map(cat => {
                                const isDark = document.documentElement.classList.contains('dark');
                                const isSelected = selectedNote?.background_color === cat.value;
                                return (
                                  <button
                                    key={cat.value || 'default'}
                                    onClick={() => {
                                      handleCategoryChange(cat.value);
                                      setShowPalette(false);
                                    }}
                                    className={cn(
                                      "flex items-center gap-2 px-3 py-2.5 rounded-lg transition-all text-left border-2",
                                      "hover:scale-105 hover:shadow-md",
                                      isSelected ? "border-primary ring-2 ring-primary/20 scale-105 shadow-md" : "border-transparent"
                                    )}
                                    style={{
                                      backgroundColor: cat.value ? (isDark ? cat.bgDark : cat.bgLight) : 'transparent',
                                      borderLeftWidth: '4px',
                                      borderLeftColor: cat.borderColor
                                    }}
                                  >
                                    <span className="text-xl">{cat.icon}</span>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium truncate">{cat.label}</p>
                                      <p className="text-xs text-muted-foreground truncate">{cat.description}</p>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => selectedNote && confirmDeleteNote(selectedNote)}
                        className="hover:text-destructive"
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

                  {/* Editor Content - Tiptap WYSIWYG */}
                  <div className="flex-1 p-2 sm:p-4 flex flex-col gap-3">
                    <div className="flex-1 flex flex-col border rounded-md overflow-hidden min-h-[calc(100vh-280px)] sm:min-h-[calc(100vh-320px)]">
                      <div className="sticky top-0 bg-background z-10 flex items-center gap-0.5 sm:gap-1 flex-wrap border-b border-border p-1 text-xs">
                        <Button size="sm" variant={editor?.isActive('bold') ? 'default' : 'ghost'} onClick={() => editor?.chain().focus().toggleBold().run()} title="Bold (Ctrl+B)" className="h-8 w-8 sm:h-9 sm:w-9 p-0 touch-manipulation"><Bold className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></Button>
                        <Button size="sm" variant={editor?.isActive('italic') ? 'default' : 'ghost'} onClick={() => editor?.chain().focus().toggleItalic().run()} title="Italic (Ctrl+I)" className="h-8 w-8 sm:h-9 sm:w-9 p-0 touch-manipulation"><Italic className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></Button>
                        <Button size="sm" variant={editor?.isActive('underline') ? 'default' : 'ghost'} onClick={() => editor?.chain().focus().toggleUnderline().run()} title="Underline (Ctrl+U)" className="h-8 w-8 sm:h-9 sm:w-9 p-0 touch-manipulation"><UnderlineIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></Button>
                        <div className="w-px h-4 sm:h-5 bg-border mx-0.5 sm:mx-1" />
                        <Button size="sm" variant={editor?.isActive('bulletList') ? 'default' : 'ghost'} onClick={() => editor?.chain().focus().toggleBulletList().run()} title="Bullet List" className="h-8 w-8 sm:h-9 sm:w-9 p-0 touch-manipulation"><List className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></Button>
                        <Button size="sm" variant={editor?.isActive('orderedList') ? 'default' : 'ghost'} onClick={() => editor?.chain().focus().toggleOrderedList().run()} title="Ordered List" className="h-8 w-8 sm:h-9 sm:w-9 p-0 touch-manipulation"><ListOrdered className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></Button>
                        <div className="w-px h-4 sm:h-5 bg-border mx-0.5 sm:mx-1" />
                        <Button size="sm" variant="ghost" onClick={() => editor?.chain().focus().undo().run()} disabled={!editor?.can().undo()} title="Undo (Ctrl+Z)" className="h-8 w-8 sm:h-9 sm:w-9 p-0 touch-manipulation"><Undo className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => editor?.chain().focus().redo().run()} disabled={!editor?.can().redo()} title="Redo (Ctrl+Y)" className="h-8 w-8 sm:h-9 sm:w-9 p-0 touch-manipulation"><Redo className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></Button>
                      </div>
                      <div className="flex-1 overflow-y-auto p-3 sm:p-4 flex">
                        {editor && (
                          <EditorContent
                            editor={editor}
                            className="prose max-w-none focus:outline-none flex-1 dark:prose-invert"
                          />
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-2 pt-2 border-t border-border text-xs text-muted-foreground">
                      <div className="flex items-center gap-2"><span className="hidden sm:inline">Autosave every 5s</span><span className="sm:hidden">Autosave</span></div>
                      <div className="px-2 tabular-nums select-none">Words: {wordCount}<span className="hidden sm:inline"> | Lines: {lineCount}</span></div>
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
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Note?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{noteToDelete?.title || 'Untitled'}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => noteToDelete && deleteNote(noteToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Notes;
