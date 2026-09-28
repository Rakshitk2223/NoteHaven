import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CompactTagSelector } from '@/components/CompactTagSelector';
import type { Tag } from '@/lib/tags';
import { type MediaFormData, type MediaItem, READABLE_TYPES, WATCHABLE_TYPES } from './types';

interface MediaEditFormProps {
  formData: MediaFormData;
  setFormData: Dispatch<SetStateAction<MediaFormData>>;
  onSubmit: (e: FormEvent) => void;
  tags: Tag[];
  availableTags: Tag[];
  onTagsChange: (tags: Tag[]) => void;
}

/** The detail drawer's add/edit form (moved out of MediaTracker.tsx unchanged). */
export function MediaEditForm({ formData, setFormData, onSubmit, tags, availableTags, onTagsChange }: MediaEditFormProps) {
  const showSeasonEpisode = WATCHABLE_TYPES.includes(formData.type);
  const showChapter = READABLE_TYPES.includes(formData.type);
  return (
    <form id="media-details-form" onSubmit={onSubmit} className="space-y-4">
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
              {READABLE_TYPES.includes(formData.type) ? (
                <>
                  <SelectItem value="Reading">Reading</SelectItem>
                  <SelectItem value="Plan to Read">Plan to Read</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                </>
              ) : WATCHABLE_TYPES.includes(formData.type) || formData.type === 'Movie' ? (
                <>
                  <SelectItem value="Watching">Watching</SelectItem>
                  <SelectItem value="Plan to Watch">Plan to Watch</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="Watching">Watching</SelectItem>
                  <SelectItem value="Reading">Reading</SelectItem>
                  <SelectItem value="Plan to Watch">Plan to Watch</SelectItem>
                  <SelectItem value="Plan to Read">Plan to Read</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                </>
              )}
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

      <div className="space-y-2">
        <Label>Tags</Label>
        <CompactTagSelector
          selectedTags={tags}
          availableTags={availableTags}
          onChange={onTagsChange}
          maxTags={5}
        />
      </div>
    </form>
  );
}
