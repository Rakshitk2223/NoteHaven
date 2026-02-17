export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      prompts: {
        Row: {
          id: number
          user_id: string
          title: string | null
          prompt_text: string | null
          is_favorited: boolean | null
          category: string | null
          is_pinned: boolean | null
          created_at: string
        }
        Insert: {
          id?: number
          user_id: string
          title?: string | null
            prompt_text?: string | null
          is_favorited?: boolean | null
          category?: string | null
          is_pinned?: boolean | null
          created_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          title?: string | null
          prompt_text?: string | null
          is_favorited?: boolean | null
          category?: string | null
          is_pinned?: boolean | null
          created_at?: string
        }
        Relationships: []
      }
      notes: {
        Row: {
          id: number
          user_id: string
          title: string | null
          content: string | null
          created_at: string
          updated_at: string
          is_pinned: boolean | null
          background_color: string | null
          calendar_date: string | null
        }
        Insert: {
          id?: number
          user_id: string
          title?: string | null
          content?: string | null
          created_at?: string
          updated_at?: string
          is_pinned?: boolean | null
          background_color?: string | null
          calendar_date?: string | null
        }
        Update: {
          id?: number
          user_id?: string
          title?: string | null
          content?: string | null
          created_at?: string
          updated_at?: string
          is_pinned?: boolean | null
          background_color?: string | null
          calendar_date?: string | null
        }
        Relationships: []
      }
      tasks: {
        Row: {
          id: number
          user_id: string
          task_text: string | null
          is_completed: boolean | null
          created_at: string
          updated_at: string
          is_pinned: boolean | null
          due_date: string | null
        }
        Insert: {
          id?: number
          user_id: string
          task_text?: string | null
          is_completed?: boolean | null
          created_at?: string
          updated_at?: string
          is_pinned?: boolean | null
          due_date?: string | null
        }
        Update: {
          id?: number
          user_id?: string
          task_text?: string | null
          is_completed?: boolean | null
          created_at?: string
          updated_at?: string
          is_pinned?: boolean | null
          due_date?: string | null
        }
        Relationships: []
      }
      media_tracker: {
        Row: {
          id: number
          user_id: string
          title: string | null
          type: string | null
          status: string | null
          rating: number | null
          current_season: number | null
          current_episode: number | null
          current_chapter: number | null
          image_url: string | null
          release_date: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          user_id: string
          title?: string | null
          type?: string | null
          status?: string | null
          rating?: number | null
          current_season?: number | null
          current_episode?: number | null
          current_chapter?: number | null
          image_url?: string | null
          release_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          title?: string | null
          type?: string | null
          status?: string | null
          rating?: number | null
          current_season?: number | null
          current_episode?: number | null
          current_chapter?: number | null
          image_url?: string | null
          release_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      countdowns: {
        Row: {
          id: number
          user_id: string
          event_name: string
          event_date: string
          created_at: string
        }
        Insert: {
          id?: number
          user_id: string
          event_name: string
          event_date: string
          created_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          event_name?: string
          event_date?: string
          created_at?: string
        }
        Relationships: []
      }
      birthdays: {
        Row: {
          id: number
          user_id: string
          name: string
          date_of_birth: string
          created_at: string
        }
        Insert: {
          id?: number
          user_id: string
          name: string
          date_of_birth: string
          created_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          name?: string
          date_of_birth?: string
          created_at?: string
        }
        Relationships: []
      }
      shared_notes: {
        Row: {
          id: string
          note_id: number
          owner_id: string
          allow_edit: boolean | null
          created_at: string
        }
        Insert: {
          id?: string
          note_id: number
          owner_id: string
          allow_edit?: boolean | null
          created_at?: string
        }
        Update: {
          id?: string
          note_id?: number
          owner_id?: string
          allow_edit?: boolean | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: string
            columns: string[]
            referencedRelation: string
            referencedColumns: string[]
          }
        ]
      }
      tags: {
        Row: {
          id: number
          user_id: string
          name: string
          color: string
          usage_count: number
          created_at: string
        }
        Insert: {
          id?: number
          user_id: string
          name: string
          color?: string
          usage_count?: number
          created_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          name?: string
          color?: string
          usage_count?: number
          created_at?: string
        }
        Relationships: []
      }
      note_tags: {
        Row: {
          note_id: number
          tag_id: number
        }
        Insert: {
          note_id: number
          tag_id: number
        }
        Update: {
          note_id?: number
          tag_id?: number
        }
        Relationships: []
      }
      task_tags: {
        Row: {
          task_id: number
          tag_id: number
        }
        Insert: {
          task_id: number
          tag_id: number
        }
        Update: {
          task_id?: number
          tag_id?: number
        }
        Relationships: []
      }
      media_tags: {
        Row: {
          media_id: number
          tag_id: number
        }
        Insert: {
          media_id: number
          tag_id: number
        }
        Update: {
          media_id?: number
          tag_id?: number
        }
        Relationships: []
      }
      prompt_tags: {
        Row: {
          prompt_id: number
          tag_id: number
        }
        Insert: {
          prompt_id: number
          tag_id: number
        }
        Update: {
          prompt_id?: number
          tag_id?: number
        }
        Relationships: []
      }
      ledger_categories: {
        Row: {
          id: number
          user_id: string
          name: string
          type: string
          color: string
          description: string | null
          created_at: string
        }
        Insert: {
          id?: number
          user_id: string
          name: string
          type: string
          color?: string
          description?: string | null
          created_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          name?: string
          type?: string
          color?: string
          description?: string | null
          created_at?: string
        }
        Relationships: []
      }
      ledger_entries: {
        Row: {
          id: number
          user_id: string
          category_id: number | null
          amount: number
          type: string
          description: string | null
          transaction_date: string
          is_recurring: boolean
          recurring_interval: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          user_id: string
          category_id?: number | null
          amount: number
          type: string
          description?: string | null
          transaction_date?: string
          is_recurring?: boolean
          recurring_interval?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          category_id?: number | null
          amount?: number
          type?: string
          description?: string | null
          transaction_date?: string
          is_recurring?: boolean
          recurring_interval?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscription_categories: {
        Row: {
          id: number
          user_id: string
          name: string
          color: string
          created_at: string
        }
        Insert: {
          id?: number
          user_id: string
          name: string
          color?: string
          created_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          name?: string
          color?: string
          created_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          id: number
          user_id: string
          name: string
          amount: number
          billing_cycle: string
          category_id: number | null
          start_date: string
          next_renewal_date: string
          status: string
          notes: string | null
          ledger_category_id: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          user_id: string
          name: string
          amount: number
          billing_cycle: string
          category_id?: number | null
          start_date: string
          next_renewal_date: string
          status?: string
          notes?: string | null
          ledger_category_id?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          name?: string
          amount?: number
          billing_cycle?: string
          category_id?: number | null
          start_date?: string
          next_renewal_date?: string
          status?: string
          notes?: string | null
          ledger_category_id?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_monthly_ledger_summary: {
        Args: {
          p_user_id: string
          p_year: number
          p_month: number
        }
        Returns: {
          total_income: number
          total_expense: number
          net_balance: number
        }[]
      }
      get_upcoming_renewals: {
        Args: {
          p_user_id: string
          p_days?: number
        }
        Returns: {
          id: number
          name: string
          amount: number
          billing_cycle: string
          next_renewal_date: string
          days_until: number
          status: string
        }[]
      }
      get_calendar_events: {
        Args: {
          p_user_id: string
          p_start_date: string
          p_end_date: string
        }
        Returns: {
          event_id: string
          event_type: string
          title: string
          event_date: string
          color: string
          data: Json
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

// ============================================
// TAGS SYSTEM TYPES
// ============================================

export interface Tag {
  id: number
  user_id: string
  name: string
  color: string
  usage_count: number
  created_at: string
}

export interface NoteWithTags {
  id: number
  user_id: string
  title: string | null
  content: string | null
  created_at: string
  updated_at: string
  is_pinned: boolean | null
  background_color: string | null
  tags?: Tag[]
}

export interface TaskWithTags {
  id: number
  user_id: string
  task_text: string | null
  is_completed: boolean | null
  created_at: string
  updated_at: string
  is_pinned: boolean | null
  due_date: string | null
  tags?: Tag[]
}

export interface MediaWithTags {
  id: number
  user_id: string
  title: string | null
  type: string | null
  status: string | null
  rating: number | null
  current_season: number | null
  current_episode: number | null
  current_chapter: number | null
  image_url: string | null
  created_at: string
  updated_at: string
  tags?: Tag[]
}

export interface PromptWithTags {
  id: number
  user_id: string
  title: string | null
  prompt_text: string | null
  is_favorited: boolean | null
  category: string | null
  is_pinned: boolean | null
  created_at: string
  tags?: Tag[]
}

// ============================================
// MONEY LEDGER TYPES
// ============================================

// Note: TAG_COLORS is defined in @/lib/tags for single source of truth

export interface LedgerCategory {
  id: number
  user_id: string
  name: string
  type: 'income' | 'expense'
  color: string
  description: string | null
  created_at: string
}

export interface LedgerEntry {
  id: number
  user_id: string
  category_id: number | null
  amount: number
  type: 'income' | 'expense'
  description: string | null
  transaction_date: string
  is_recurring: boolean
  recurring_interval: 'daily' | 'weekly' | 'monthly' | 'yearly' | null
  notes: string | null
  created_at: string
  updated_at: string
  category?: LedgerCategory
}

export interface LedgerSummary {
  totalIncome: number
  totalExpense: number
  netBalance: number
}

export type RecurringInterval = 'daily' | 'weekly' | 'monthly' | 'yearly'

// ============================================
// SUBSCRIPTION TYPES
// ============================================

export interface SubscriptionCategory {
  id: number
  user_id: string
  name: string
  color: string
  created_at: string
}

export interface Subscription {
  id: number
  user_id: string
  name: string
  amount: number
  billing_cycle: 'monthly' | 'yearly'
  category_id: number | null
  start_date: string
  end_date: string | null
  next_renewal_date: string
  status: 'active' | 'renew' | 'cancel' | 'cancelled'
  notes: string | null
  ledger_category_id: number | null
  ledger_entry_id: number | null
  created_at: string
  updated_at: string
  category?: SubscriptionCategory
}

export interface UpcomingRenewal {
  id: number
  name: string
  amount: number
  billing_cycle: string
  next_renewal_date: string
  days_until: number
  status: string
}

export interface SubscriptionSummary {
  monthlyTotal: number
  yearlyTotal: number
  activeCount: number
  upcomingRenewals: number
}
