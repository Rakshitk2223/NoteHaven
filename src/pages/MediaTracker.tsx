import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Plus, Edit, Trash2, Star, Filter, Upload, Search, Minus, Download, Plus as PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import AppSidebar from "@/components/AppSidebar";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface MediaItem {
  id: number;
  user_id: string;
  title: string;
  // Restrict to the allowed canonical set while keeping string for legacy DB rows
  type: 'Movie' | 'Series' | 'Anime' | 'Manga' | 'Manhwa' | 'Manhua' | 'KDrama' | 'JDrama' | string;
  status: 'Watching' | 'Completed' | 'Plan to Read' | 'Plan to Watch' | 'Reading' | string;
  rating?: number;
  current_season?: number;
  current_episode?: number;
  current_chapter?: number;
  created_at: string;
  updated_at?: string;
}

const MediaTracker = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MediaItem | null>(null);
  const [filterType, setFilterType] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [formData, setFormData] = useState({
    title: "",
    type: "" as MediaItem['type'],
    status: "" as MediaItem['status'],
    rating: "",
    current_season: "",
    current_episode: "",
    current_chapter: ""
  });
  const [isImporting, setIsImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState(''); // debounced term actually used for query
  const [typedSearchTerm, setTypedSearchTerm] = useState(''); // immediate input echo
  const searchDebounceRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();
  const [updatingIds, setUpdatingIds] = useState<Set<number>>(new Set());

  // Fetch media items on component mount and when filters change
  useEffect(() => {
    fetchMediaItems();
  }, [filterType, filterStatus, searchTerm, sortOrder]);

  const fetchMediaItems = async () => {
    try {
      setLoading(true);
      setError(null);
      
  let query = supabase
        .from('media_tracker')
        .select('*')
        .order('title', { ascending: sortOrder === 'asc' })
        .order('updated_at', { ascending: false });

      // Apply filters
      if (filterType !== 'All') {
        query = query.eq('type', filterType);
      }
      if (filterStatus !== 'All') {
        query = query.eq('status', filterStatus);
      }
      if (searchTerm.trim() !== '') {
        query = query.ilike('title', `%${searchTerm.trim()}%`);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      setMediaItems(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch media items');
    } finally {
      setLoading(false);
    }
  };

  const groupedByStatus = useMemo(() => {
    const groups: Record<string, MediaItem[]> = {};
    mediaItems.forEach(item => {
      const key = item.status || 'Uncategorized';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    const order = ['Watching','Reading','Plan to Watch','Plan to Read','Completed'];
    const keys = Object.keys(groups).sort((a,b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1; if (ib === -1) return -1; return ia - ib;
    });
    return { keys, groups };
  }, [mediaItems]);

  const handleQuickUpdate = async (item: MediaItem, field: 'current_episode' | 'current_chapter', amount: number) => {
    const currentVal = (item as any)[field];
    if (currentVal == null && amount < 0) return;
    const newValue = Math.max((currentVal || 0) + amount, 1);
    setUpdatingIds(prev => new Set(prev).add(item.id));
    try {
      const { error } = await supabase.from('media_tracker').update({ [field]: newValue }).eq('id', item.id);
      if (error) throw error;
      setMediaItems(prev => prev.map(m => m.id === item.id ? { ...m, [field]: newValue } as MediaItem : m));
      toast({ title: 'Updated', description: `${field === 'current_episode' ? 'Episode' : 'Chapter'} set to ${newValue}` });
    } catch (e:any) {
      toast({ title: 'Update failed', description: e.message || 'Error', variant: 'destructive' });
    } finally {
      setUpdatingIds(prev => { const n = new Set(prev); n.delete(item.id); return n; });
    }
  };

  const handleExportJson = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase.from('media_tracker').select('*').eq('user_id', user.id);
      if (error) throw error;
      const json = JSON.stringify(data || [], null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'notehaven_media_export.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast({ title: 'Export started', description: 'Download should begin shortly.' });
    } catch (e:any) {
      toast({ title: 'Export failed', description: e.message || 'Error', variant: 'destructive' });
    }
  };

  const handleCreateMedia = async () => {
    try {
      // Get the current authenticated user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('User not authenticated');
      }

      const mediaData = {
        title: formData.title,
        type: formData.type,
        status: formData.status,
        rating: formData.rating ? parseInt(formData.rating) : null,
        current_season: formData.current_season ? parseInt(formData.current_season) : null,
        current_episode: formData.current_episode ? parseInt(formData.current_episode) : null,
        current_chapter: formData.current_chapter ? parseInt(formData.current_chapter) : null,
        user_id: user.id
      };

      const { error } = await supabase
        .from('media_tracker')
        .insert([mediaData]);

      if (error) {
        throw error;
      }

      setIsModalOpen(false);
      resetForm();
      fetchMediaItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create media item');
    }
  };

  const handleUpdateMedia = async () => {
    if (!editingItem) return;

    try {
      const mediaData = {
        title: formData.title,
        type: formData.type,
        status: formData.status,
        rating: formData.rating ? parseInt(formData.rating) : null,
        current_season: formData.current_season ? parseInt(formData.current_season) : null,
        current_episode: formData.current_episode ? parseInt(formData.current_episode) : null,
        current_chapter: formData.current_chapter ? parseInt(formData.current_chapter) : null
      };

      const { error } = await supabase
        .from('media_tracker')
        .update(mediaData)
        .eq('id', editingItem.id);

      if (error) {
        throw error;
      }

      setIsModalOpen(false);
      setEditingItem(null);
      resetForm();
      fetchMediaItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update media item');
    }
  };

  const handleDeleteMedia = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this media item?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('media_tracker')
        .delete()
        .eq('id', id);

      if (error) {
        throw error;
      }

      setMediaItems(mediaItems.filter(item => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete media item');
    }
  };

  const handleEditMedia = (item: MediaItem) => {
    setEditingItem(item);
    setFormData({
      title: item.title,
      type: item.type,
      status: item.status,
      rating: item.rating?.toString() || "",
      current_season: item.current_season?.toString() || "",
      current_episode: item.current_episode?.toString() || "",
      current_chapter: item.current_chapter?.toString() || ""
    });
    setIsModalOpen(true);
  };

  const resetForm = () => {
    setFormData({
      title: "",
      type: "" as MediaItem['type'],
      status: "" as MediaItem['status'],
      rating: "",
      current_season: "",
      current_episode: "",
      current_chapter: ""
    });
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setEditingItem(null);
    resetForm();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingItem) {
      handleUpdateMedia();
    } else {
      handleCreateMedia();
    }
  };

  const getStatusColor = (status: MediaItem['status']) => {
    switch (status) {
      case 'Watching': return 'bg-blue-100 text-blue-800';
      case 'Completed': return 'bg-green-100 text-green-800';
      case 'Plan to Read': return 'bg-gray-100 text-gray-800';
      case 'Plan to Watch': return 'bg-yellow-100 text-yellow-800';
      case 'Reading': return 'bg-cyan-100 text-cyan-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getTypeColor = (type: MediaItem['type']) => {
    switch (type) {
      case 'Movie': return 'bg-purple-100 text-purple-800';
      case 'Series': return 'bg-indigo-100 text-indigo-800';
      case 'Anime': return 'bg-pink-100 text-pink-800';
      case 'Manga': return 'bg-orange-100 text-orange-800';
      case 'Manhwa': return 'bg-teal-100 text-teal-800';
      case 'Manhua': return 'bg-lime-100 text-lime-800';
      case 'KDrama': return 'bg-rose-100 text-rose-800';
      case 'JDrama': return 'bg-amber-100 text-amber-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Episodic content includes dramas as well
  const showSeasonEpisode = ['Series','Anime','KDrama','JDrama'].includes(formData.type);
  // Chapter based content includes Manga / Manhwa / Manhua
  const showChapter = ['Manga','Manhwa','Manhua'].includes(formData.type);

  // Debounced search handler
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setTypedSearchTerm(value);
    if (searchDebounceRef.current) {
      window.clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = window.setTimeout(() => {
      setSearchTerm(value);
    }, 400);
  };

  // JSON Import handler
  const handleJsonImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      let data: any[] = [];
      try {
        data = JSON.parse(text);
        if (!Array.isArray(data)) throw new Error('JSON root must be an array');
      } catch (e:any) {
        setError(e.message || 'Invalid JSON');
        setIsImporting(false);
        return;
      }
      toast({ title: 'Import started', description: 'Your media is being imported in the background.' });
      const batchSize = 50;
      const successfulImports: any[] = [];
      const failedImports: any[] = [];
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize).map(item => ({
          title: item.title || '',
          type: item.type || 'Movie',
          status: item.status || 'Plan to Read',
          rating: item.rating ?? null,
          current_season: item.current_season ?? null,
          current_episode: item.current_episode ?? null,
          current_chapter: item.current_chapter ?? null,
          user_id: item.user_id || undefined // will be overridden by RLS / server if needed
        }));
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');
        batch.forEach(b => b.user_id = user.id);
        const { error } = await supabase.from('media_tracker').insert(batch);
        if (error) {
          console.error('Batch insert failed', error);
            failedImports.push(...batch);
        } else {
          successfulImports.push(...batch);
        }
      }
      if (failedImports.length === 0) {
        toast({ title: 'Import Complete', description: `${successfulImports.length} items were successfully imported.` });
      } else {
        const failedTitles = failedImports.map(i => i.title).filter(Boolean).slice(0, 20).join(', ');
        toast({ title: 'Import Partially Complete', description: `${successfulImports.length} items imported. ${failedImports.length} failed. Failed titles: ${failedTitles}${failedImports.length>20?', ...':''}`, variant: 'destructive' });
      }
      fetchMediaItems();
    } catch (e:any) {
      console.error('Import error', e);
      setError(e.message || 'Import failed');
      toast({ title: 'Import failed', description: e.message || 'An error occurred', variant: 'destructive' });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AppSidebar 
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        
        <div className="flex-1 lg:ml-0">
          <div className="p-6 border-b border-border">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold font-heading text-foreground">
                Media Tracker
              </h1>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleJsonImport}
                  disabled={isImporting}
                />
                <Button
                  variant="outline"
                  className="zen-transition hover:shadow-md"
                  disabled={isImporting}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {isImporting ? 'Importing...' : 'Import'}
                </Button>
                <Button
                  variant="outline"
                  className="zen-transition hover:shadow-md"
                  onClick={handleExportJson}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
                <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                  <DialogTrigger asChild>
                    <Button className="zen-transition hover:shadow-md">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Media
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>
                      {editingItem ? 'Edit Media' : 'Add New Media'}
                    </DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="title">Title</Label>
                      <Input
                        id="title"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        placeholder="Enter media title"
                        required
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="type">Type</Label>
                        <Select
                          value={formData.type}
                          onValueChange={(value) => setFormData({ ...formData, type: value as MediaItem['type'] })}
                          required
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Movie">Movie</SelectItem>
                            <SelectItem value="Series">Series</SelectItem>
                            <SelectItem value="Anime">Anime</SelectItem>
                            <SelectItem value="Manga">Manga</SelectItem>
                            <SelectItem value="Manhwa">Manhwa</SelectItem>
                            <SelectItem value="Manhua">Manhua</SelectItem>
                            <SelectItem value="KDrama">KDrama</SelectItem>
                            <SelectItem value="JDrama">JDrama</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="status">Status</Label>
                        <Select
                          value={formData.status}
                          onValueChange={(value) => setFormData({ ...formData, status: value as MediaItem['status'] })}
                          required
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Watching">Watching</SelectItem>
                            <SelectItem value="Reading">Reading</SelectItem>
                            <SelectItem value="Completed">Completed</SelectItem>
                            <SelectItem value="Plan to Read">Plan to Read</SelectItem>
                            <SelectItem value="Plan to Watch">Plan to Watch</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="rating">Rating (1-10)</Label>
                      <Input
                        id="rating"
                        type="number"
                        min="1"
                        max="10"
                        value={formData.rating}
                        onChange={(e) => setFormData({ ...formData, rating: e.target.value })}
                        placeholder="Enter rating (optional)"
                      />
                    </div>

                    {showSeasonEpisode && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="current_season">Current Season</Label>
                          <Input
                            id="current_season"
                            type="number"
                            min="1"
                            value={formData.current_season}
                            onChange={(e) => setFormData({ ...formData, current_season: e.target.value })}
                            placeholder="Season number"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="current_episode">Current Episode</Label>
                          <Input
                            id="current_episode"
                            type="number"
                            min="1"
                            value={formData.current_episode}
                            onChange={(e) => setFormData({ ...formData, current_episode: e.target.value })}
                            placeholder="Episode number"
                          />
                        </div>
                      </div>
                    )}
                    {showChapter && (
                      <div className="space-y-2">
                        <Label htmlFor="current_chapter">Current Chapter</Label>
                        <Input
                          id="current_chapter"
                          type="number"
                          min="1"
                          value={formData.current_chapter}
                          onChange={(e) => setFormData({ ...formData, current_chapter: e.target.value })}
                          placeholder="Chapter number"
                        />
                      </div>
                    )}

                    <div className="flex justify-end space-x-2 pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleModalClose}
                      >
                        Cancel
                      </Button>
                      <Button type="submit">
                        {editingItem ? 'Update' : 'Create'}
                      </Button>
                    </div>
                  </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </div>

          <div className="p-6">
            {/* Search Bar */}
            <div className="mb-4 flex items-center gap-2 max-w-md">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search title..."
                value={typedSearchTerm}
                onChange={handleSearchChange}
              />
            </div>
            {error && (
              <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                {error}
              </div>
            )}

            {/* Filters */}
            <div className="mb-6 flex flex-col sm:flex-row gap-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Filters:</span>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex items-center gap-2">
                  <Label htmlFor="type-filter" className="text-sm">Type:</Label>
                  <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All</SelectItem>
                      <SelectItem value="Movie">Movie</SelectItem>
                      <SelectItem value="Series">Series</SelectItem>
                      <SelectItem value="Anime">Anime</SelectItem>
                      <SelectItem value="Manga">Manga</SelectItem>
                      <SelectItem value="Manhwa">Manhwa</SelectItem>
                      <SelectItem value="Manhua">Manhua</SelectItem>
                      <SelectItem value="KDrama">KDrama</SelectItem>
                      <SelectItem value="JDrama">JDrama</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <Label htmlFor="status-filter" className="text-sm">Status:</Label>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All</SelectItem>
                      <SelectItem value="Watching">Watching</SelectItem>
                      <SelectItem value="Reading">Reading</SelectItem>
                      <SelectItem value="Completed">Completed</SelectItem>
                      <SelectItem value="Plan to Read">Plan to Read</SelectItem>
                      <SelectItem value="Plan to Watch">Plan to Watch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="sort-order" className="text-sm">Sort:</Label>
                  <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as 'asc' | 'desc')}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asc">Title A → Z</SelectItem>
                      <SelectItem value="desc">Title Z → A</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="zen-card p-8 text-center">
                <p className="text-muted-foreground">Loading media items...</p>
              </div>
            ) : mediaItems.length === 0 ? (
              <div className="zen-card p-8 text-center">
                <p className="text-muted-foreground mb-4">
                  {filterType !== 'All' || filterStatus !== 'All' 
                    ? 'No media found for the selected filters.' 
                    : 'You haven\'t added any media yet. Click \'Add Media\' to start tracking!'}
                </p>
              </div>
            ) : (
              <div className="space-y-10">
                {groupedByStatus.keys.map(statusKey => (
                  <div key={statusKey}>
                    <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                      <Badge className={getStatusColor(statusKey as MediaItem['status'])}>{statusKey}</Badge>
                      <span className="text-muted-foreground text-sm font-normal">{groupedByStatus.groups[statusKey].length}</span>
                    </h2>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {groupedByStatus.groups[statusKey].map(item => (
                        <div key={item.id} className="zen-card p-6 zen-shadow hover:zen-shadow-lg zen-transition">
                          <div className="flex items-start justify-between mb-3">
                            <Badge className={getTypeColor(item.type)}>{item.type}</Badge>
                            <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                          </div>
                          <h3 className="text-lg font-semibold text-foreground mb-2 truncate">{item.title}</h3>
                          {item.rating && (
                            <div className="flex items-center gap-1 mb-3">
                              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                              <span className="text-sm font-medium">{item.rating}/10</span>
                            </div>
                          )}
                          {(item.current_season || item.current_episode || item.current_chapter) && (
                            <div className="text-sm text-muted-foreground mb-4 space-y-2">
                              {item.current_season && <div>Season {item.current_season}</div>}
                              {item.current_episode && (
                                <div className="flex items-center gap-2">
                                  <span>Episode {item.current_episode}</span>
                                  <div className="flex gap-1">
                                    <Button size="icon" variant="outline" className="h-6 w-6" disabled={updatingIds.has(item.id)} onClick={() => handleQuickUpdate(item,'current_episode',-1)}>
                                      <Minus className="h-3 w-3" />
                                    </Button>
                                    <Button size="icon" variant="outline" className="h-6 w-6" disabled={updatingIds.has(item.id)} onClick={() => handleQuickUpdate(item,'current_episode',1)}>
                                      <PlusIcon className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </div>
                              )}
                              {item.current_chapter && (
                                <div className="flex items-center gap-2">
                                  <span>Chapter {item.current_chapter}</span>
                                  <div className="flex gap-1">
                                    <Button size="icon" variant="outline" className="h-6 w-6" disabled={updatingIds.has(item.id)} onClick={() => handleQuickUpdate(item,'current_chapter',-1)}>
                                      <Minus className="h-3 w-3" />
                                    </Button>
                                    <Button size="icon" variant="outline" className="h-6 w-6" disabled={updatingIds.has(item.id)} onClick={() => handleQuickUpdate(item,'current_chapter',1)}>
                                      <PlusIcon className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          <div className="flex space-x-2">
                            <Button size="sm" variant="outline" onClick={() => handleEditMedia(item)} className="flex-1">
                              <Edit className="h-4 w-4 mr-1" />Edit
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleDeleteMedia(item.id)} className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MediaTracker;
