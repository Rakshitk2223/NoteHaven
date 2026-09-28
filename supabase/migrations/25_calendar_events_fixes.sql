-- ============================================================================
-- 25 · Calendar RPC fixes: birthdays across New Year (F-C01) and subscription
--      renewals rolled forward (F-L03, calendar side)
--
-- Purpose (1): get_calendar_events built each birthday in YEAR(p_start_date) only.
-- The month grid starts on the Sunday before the 1st, so January's range begins
-- in late December of the PREVIOUS year (Jan 2026 → 2025-12-28): every January
-- birthday was built in 2025, fell outside the range and never appeared. The
-- same hit trailing-January days in the December view and any week/agenda
-- window crossing Dec → Jan, and `age` was computed off the wrong year.
--
-- Fix: generate the birthday once per calendar year in [start, end], and build
-- the date inside a CASE so a 29 Feb birthday can't crash a non-leap-year view
-- (the old guard relied on AND evaluation order, which Postgres doesn't promise).
--
-- Purpose (2): subscriptions only ever showed their STORED next_renewal_date,
-- which nothing rolls forward, so the calendar showed one renewal per
-- subscription, ever, usually in the past. Active/renewing monthly and yearly
-- subs now also project every later renewal inside the range (anchored on the
-- stored date; Postgres month arithmetic clamps month ends, Jan 31 → Feb 28 →
-- Mar 31), bounded by end_date. Computed on read, nothing is written — the same
-- rule the Subscriptions page and Dashboard apply client-side.
--
-- Everything else is the section-19 function unchanged (auth.uid() guard, pinned
-- search_path, same columns, same event_id formats; projected renewals get
-- "subscription_<id>_<k>" so ids stay unique, data.id is still the sub id).
--
-- Run order: after 23_work_projects.sql (and after 22_security_lint.sql, whose
-- anon REVOKE is restated below). Independent of 24 and 26.
-- Idempotent (CREATE OR REPLACE); safe to re-run. Reads only; writes no rows.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_calendar_events(
    p_user_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    event_id TEXT,
    event_type TEXT,
    title TEXT,
    event_date DATE,
    color TEXT,
    data JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        'task_' || t.id::TEXT, 'task'::TEXT, t.task_text::TEXT, t.due_date, '#3B82F6'::TEXT,
        jsonb_build_object('id', t.id, 'completed', t.is_completed, 'pinned', t.is_pinned)
    FROM public.tasks t
    WHERE t.user_id = v_uid AND t.due_date BETWEEN p_start_date AND p_end_date;

    -- One occurrence per calendar year the range touches (usually 1, 2 when the
    -- range crosses New Year). The date is built inside a CASE: Postgres does not
    -- promise to evaluate AND terms left to right, so the old "NOT leap-day AND
    -- MAKE_DATE(...) BETWEEN" form could call MAKE_DATE(y, 2, 29) for a
    -- non-leap year and abort the whole calendar (reproduced 2026-09-28).
    RETURN QUERY
    SELECT
        'birthday_' || b.id::TEXT || '_' || g.y::TEXT,
        'birthday'::TEXT,
        (b.name || '''s Birthday')::TEXT,
        bd.d,
        '#10B981'::TEXT,
        jsonb_build_object(
            'id', b.id,
            'original_date', b.date_of_birth,
            'age', g.y - EXTRACT(YEAR FROM b.date_of_birth)::INT
        )
    FROM public.birthdays b
    CROSS JOIN generate_series(
        EXTRACT(YEAR FROM p_start_date)::INT,
        EXTRACT(YEAR FROM p_end_date)::INT
    ) AS g(y)
    CROSS JOIN LATERAL (
        SELECT CASE
            -- 29 Feb in a non-leap year: no occurrence that year.
            WHEN EXTRACT(MONTH FROM b.date_of_birth) = 2
             AND EXTRACT(DAY FROM b.date_of_birth) = 29
             AND NOT ((g.y % 4 = 0 AND g.y % 100 <> 0) OR g.y % 400 = 0)
            THEN NULL
            ELSE MAKE_DATE(g.y, EXTRACT(MONTH FROM b.date_of_birth)::INT, EXTRACT(DAY FROM b.date_of_birth)::INT)
        END AS d
    ) bd
    WHERE b.user_id = v_uid
      AND bd.d BETWEEN p_start_date AND p_end_date;

    -- k = 0 is the stored date (shown for every status, as before); k > 0 are the
    -- projected renewals for active/renew monthly/yearly subs only.
    RETURN QUERY
    SELECT
        'subscription_' || s.id::TEXT || CASE WHEN g.k > 0 THEN '_' || g.k::TEXT ELSE '' END,
        'subscription'::TEXT, (s.name || ' (Renewal)')::TEXT,
        occ.d, '#EF4444'::TEXT,
        jsonb_build_object('id', s.id, 'amount', s.amount, 'billing_cycle', s.billing_cycle, 'status', s.status)
    FROM public.subscriptions s
    CROSS JOIN LATERAL (
        SELECT CASE
            WHEN s.status IN ('active', 'renew') AND s.billing_cycle = 'monthly' THEN 1
            WHEN s.status IN ('active', 'renew') AND s.billing_cycle = 'yearly'  THEN 12
            ELSE 0
        END AS step
    ) st
    CROSS JOIN LATERAL generate_series(
        0,
        CASE WHEN st.step = 0 THEN 0
             ELSE LEAST(1200, GREATEST(0,
                    ((EXTRACT(YEAR FROM p_end_date) - EXTRACT(YEAR FROM s.next_renewal_date)) * 12
                     + (EXTRACT(MONTH FROM p_end_date) - EXTRACT(MONTH FROM s.next_renewal_date)))::INT
                    / st.step + 1))
        END
    ) AS g(k)
    CROSS JOIN LATERAL (
        SELECT (s.next_renewal_date + make_interval(months => g.k * st.step))::DATE AS d
    ) occ
    WHERE s.user_id = v_uid
      AND (g.k = 0 OR s.end_date IS NULL OR occ.d <= s.end_date)
      AND occ.d BETWEEN p_start_date AND p_end_date;

    RETURN QUERY
    SELECT
        'countdown_' || c.id::TEXT, 'countdown'::TEXT, c.event_name::TEXT,
        c.event_date::DATE, '#8B5CF6'::TEXT,
        jsonb_build_object('id', c.id)
    FROM public.countdowns c
    WHERE c.user_id = v_uid AND c.event_date::DATE BETWEEN p_start_date AND p_end_date;

    RETURN QUERY
    SELECT
        'note_' || n.id::TEXT, 'note'::TEXT, COALESCE(n.title, 'Untitled Note')::TEXT,
        n.calendar_date, '#6B7280'::TEXT,
        jsonb_build_object('id', n.id, 'pinned', n.is_pinned)
    FROM public.notes n
    WHERE n.user_id = v_uid AND n.calendar_date BETWEEN p_start_date AND p_end_date;

    RETURN QUERY
    SELECT
        'media_' || m.id::TEXT, 'media'::TEXT, COALESCE(m.title, 'Untitled Media')::TEXT,
        m.release_date, '#F97316'::TEXT,
        jsonb_build_object('id', m.id, 'type', m.type, 'status', m.status)
    FROM public.media_tracker m
    WHERE m.user_id = v_uid AND m.release_date BETWEEN p_start_date AND p_end_date;
END;
$$;

-- CREATE OR REPLACE keeps existing grants; restated so a fresh project matches
-- 19 + 22 (authenticated only, no anon).
REVOKE ALL ON FUNCTION public.get_calendar_events(UUID, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_calendar_events(UUID, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_calendar_events(UUID, DATE, DATE) TO authenticated;
