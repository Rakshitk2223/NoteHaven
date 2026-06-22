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
      birthdays: {
        Row: {
          created_at: string
          date_of_birth: string
          id: number
          name: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          date_of_birth: string
          id?: number
          name: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          date_of_birth?: string
          id?: number
          name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      bucket_list: {
        Row: {
          achieved_at: string | null
          category: string
          created_at: string
          description: string | null
          id: number
          image_url: string | null
          sort_order: number | null
          status: string
          target_date: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          achieved_at?: string | null
          category?: string
          created_at?: string
          description?: string | null
          id?: number
          image_url?: string | null
          sort_order?: number | null
          status?: string
          target_date?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          achieved_at?: string | null
          category?: string
          created_at?: string
          description?: string | null
          id?: number
          image_url?: string | null
          sort_order?: number | null
          status?: string
          target_date?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      recipe_folders: {
        Row: {
          created_at: string
          id: number
          name: string
          sort_order: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          name: string
          sort_order?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: number
          name?: string
          sort_order?: number | null
          user_id?: string
        }
        Relationships: []
      }
      recipes: {
        Row: {
          category: string | null
          cook_minutes: number | null
          created_at: string
          cuisine: string | null
          description: string | null
          difficulty: string | null
          folder_id: number | null
          id: number
          image_url: string | null
          ingredients: string[]
          instructions: string | null
          is_favorite: boolean | null
          prep_minutes: number | null
          servings: number | null
          sort_order: number | null
          source_url: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          cook_minutes?: number | null
          created_at?: string
          cuisine?: string | null
          description?: string | null
          difficulty?: string | null
          folder_id?: number | null
          id?: number
          image_url?: string | null
          ingredients?: string[]
          instructions?: string | null
          is_favorite?: boolean | null
          prep_minutes?: number | null
          servings?: number | null
          sort_order?: number | null
          source_url?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          cook_minutes?: number | null
          created_at?: string
          cuisine?: string | null
          description?: string | null
          difficulty?: string | null
          folder_id?: number | null
          id?: number
          image_url?: string | null
          ingredients?: string[]
          instructions?: string | null
          is_favorite?: boolean | null
          prep_minutes?: number | null
          servings?: number | null
          sort_order?: number | null
          source_url?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      code_snippet_tags: {
        Row: {
          snippet_id: number
          tag_id: number
        }
        Insert: {
          snippet_id: number
          tag_id: number
        }
        Update: {
          snippet_id?: number
          tag_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "code_snippet_tags_snippet_id_fkey"
            columns: ["snippet_id"]
            isOneToOne: false
            referencedRelation: "code_snippets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_snippet_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      code_snippets: {
        Row: {
          category: string | null
          code: string
          created_at: string | null
          description: string | null
          filename: string | null
          folder_id: number | null
          id: number
          is_favorited: boolean | null
          is_pinned: boolean | null
          language: string
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          category?: string | null
          code?: string
          created_at?: string | null
          description?: string | null
          filename?: string | null
          folder_id?: number | null
          id?: number
          is_favorited?: boolean | null
          is_pinned?: boolean | null
          language?: string
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string | null
          description?: string | null
          filename?: string | null
          folder_id?: number | null
          id?: number
          is_favorited?: boolean | null
          is_pinned?: boolean | null
          language?: string
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_snippets_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "snippet_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      snippet_folders: {
        Row: {
          color: string | null
          created_at: string | null
          id: number
          name: string
          sort_order: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: number
          name: string
          sort_order?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: number
          name?: string
          sort_order?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      vault_folders: {
        Row: {
          color: string | null
          created_at: string | null
          id: number
          name: string
          parent_id: number | null
          sort_order: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: number
          name: string
          parent_id?: number | null
          sort_order?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: number
          name?: string
          parent_id?: number | null
          sort_order?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "vault_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_files: {
        Row: {
          created_at: string | null
          folder_id: number | null
          id: number
          is_starred: boolean | null
          mime_type: string | null
          name: string
          size_bytes: number | null
          storage_path: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          folder_id?: number | null
          id?: number
          is_starred?: boolean | null
          mime_type?: string | null
          name: string
          size_bytes?: number | null
          storage_path: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          folder_id?: number | null
          id?: number
          is_starred?: boolean | null
          mime_type?: string | null
          name?: string
          size_bytes?: number | null
          storage_path?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_files_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "vault_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      countdowns: {
        Row: {
          created_at: string
          event_date: string
          event_name: string
          id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          event_date: string
          event_name: string
          id?: number
          user_id: string
        }
        Update: {
          created_at?: string
          event_date?: string
          event_name?: string
          id?: number
          user_id?: string
        }
        Relationships: []
      }
      ledger_categories: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          id: number
          name: string
          type: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: number
          name: string
          type: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: number
          name?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      ledger_buckets: {
        Row: {
          id: number
          user_id: string
          name: string
          kind: string
          color: string | null
          target_amount: number | null
          notes: string | null
          sort_order: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: number
          user_id: string
          name: string
          kind?: string
          color?: string | null
          target_amount?: number | null
          notes?: string | null
          sort_order?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: number
          user_id?: string
          name?: string
          kind?: string
          color?: string | null
          target_amount?: number | null
          notes?: string | null
          sort_order?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ledger_accounts: {
        Row: {
          archived: boolean | null
          color: string | null
          created_at: string | null
          id: number
          kind: string
          name: string
          opening_balance: number
          sort_order: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          archived?: boolean | null
          color?: string | null
          created_at?: string | null
          id?: number
          kind?: string
          name: string
          opening_balance?: number
          sort_order?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          archived?: boolean | null
          color?: string | null
          created_at?: string | null
          id?: number
          kind?: string
          name?: string
          opening_balance?: number
          sort_order?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ledger_entries: {
        Row: {
          account_id: number | null
          to_account_id: number | null
          amount: number
          bucket_id: number | null
          category_id: number | null
          created_at: string | null
          description: string | null
          from_bucket_id: number | null
          id: number
          is_recurring: boolean | null
          notes: string | null
          recurring_interval: string | null
          transaction_date: string
          type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id?: number | null
          to_account_id?: number | null
          amount: number
          bucket_id?: number | null
          category_id?: number | null
          created_at?: string | null
          description?: string | null
          from_bucket_id?: number | null
          id?: number
          is_recurring?: boolean | null
          notes?: string | null
          recurring_interval?: string | null
          transaction_date?: string
          type: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: number | null
          to_account_id?: number | null
          amount?: number
          bucket_id?: number | null
          category_id?: number | null
          created_at?: string | null
          description?: string | null
          from_bucket_id?: number | null
          id?: number
          is_recurring?: boolean | null
          notes?: string | null
          recurring_interval?: string | null
          transaction_date?: string
          type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "ledger_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "ledger_buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      media_metadata: {
        Row: {
          anilist_id: number | null
          banner_image: string | null
          cast_members: Json | null
          chapters: number | null
          cover_image: string
          created_at: string | null
          description: string | null
          episodes: number | null
          episodes_detail: Json | null
          genres: string[] | null
          id: number
          last_updated: string | null
          mal_id: number | null
          rating: number | null
          runtime: number | null
          seasons: Json | null
          status: string | null
          title: string
          tmdb_id: number | null
          total_seasons: number | null
          type: string | null
        }
        Insert: {
          anilist_id?: number | null
          banner_image?: string | null
          cast_members?: Json | null
          chapters?: number | null
          cover_image: string
          created_at?: string | null
          description?: string | null
          episodes?: number | null
          episodes_detail?: Json | null
          genres?: string[] | null
          id?: number
          last_updated?: string | null
          mal_id?: number | null
          rating?: number | null
          runtime?: number | null
          seasons?: Json | null
          status?: string | null
          title: string
          tmdb_id?: number | null
          total_seasons?: number | null
          type?: string | null
        }
        Update: {
          anilist_id?: number | null
          banner_image?: string | null
          cast_members?: Json | null
          chapters?: number | null
          cover_image?: string
          created_at?: string | null
          description?: string | null
          episodes?: number | null
          episodes_detail?: Json | null
          genres?: string[] | null
          id?: number
          last_updated?: string | null
          mal_id?: number | null
          rating?: number | null
          runtime?: number | null
          seasons?: Json | null
          status?: string | null
          title?: string
          tmdb_id?: number | null
          total_seasons?: number | null
          type?: string | null
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
        Relationships: [
          {
            foreignKeyName: "media_tags_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_tracker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      media_tracker: {
        Row: {
          cover_image: string | null
          created_at: string | null
          current_chapter: number | null
          current_episode: number | null
          current_season: number | null
          has_new_content: boolean
          id: number
          last_activity_at: string | null
          last_known_total_episodes: number | null
          last_known_total_seasons: number | null
          rating: number | null
          release_date: string | null
          status: string | null
          title: string
          type: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cover_image?: string | null
          created_at?: string | null
          current_chapter?: number | null
          current_episode?: number | null
          current_season?: number | null
          has_new_content?: boolean
          id?: number
          last_activity_at?: string | null
          last_known_total_episodes?: number | null
          last_known_total_seasons?: number | null
          rating?: number | null
          release_date?: string | null
          status?: string | null
          title: string
          type?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cover_image?: string | null
          created_at?: string | null
          current_chapter?: number | null
          current_episode?: number | null
          current_season?: number | null
          has_new_content?: boolean
          id?: number
          last_activity_at?: string | null
          last_known_total_episodes?: number | null
          last_known_total_seasons?: number | null
          rating?: number | null
          release_date?: string | null
          status?: string | null
          title?: string
          type?: string | null
          updated_at?: string | null
          user_id?: string
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
        Relationships: [
          {
            foreignKeyName: "note_tags_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          background_color: string | null
          calendar_date: string | null
          content: string | null
          created_at: string | null
          id: number
          is_pinned: boolean
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          background_color?: string | null
          calendar_date?: string | null
          content?: string | null
          created_at?: string | null
          id?: number
          is_pinned?: boolean
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          background_color?: string | null
          calendar_date?: string | null
          content?: string | null
          created_at?: string | null
          id?: number
          is_pinned?: boolean
          title?: string | null
          updated_at?: string | null
          user_id?: string
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
        Relationships: [
          {
            foreignKeyName: "prompt_tags_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      prompts: {
        Row: {
          category: string | null
          created_at: string | null
          id: number
          is_favorited: boolean | null
          is_pinned: boolean
          prompt_text: string
          title: string | null
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          id?: number
          is_favorited?: boolean | null
          is_pinned?: boolean
          prompt_text: string
          title?: string | null
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string | null
          id?: number
          is_favorited?: boolean | null
          is_pinned?: boolean
          prompt_text?: string
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      shared_notes: {
        Row: {
          allow_edit: boolean
          created_at: string
          id: string
          note_id: number
          owner_id: string
        }
        Insert: {
          allow_edit?: boolean
          created_at?: string
          id?: string
          note_id: number
          owner_id: string
        }
        Update: {
          allow_edit?: boolean
          created_at?: string
          id?: string
          note_id?: number
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_notes_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_categories: {
        Row: {
          color: string | null
          created_at: string | null
          id: number
          name: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: number
          name: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: number
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          amount: number
          billing_cycle: string
          category_id: number | null
          created_at: string | null
          end_date: string | null
          id: number
          ledger_category_id: number | null
          ledger_entry_id: number | null
          name: string
          next_renewal_date: string
          notes: string | null
          start_date: string
          status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount: number
          billing_cycle: string
          category_id?: number | null
          created_at?: string | null
          end_date?: string | null
          id?: number
          ledger_category_id?: number | null
          ledger_entry_id?: number | null
          name: string
          next_renewal_date: string
          notes?: string | null
          start_date: string
          status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          billing_cycle?: string
          category_id?: number | null
          created_at?: string | null
          end_date?: string | null
          id?: number
          ledger_category_id?: number | null
          ledger_entry_id?: number | null
          name?: string
          next_renewal_date?: string
          notes?: string | null
          start_date?: string
          status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "subscription_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_ledger_category_id_fkey"
            columns: ["ledger_category_id"]
            isOneToOne: false
            referencedRelation: "ledger_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string
          created_at: string | null
          id: number
          name: string
          usage_count: number | null
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string | null
          id?: number
          name: string
          usage_count?: number | null
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string | null
          id?: number
          name?: string
          usage_count?: number | null
          user_id?: string
        }
        Relationships: []
      }
      task_tags: {
        Row: {
          tag_id: number
          task_id: number
        }
        Insert: {
          tag_id: number
          task_id: number
        }
        Update: {
          tag_id?: number
          task_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_tags_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          created_at: string | null
          due_date: string | null
          id: number
          is_completed: boolean | null
          is_pinned: boolean
          task_text: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          due_date?: string | null
          id?: number
          is_completed?: boolean | null
          is_pinned?: boolean
          task_text: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          due_date?: string | null
          id?: number
          is_completed?: boolean | null
          is_pinned?: boolean
          task_text?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          created_at: string | null
          id: string
          preference_key: string
          preference_value: Json
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          preference_key: string
          preference_value?: Json
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          preference_key?: string
          preference_value?: Json
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_empty_tags: { Args: never; Returns: undefined }
      get_calendar_events: {
        Args: { p_end_date: string; p_start_date: string; p_user_id: string }
        Returns: {
          color: string
          data: Json
          event_date: string
          event_id: string
          event_type: string
          title: string
        }[]
      }
      get_monthly_ledger_summary: {
        Args: { p_month: number; p_user_id: string; p_year: number }
        Returns: {
          net_balance: number
          total_expense: number
          total_income: number
        }[]
      }
      get_upcoming_renewals: {
        Args: { p_days?: number; p_user_id: string }
        Returns: {
          amount: number
          billing_cycle: string
          days_until: number
          id: number
          name: string
          next_renewal_date: string
          status: string
        }[]
      }
      normalize_tag_name: { Args: { tag_name: string }; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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

// ---------------------------------------------------------------------------
// Convenience row aliases used across the app (lib/ledger.ts, lib/buckets.ts,
// lib/subscriptions.ts, pages). Derived from the generated Database type.
// ---------------------------------------------------------------------------
export type LedgerCategory = Database["public"]["Tables"]["ledger_categories"]["Row"]
export type LedgerBucket = Database["public"]["Tables"]["ledger_buckets"]["Row"]
export type LedgerAccount = Database["public"]["Tables"]["ledger_accounts"]["Row"]
export type SubscriptionCategory = Database["public"]["Tables"]["subscription_categories"]["Row"]
export type SnippetFolder = Database["public"]["Tables"]["snippet_folders"]["Row"]

export type LedgerEntry = Database["public"]["Tables"]["ledger_entries"]["Row"] & {
  // populated when selected via `category:ledger_categories(*)`
  category?: LedgerCategory | null
}

export type LedgerSummary = {
  totalIncome: number
  totalExpense: number
  netBalance: number
}
