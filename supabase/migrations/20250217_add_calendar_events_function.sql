-- Migration: Create get_calendar_events function for unified calendar view
-- Date: 2025-02-17

-- Function to get all calendar events for a user within a date range
CREATE OR REPLACE FUNCTION get_calendar_events(
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
) AS $$
BEGIN
    -- Tasks with due dates
    RETURN QUERY
    SELECT 
        'task_' || t.id::TEXT as event_id,
        'task'::TEXT as event_type,
        t.task_text::TEXT as title,
        t.due_date as event_date,
        '#3B82F6'::TEXT as color,
        jsonb_build_object(
            'id', t.id,
            'completed', t.is_completed,
            'pinned', t.is_pinned
        ) as data
    FROM tasks t
    WHERE t.user_id = p_user_id
        AND t.due_date BETWEEN p_start_date AND p_end_date;

    -- Birthdays (recurring annually)
    RETURN QUERY
    SELECT 
        'birthday_' || b.id::TEXT || '_' || EXTRACT(YEAR FROM p_start_date)::TEXT as event_id,
        'birthday'::TEXT as event_type,
        (b.name || '''s Birthday')::TEXT as title,
        DATE(CONCAT(EXTRACT(YEAR FROM p_start_date), '-', 
                    EXTRACT(MONTH FROM b.date_of_birth), '-',
                    EXTRACT(DAY FROM b.date_of_birth))) as event_date,
        '#10B981'::TEXT as color,
        jsonb_build_object(
            'id', b.id,
            'original_date', b.date_of_birth,
            'age', EXTRACT(YEAR FROM p_start_date) - EXTRACT(YEAR FROM b.date_of_birth)
        ) as data
    FROM birthdays b
    WHERE b.user_id = p_user_id
        AND DATE(CONCAT(EXTRACT(YEAR FROM p_start_date), '-',
                        EXTRACT(MONTH FROM b.date_of_birth), '-',
                        EXTRACT(DAY FROM b.date_of_birth))) 
            BETWEEN p_start_date AND p_end_date;

    -- Subscriptions with next renewal dates
    RETURN QUERY
    SELECT 
        'subscription_' || s.id::TEXT as event_id,
        'subscription'::TEXT as event_type,
        (s.name || ' (Renewal)')::TEXT as title,
        s.next_renewal_date::DATE as event_date,
        '#EF4444'::TEXT as color,
        jsonb_build_object(
            'id', s.id,
            'amount', s.amount,
            'billing_cycle', s.billing_cycle,
            'status', s.status
        ) as data
    FROM subscriptions s
    WHERE s.user_id = p_user_id
        AND s.next_renewal_date::DATE BETWEEN p_start_date AND p_end_date;

    -- Countdowns with event dates
    RETURN QUERY
    SELECT 
        'countdown_' || c.id::TEXT as event_id,
        'countdown'::TEXT as event_type,
        c.event_name::TEXT as title,
        c.event_date::DATE as event_date,
        '#8B5CF6'::TEXT as color,
        jsonb_build_object(
            'id', c.id
        ) as data
    FROM countdowns c
    WHERE c.user_id = p_user_id
        AND c.event_date::DATE BETWEEN p_start_date AND p_end_date;

    -- Notes with calendar dates
    RETURN QUERY
    SELECT 
        'note_' || n.id::TEXT as event_id,
        'note'::TEXT as event_type,
        COALESCE(n.title, 'Untitled Note')::TEXT as title,
        n.calendar_date as event_date,
        '#6B7280'::TEXT as color,
        jsonb_build_object(
            'id', n.id,
            'pinned', n.is_pinned
        ) as data
    FROM notes n
    WHERE n.user_id = p_user_id
        AND n.calendar_date BETWEEN p_start_date AND p_end_date;

    -- Media with release dates
    RETURN QUERY
    SELECT 
        'media_' || m.id::TEXT as event_id,
        'media'::TEXT as event_type,
        COALESCE(m.title, 'Untitled Media')::TEXT as title,
        m.release_date as event_date,
        '#F97316'::TEXT as color,
        jsonb_build_object(
            'id', m.id,
            'type', m.type,
            'status', m.status
        ) as data
    FROM media_tracker m
    WHERE m.user_id = p_user_id
        AND m.release_date BETWEEN p_start_date AND p_end_date;
        
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_calendar_events(UUID, DATE, DATE) TO authenticated;

-- Create index for better performance on commonly queried date ranges
CREATE INDEX IF NOT EXISTS idx_birthdays_user_date ON birthdays(user_id, date_of_birth);
CREATE INDEX IF NOT EXISTS idx_countdowns_user_date ON countdowns(user_id, event_date);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_renewal ON subscriptions(user_id, next_renewal_date);
