-- ============================================
-- TAGS SYSTEM MIGRATION
-- ============================================

-- 1. Tags table (global, user-specific)
CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- 2. Junction tables for many-to-many relationships
CREATE TABLE IF NOT EXISTS note_tags (
  note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS media_tags (
  media_id INTEGER REFERENCES media_tracker(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, tag_id)
);

CREATE TABLE IF NOT EXISTS prompt_tags (
  prompt_id INTEGER REFERENCES prompts(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (prompt_id, tag_id)
);

-- 3. Performance indexes (minimal, free-tier optimized)
CREATE INDEX IF NOT EXISTS idx_tags_user_name ON tags(user_id, name);
CREATE INDEX IF NOT EXISTS idx_tags_user_count ON tags(user_id, usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(note_id);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_task ON task_tags(task_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_media_tags_media ON media_tags(media_id);
CREATE INDEX IF NOT EXISTS idx_media_tags_tag ON media_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_prompt_tags_prompt ON prompt_tags(prompt_id);
CREATE INDEX IF NOT EXISTS idx_prompt_tags_tag ON prompt_tags(tag_id);

-- 4. Enable RLS
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_tags ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies

-- Tags: Users manage only their own
DROP POLICY IF EXISTS "Users can manage their own tags" ON tags;
CREATE POLICY "Users can manage their own tags"
  ON tags FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Note tags: Only for user's own notes
DROP POLICY IF EXISTS "Users can manage note tags" ON note_tags;
CREATE POLICY "Users can manage note tags"
  ON note_tags FOR ALL
  USING (EXISTS (
    SELECT 1 FROM notes n 
    WHERE n.id = note_tags.note_id AND n.user_id = auth.uid()
  ));

-- Task tags: Only for user's own tasks
DROP POLICY IF EXISTS "Users can manage task tags" ON task_tags;
CREATE POLICY "Users can manage task tags"
  ON task_tags FOR ALL
  USING (EXISTS (
    SELECT 1 FROM tasks t 
    WHERE t.id = task_tags.task_id AND t.user_id = auth.uid()
  ));

-- Media tags: Only for user's own media
DROP POLICY IF EXISTS "Users can manage media tags" ON media_tags;
CREATE POLICY "Users can manage media tags"
  ON media_tags FOR ALL
  USING (EXISTS (
    SELECT 1 FROM media_tracker m 
    WHERE m.id = media_tags.media_id AND m.user_id = auth.uid()
  ));

-- Prompt tags: Only for user's own prompts
DROP POLICY IF EXISTS "Users can manage prompt tags" ON prompt_tags;
CREATE POLICY "Users can manage prompt tags"
  ON prompt_tags FOR ALL
  USING (EXISTS (
    SELECT 1 FROM prompts p 
    WHERE p.id = prompt_tags.prompt_id AND p.user_id = auth.uid()
  ));

-- 6. Function to update usage count (trigger)
CREATE OR REPLACE FUNCTION update_tag_usage_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE tags SET usage_count = usage_count + 1 WHERE id = NEW.tag_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE tags SET usage_count = usage_count - 1 WHERE id = OLD.tag_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 7. Triggers to keep usage_count updated
DROP TRIGGER IF EXISTS note_tags_usage_trigger ON note_tags;
CREATE TRIGGER note_tags_usage_trigger
  AFTER INSERT OR DELETE ON note_tags
  FOR EACH ROW EXECUTE FUNCTION update_tag_usage_count();

DROP TRIGGER IF EXISTS task_tags_usage_trigger ON task_tags;
CREATE TRIGGER task_tags_usage_trigger
  AFTER INSERT OR DELETE ON task_tags
  FOR EACH ROW EXECUTE FUNCTION update_tag_usage_count();

DROP TRIGGER IF EXISTS media_tags_usage_trigger ON media_tags;
CREATE TRIGGER media_tags_usage_trigger
  AFTER INSERT OR DELETE ON media_tags
  FOR EACH ROW EXECUTE FUNCTION update_tag_usage_count();

DROP TRIGGER IF EXISTS prompt_tags_usage_trigger ON prompt_tags;
CREATE TRIGGER prompt_tags_usage_trigger
  AFTER INSERT OR DELETE ON prompt_tags
  FOR EACH ROW EXECUTE FUNCTION update_tag_usage_count();

-- 8. Function to auto-cleanup empty tags
CREATE OR REPLACE FUNCTION cleanup_empty_tags()
RETURNS void AS $$
BEGIN
  DELETE FROM tags
  WHERE usage_count = 0
  AND created_at < NOW() - INTERVAL '1 day';
END;
$$ LANGUAGE plpgsql;

-- 9. Function to normalize tag names (lowercase, trim)
CREATE OR REPLACE FUNCTION normalize_tag_name(tag_name TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN lower(trim(tag_name));
END;
$$ LANGUAGE plpgsql;
