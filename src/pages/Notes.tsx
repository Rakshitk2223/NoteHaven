import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import AppSidebar from "@/components/AppSidebar";
import { supabase } from "@/integrations/supabase/client";

interface Note {
  id: number;
  user_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

const Notes = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobileView, setIsMobileView] = useState(false);
  const [showNoteList, setShowNoteList] = useState(false);
  
  // Auto-save states
  const [titleValue, setTitleValue] = useState("");
  const [contentValue, setContentValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);

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
      setTitleValue(selectedNote.title);
      setContentValue(selectedNote.content);
    } else {
      setTitleValue("");
      setContentValue("");
    }
  }, [selectedNote]);

  const fetchNotes = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) {
        throw error;
      }

      setNotes(data || []);
      
      // Select the first note by default
      if (data && data.length > 0 && !selectedNote) {
        setSelectedNote(data[0]);
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
      setTitleValue(data.title);
      setContentValue(data.content);
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

      // Update the note in the local state
      setNotes(prevNotes => 
        prevNotes.map(note => 
          note.id === noteId 
            ? { ...note, ...updates, updated_at: new Date().toISOString() }
            : note
        )
      );

      // Update selected note if it's the one being edited
      if (selectedNote && selectedNote.id === noteId) {
        setSelectedNote(prev => prev ? { ...prev, ...updates, updated_at: new Date().toISOString() } : null);
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
  const debouncedSaveTitle = useCallback((value: string) => {
    if (titleTimeout) {
      clearTimeout(titleTimeout);
    }

    const timeout = setTimeout(() => {
      if (selectedNote && value !== selectedNote.title) {
        setIsSaving(true);
        updateNote(selectedNote.id, { title: value }).finally(() => setIsSaving(false));
      }
    }, 1500);

    setTitleTimeout(timeout);
  }, [selectedNote, titleTimeout]);

  const debouncedSaveContent = useCallback((value: string) => {
    if (contentTimeout) {
      clearTimeout(contentTimeout);
    }

    const timeout = setTimeout(() => {
      if (selectedNote && value !== selectedNote.content) {
        setIsSaving(true);
        updateNote(selectedNote.id, { content: value }).finally(() => setIsSaving(false));
      }
    }, 1500);

    setContentTimeout(timeout);
  }, [selectedNote, contentTimeout]);

  // Handle title change
  const handleTitleChange = (value: string) => {
    setTitleValue(value);
    debouncedSaveTitle(value);
  };

  // Handle content change
  const handleContentChange = (value: string) => {
    setContentValue(value);
    debouncedSaveContent(value);
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
                          ${selectedNote?.id === note.id
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-muted'
                          }
                        `}
                      >
                        <div className="font-medium truncate">
                          {note.title || 'Untitled'}
                        </div>
                        <div className={`text-sm truncate mt-1 ${
                          selectedNote?.id === note.id ? 'text-primary-foreground/70' : 'text-muted-foreground'
                        }`}>
                          {truncateText(note.content)}
                        </div>
                        <div className={`text-xs mt-2 ${
                          selectedNote?.id === note.id ? 'text-primary-foreground/50' : 'text-muted-foreground'
                        }`}>
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
                    <div className="flex items-center gap-2">
                      {isSaving && (
                        <div className="text-xs text-muted-foreground">
                          Saving...
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteNote(selectedNote.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Editor Content */}
                  <div className="flex-1 p-4 space-y-4">
                    <Input
                      value={titleValue}
                      onChange={(e) => handleTitleChange(e.target.value)}
                      placeholder="Note title..."
                      className="text-xl font-semibold border-none shadow-none focus-visible:ring-0 px-0"
                    />
                    <Textarea
                      value={contentValue}
                      onChange={(e) => handleContentChange(e.target.value)}
                      placeholder="Start writing your note..."
                      className="flex-1 border-none shadow-none focus-visible:ring-0 resize-none text-base leading-relaxed px-0"
                      style={{ minHeight: 'calc(100vh - 300px)' }}
                    />
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
