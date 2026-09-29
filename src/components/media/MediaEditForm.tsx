import { useEffect, useRef, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CompactTagSelector } from '@/components/CompactTagSelector';
import type { Tag } from '@/lib/tags';
import { type MediaFormData, type MediaItem, PLATFORM_SUGGESTIONS, READABLE_TYPES, WATCHABLE_TYPES, cleanResumeUrl, statusOptionsFor } from './types';

interface MediaEditFormProps {
  formData: MediaFormData;
  setFormData: Dispatch<SetStateAction<MediaFormData>>;
  onSubmit: (e: FormEvent) => void;
  tags: Tag[];
  availableTags: Tag[];
  onTagsChange: (tags: Tag[]) => void;
  /** Migration 29 is live: On Hold / Dropped, plus the Platform and Resume link fields. */
  v29?: boolean;
}

/** The detail drawer's add/edit form (moved out of MediaTracker.tsx unchanged). */
export function MediaEditForm({ formData, setFormData, onSubmit, tags, availableTags, onTagsChange, v29 = false }: MediaEditFormProps) {
  const urlBad = formData.resume_url.trim() !== '' && !cleanResumeUrl(formData.resume_url);
  const showSeasonEpisode = WATCHABLE_TYPES.includes(formData.type);
  const showChapter = READABLE_TYPES.includes(formData.type);
  // UX-18: Edit is mostly for fixing where you are, so land in the progress field
  // with its value selected. Focusing before the sheet's FocusScope mounts also
  // stops it auto-selecting the Title (type "100" and you'd rename the series).
  const progressRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = progressRef.current;
    if (el) { el.focus(); el.select(); }
  }, []);
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
              {(READABLE_TYPES.includes(formData.type) || WATCHABLE_TYPES.includes(formData.type) || formData.type === 'Movie'
                ? statusOptionsFor(READABLE_TYPES.includes(formData.type), v29)
                // No type picked yet: every status.
                : [...new Set([...statusOptionsFor(false, v29), ...statusOptionsFor(true, v29)])]
              ).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
              ref={showChapter ? undefined : progressRef}
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
            ref={progressRef}
            type="number"
            min="1"
            value={formData.current_chapter}
            onChange={(e) => setFormData({ ...formData, current_chapter: e.target.value })}
            placeholder="Chapter number"
          />
        </div>
      )}

      {v29 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="platform">Platform</Label>
            <Input
              id="platform"
              list="media-platform-suggestions"
              value={formData.platform}
              onChange={(e) => setFormData({ ...formData, platform: e.target.value.slice(0, 60) })}
              placeholder="Where you read or watch it"
              autoComplete="off"
            />
            <datalist id="media-platform-suggestions">
              {PLATFORM_SUGGESTIONS.map((p) => <option key={p} value={p} />)}
            </datalist>
          </div>
          <div className="space-y-2">
            <Label htmlFor="resume_url">Resume link</Label>
            <Input
              id="resume_url"
              type="url"
              inputMode="url"
              value={formData.resume_url}
              onChange={(e) => setFormData({ ...formData, resume_url: e.target.value })}
              placeholder="https://…"
              autoComplete="off"
              aria-invalid={urlBad || undefined}
              aria-describedby={urlBad ? 'resume_url_error' : undefined}
            />
            {urlBad && <p id="resume_url_error" className="text-xs text-destructive">Use a full link starting with http:// or https://</p>}
          </div>
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
