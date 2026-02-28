-- Create code_snippets table
CREATE TABLE IF NOT EXISTS public.code_snippets (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'plaintext',
    category TEXT,
    is_favorited BOOLEAN DEFAULT FALSE,
    is_pinned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create code_snippet_tags join table
CREATE TABLE IF NOT EXISTS public.code_snippet_tags (
    snippet_id BIGINT NOT NULL REFERENCES public.code_snippets(id) ON DELETE CASCADE,
    tag_id BIGINT NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    PRIMARY KEY (snippet_id, tag_id)
);

-- Enable Row Level Security
ALTER TABLE public.code_snippets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_snippet_tags ENABLE ROW LEVEL SECURITY;

-- code_snippets RLS policies
DROP POLICY IF EXISTS "Users can view their own code snippets" ON public.code_snippets;
CREATE POLICY "Users can view their own code snippets" ON public.code_snippets
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own code snippets" ON public.code_snippets;
CREATE POLICY "Users can insert their own code snippets" ON public.code_snippets
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own code snippets" ON public.code_snippets;
CREATE POLICY "Users can update their own code snippets" ON public.code_snippets
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own code snippets" ON public.code_snippets;
CREATE POLICY "Users can delete their own code snippets" ON public.code_snippets
    FOR DELETE USING (auth.uid() = user_id);

-- code_snippet_tags RLS policies
DROP POLICY IF EXISTS "Users can view their own snippet tags" ON public.code_snippet_tags;
CREATE POLICY "Users can view their own snippet tags" ON public.code_snippet_tags
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.code_snippets
            WHERE code_snippets.id = code_snippet_tags.snippet_id
            AND code_snippets.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can insert their own snippet tags" ON public.code_snippet_tags;
CREATE POLICY "Users can insert their own snippet tags" ON public.code_snippet_tags
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.code_snippets
            WHERE code_snippets.id = code_snippet_tags.snippet_id
            AND code_snippets.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can delete their own snippet tags" ON public.code_snippet_tags;
CREATE POLICY "Users can delete their own snippet tags" ON public.code_snippet_tags
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.code_snippets
            WHERE code_snippets.id = code_snippet_tags.snippet_id
            AND code_snippets.user_id = auth.uid()
        )
    );

-- Create updated_at trigger for code_snippets
DROP TRIGGER IF EXISTS code_snippets_updated_at ON public.code_snippets;
CREATE TRIGGER code_snippets_updated_at
    BEFORE UPDATE ON public.code_snippets
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
