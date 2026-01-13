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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      balances: {
        Row: {
          balance_rub: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          balance_rub?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          balance_rub?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_transactions: {
        Row: {
          amount_rub: number
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          organization_id: string
          reason: string
          reference_id: string | null
          reference_type: string | null
          type: string
        }
        Insert: {
          amount_rub: number
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key: string
          organization_id: string
          reason: string
          reference_id?: string | null
          reference_type?: string | null
          type: string
        }
        Update: {
          amount_rub?: number
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string
          organization_id?: string
          reason?: string
          reference_id?: string | null
          reference_type?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_settings: {
        Row: {
          created_at: string
          greeting_text: string | null
          id: string
          language_default: string
          manager_handoff_policy: string
          organization_id: string
          pricing_mode: string
          settings_json: Json
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          greeting_text?: string | null
          id?: string
          language_default?: string
          manager_handoff_policy?: string
          organization_id: string
          pricing_mode?: string
          settings_json?: Json
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          greeting_text?: string | null
          id?: string
          language_default?: string
          manager_handoff_policy?: string
          organization_id?: string
          pricing_mode?: string
          settings_json?: Json
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      buyer_companies: {
        Row: {
          bank_details_json: Json
          company_name: string
          created_at: string
          id: string
          inn: string | null
          kpp: string | null
          legal_address: string | null
          ogrn: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          bank_details_json?: Json
          company_name: string
          created_at?: string
          id?: string
          inn?: string | null
          kpp?: string | null
          legal_address?: string | null
          ogrn?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          bank_details_json?: Json
          company_name?: string
          created_at?: string
          id?: string
          inn?: string | null
          kpp?: string | null
          legal_address?: string | null
          ogrn?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "buyer_companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_sessions: {
        Row: {
          ai_summary: string | null
          created_at: string
          direction: string
          duration_seconds: number
          ended_at: string | null
          error_reason: string | null
          from_phone: string | null
          id: string
          lead_id: string | null
          organization_id: string
          recording_url: string | null
          sentiment: string | null
          started_at: string | null
          status: string
          to_phone: string | null
          transcript_text: string | null
          transcript_url: string | null
          updated_at: string
        }
        Insert: {
          ai_summary?: string | null
          created_at?: string
          direction: string
          duration_seconds?: number
          ended_at?: string | null
          error_reason?: string | null
          from_phone?: string | null
          id?: string
          lead_id?: string | null
          organization_id: string
          recording_url?: string | null
          sentiment?: string | null
          started_at?: string | null
          status?: string
          to_phone?: string | null
          transcript_text?: string | null
          transcript_url?: string | null
          updated_at?: string
        }
        Update: {
          ai_summary?: string | null
          created_at?: string
          direction?: string
          duration_seconds?: number
          ended_at?: string | null
          error_reason?: string | null
          from_phone?: string | null
          id?: string
          lead_id?: string | null
          organization_id?: string
          recording_url?: string | null
          sentiment?: string | null
          started_at?: string | null
          status?: string
          to_phone?: string | null
          transcript_text?: string | null
          transcript_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_sessions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      color_group_rules: {
        Row: {
          created_at: string
          default_availability_status: string
          default_lead_time_days: number
          default_surcharge_rub_m2: number
          group_code: string
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_availability_status?: string
          default_lead_time_days?: number
          default_surcharge_rub_m2?: number
          group_code: string
          id?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_availability_status?: string
          default_lead_time_days?: number
          default_surcharge_rub_m2?: number
          group_code?: string
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "color_group_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string
          email: string | null
          email_lc: string | null
          full_name: string | null
          id: string
          notes: string | null
          organization_id: string
          phone: string | null
          phone_e164: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          email_lc?: string | null
          full_name?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          phone_e164?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          email_lc?: string | null
          full_name?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          phone_e164?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_quotes: {
        Row: {
          created_at: string
          distance_km: number | null
          from_address: string | null
          id: string
          order_id: string
          organization_id: string
          price_rub: number | null
          provider: string
          status: string
          to_address: string | null
          updated_at: string
          vehicle_type: string | null
          volume_m3: number | null
          weight_tons: number | null
        }
        Insert: {
          created_at?: string
          distance_km?: number | null
          from_address?: string | null
          id?: string
          order_id: string
          organization_id: string
          price_rub?: number | null
          provider?: string
          status?: string
          to_address?: string | null
          updated_at?: string
          vehicle_type?: string | null
          volume_m3?: number | null
          weight_tons?: number | null
        }
        Update: {
          created_at?: string
          distance_km?: number | null
          from_address?: string | null
          id?: string
          order_id?: string
          organization_id?: string
          price_rub?: number | null
          provider?: string
          status?: string
          to_address?: string | null
          updated_at?: string
          vehicle_type?: string | null
          volume_m3?: number | null
          weight_tons?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_quotes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_quotes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_delivery_quotes_orders_org"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      discount_rules: {
        Row: {
          applies_to: string
          category_code: string | null
          created_at: string
          discount_type: string
          discount_value: number
          id: string
          is_active: boolean
          max_qty: number | null
          min_qty: number
          organization_id: string
          product_id: string | null
          rule_name: string
          updated_at: string
        }
        Insert: {
          applies_to?: string
          category_code?: string | null
          created_at?: string
          discount_type: string
          discount_value?: number
          id?: string
          is_active?: boolean
          max_qty?: number | null
          min_qty?: number
          organization_id: string
          product_id?: string | null
          rule_name: string
          updated_at?: string
        }
        Update: {
          applies_to?: string
          category_code?: string | null
          created_at?: string
          discount_type?: string
          discount_value?: number
          id?: string
          is_active?: boolean
          max_qty?: number | null
          min_qty?: number
          organization_id?: string
          product_id?: string | null
          rule_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discount_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      email_accounts: {
        Row: {
          created_at: string
          email_address: string
          id: string
          last_sync_at: string | null
          organization_id: string
          provider: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email_address: string
          id?: string
          last_sync_at?: string | null
          organization_id: string
          provider?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email_address?: string
          id?: string
          last_sync_at?: string | null
          organization_id?: string
          provider?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_attachments: {
        Row: {
          created_at: string
          extracted_text: string | null
          filename: string | null
          id: string
          message_id: string
          mime_type: string | null
          organization_id: string
          storage_url: string | null
        }
        Insert: {
          created_at?: string
          extracted_text?: string | null
          filename?: string | null
          id?: string
          message_id: string
          mime_type?: string | null
          organization_id: string
          storage_url?: string | null
        }
        Update: {
          created_at?: string
          extracted_text?: string | null
          filename?: string | null
          id?: string
          message_id?: string
          mime_type?: string | null
          organization_id?: string
          storage_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "email_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_email_attachments_messages_org"
            columns: ["organization_id", "message_id"]
            isOneToOne: false
            referencedRelation: "email_messages"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      email_messages: {
        Row: {
          body_text: string | null
          created_at: string
          direction: string
          error_reason: string | null
          from_email: string | null
          has_attachments: boolean
          id: string
          organization_id: string
          raw_text_for_agent: string | null
          received_at: string | null
          sent_at: string | null
          status: string
          subject: string | null
          thread_id: string
          to_email: string | null
          updated_at: string
        }
        Insert: {
          body_text?: string | null
          created_at?: string
          direction: string
          error_reason?: string | null
          from_email?: string | null
          has_attachments?: boolean
          id?: string
          organization_id: string
          raw_text_for_agent?: string | null
          received_at?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          thread_id: string
          to_email?: string | null
          updated_at?: string
        }
        Update: {
          body_text?: string | null
          created_at?: string
          direction?: string
          error_reason?: string | null
          from_email?: string | null
          has_attachments?: boolean
          id?: string
          organization_id?: string
          raw_text_for_agent?: string | null
          received_at?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          thread_id?: string
          to_email?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "email_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_email_messages_threads_org"
            columns: ["organization_id", "thread_id"]
            isOneToOne: false
            referencedRelation: "email_threads"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          body_text: string
          created_by: string | null
          error_reason: string | null
          from_account_id: string | null
          id: string
          idempotency_key: string | null
          lead_id: string | null
          organization_id: string
          provider_message_id: string | null
          queued_at: string
          sent_at: string | null
          status: string
          subject: string | null
          thread_id: string | null
          to_email: string
        }
        Insert: {
          body_text: string
          created_by?: string | null
          error_reason?: string | null
          from_account_id?: string | null
          id?: string
          idempotency_key?: string | null
          lead_id?: string | null
          organization_id: string
          provider_message_id?: string | null
          queued_at?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          thread_id?: string | null
          to_email: string
        }
        Update: {
          body_text?: string
          created_by?: string | null
          error_reason?: string | null
          from_account_id?: string | null
          id?: string
          idempotency_key?: string | null
          lead_id?: string | null
          organization_id?: string
          provider_message_id?: string | null
          queued_at?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          thread_id?: string | null
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_from_account_id_fkey"
            columns: ["from_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "email_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      email_threads: {
        Row: {
          contact_id: string | null
          counterparty_email: string | null
          created_at: string
          id: string
          last_message_at: string | null
          lead_id: string | null
          organization_id: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          counterparty_email?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          lead_id?: string | null
          organization_id: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          counterparty_email?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          lead_id?: string | null
          organization_id?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          action: string
          created_at: string
          id: string
          key: string
          organization_id: string
          status: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          key: string
          organization_id: string
          status?: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          key?: string
          organization_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_errors: {
        Row: {
          column_name: string | null
          context: Json
          created_at: string
          error_type: string
          id: string
          import_job_id: string
          message: string
          organization_id: string
          raw_value: string | null
          row_number: number | null
          sheet_name: string | null
        }
        Insert: {
          column_name?: string | null
          context?: Json
          created_at?: string
          error_type: string
          id?: string
          import_job_id: string
          message: string
          organization_id: string
          raw_value?: string | null
          row_number?: number | null
          sheet_name?: string | null
        }
        Update: {
          column_name?: string | null
          context?: Json
          created_at?: string
          error_type?: string
          id?: string
          import_job_id?: string
          message?: string
          organization_id?: string
          raw_value?: string | null
          row_number?: number | null
          sheet_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_import_errors_jobs_org"
            columns: ["organization_id", "import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "import_errors_import_job_id_fkey"
            columns: ["import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_errors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_rows: number
          dry_run: boolean
          entity_type: string
          error_code: string | null
          error_message: string | null
          file_mime: string | null
          file_name: string | null
          file_sha256: string | null
          file_size_bytes: number | null
          file_url: string | null
          finished_at: string | null
          id: string
          inserted_rows: number
          invalid_rows: number
          job_key: string | null
          mode: string
          organization_id: string
          source: string
          started_at: string | null
          status: string
          summary: Json
          total_rows: number
          updated_at: string
          updated_rows: number
          valid_rows: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_rows?: number
          dry_run?: boolean
          entity_type: string
          error_code?: string | null
          error_message?: string | null
          file_mime?: string | null
          file_name?: string | null
          file_sha256?: string | null
          file_size_bytes?: number | null
          file_url?: string | null
          finished_at?: string | null
          id?: string
          inserted_rows?: number
          invalid_rows?: number
          job_key?: string | null
          mode?: string
          organization_id: string
          source?: string
          started_at?: string | null
          status?: string
          summary?: Json
          total_rows?: number
          updated_at?: string
          updated_rows?: number
          valid_rows?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_rows?: number
          dry_run?: boolean
          entity_type?: string
          error_code?: string | null
          error_message?: string | null
          file_mime?: string | null
          file_name?: string | null
          file_sha256?: string | null
          file_size_bytes?: number | null
          file_url?: string | null
          finished_at?: string | null
          id?: string
          inserted_rows?: number
          invalid_rows?: number
          job_key?: string | null
          mode?: string
          organization_id?: string
          source?: string
          started_at?: string | null
          status?: string
          summary?: Json
          total_rows?: number
          updated_at?: string
          updated_rows?: number
          valid_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_staging_rows: {
        Row: {
          created_at: string
          data: Json
          id: string
          import_job_id: string
          normalized_key: string | null
          organization_id: string
          row_number: number
          validation_status: string
        }
        Insert: {
          created_at?: string
          data: Json
          id?: string
          import_job_id: string
          normalized_key?: string | null
          organization_id: string
          row_number: number
          validation_status?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          import_job_id?: string
          normalized_key?: string | null
          organization_id?: string
          row_number?: number
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_import_staging_jobs_org"
            columns: ["organization_id", "import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "import_staging_rows_import_job_id_fkey"
            columns: ["import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_staging_rows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_delivery: {
        Row: {
          channel: string
          created_at: string
          error_reason: string | null
          id: string
          invoice_id: string
          organization_id: string
          sent_at: string | null
          status: string
          to_address: string | null
        }
        Insert: {
          channel?: string
          created_at?: string
          error_reason?: string | null
          id?: string
          invoice_id: string
          organization_id: string
          sent_at?: string | null
          status?: string
          to_address?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          error_reason?: string | null
          id?: string
          invoice_id?: string
          organization_id?: string
          sent_at?: string | null
          status?: string
          to_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_invoice_delivery_invoices_org"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoice_delivery_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_delivery_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          error_reason: string | null
          id: string
          invoice_number: string | null
          order_id: string
          organization_id: string
          paid_at: string | null
          pdf_url: string | null
          sent_at: string | null
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_reason?: string | null
          id?: string
          invoice_number?: string | null
          order_id: string
          organization_id: string
          paid_at?: string | null
          pdf_url?: string | null
          sent_at?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_reason?: string | null
          id?: string
          invoice_number?: string | null
          order_id?: string
          organization_id?: string
          paid_at?: string | null
          pdf_url?: string | null
          sent_at?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_invoices_orders_org"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string | null
          buyer_company_id: string | null
          contact_id: string | null
          created_at: string
          id: string
          organization_id: string
          raw_text_for_agent: string | null
          source: string
          status: string
          subject: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          buyer_company_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          raw_text_for_agent?: string | null
          source: string
          status?: string
          subject?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          buyer_company_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          raw_text_for_agent?: string | null
          source?: string
          status?: string
          subject?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_buyer_company_id_fkey"
            columns: ["buyer_company_id"]
            isOneToOne: false
            referencedRelation: "buyer_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          amount: number
          created_at: string
          id: string
          meta_json: Json
          order_id: string
          organization_id: string
          price_per_unit: number
          product_id: string | null
          qty: number
          title: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          meta_json?: Json
          order_id: string
          organization_id: string
          price_per_unit?: number
          product_id?: string | null
          qty?: number
          title?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          meta_json?: Json
          order_id?: string
          organization_id?: string
          price_per_unit?: number
          product_id?: string | null
          qty?: number
          title?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_order_items_orders_org"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "fk_order_items_product"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          buyer_company_id: string | null
          comment: string | null
          contact_id: string | null
          created_at: string
          currency: string
          delivery_price: number
          delivery_required: boolean
          id: string
          items_total: number
          lead_id: string | null
          order_number: string | null
          organization_id: string
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          buyer_company_id?: string | null
          comment?: string | null
          contact_id?: string | null
          created_at?: string
          currency?: string
          delivery_price?: number
          delivery_required?: boolean
          id?: string
          items_total?: number
          lead_id?: string | null
          order_number?: string | null
          organization_id: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          buyer_company_id?: string | null
          comment?: string | null
          contact_id?: string | null
          created_at?: string
          currency?: string
          delivery_price?: number
          delivery_required?: boolean
          id?: string
          items_total?: number
          lead_id?: string | null
          order_number?: string | null
          organization_id?: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_buyer_company_id_fkey"
            columns: ["buyer_company_id"]
            isOneToOne: false
            referencedRelation: "buyer_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_channels: {
        Row: {
          channel_type: string
          channel_value: string
          created_at: string
          id: string
          is_active: boolean
          organization_id: string
          updated_at: string
        }
        Insert: {
          channel_type: string
          channel_value: string
          created_at?: string
          id?: string
          is_active?: boolean
          organization_id: string
          updated_at?: string
        }
        Update: {
          channel_type?: string
          channel_value?: string
          created_at?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_features: {
        Row: {
          config: Json
          created_at: string
          enabled: boolean
          feature_code: string
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          enabled?: boolean
          feature_code: string
          id?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          enabled?: boolean
          feature_code?: string
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_features_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          id: string
          name: string
          plan: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          name: string
          plan?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          name?: string
          plan?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      outbound_campaigns: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
          script_json: Json
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
          script_json?: Json
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          script_json?: Json
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_targets: {
        Row: {
          campaign_id: string
          created_at: string
          email: string | null
          id: string
          last_attempt_at: string | null
          organization_id: string
          phone: string | null
          result_notes: string | null
          status: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          email?: string | null
          id?: string
          last_attempt_at?: string | null
          organization_id: string
          phone?: string | null
          result_notes?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          email?: string | null
          id?: string
          last_attempt_at?: string | null
          organization_id?: string
          phone?: string | null
          result_notes?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_outbound_targets_campaigns_org"
            columns: ["organization_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "outbound_campaigns"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "outbound_targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "outbound_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_targets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      parsed_leads: {
        Row: {
          company_name: string | null
          created_at: string
          email: string | null
          id: string
          location: string | null
          organization_id: string
          phone: string | null
          quality_score: number | null
          site: string | null
          source: string | null
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          location?: string | null
          organization_id: string
          phone?: string | null
          quality_score?: number | null
          site?: string | null
          source?: string | null
        }
        Update: {
          company_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          location?: string | null
          organization_id?: string
          phone?: string | null
          quality_score?: number | null
          site?: string | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parsed_leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      product_catalog: {
        Row: {
          base_price_rub_m2: number
          bq_key: string | null
          coating: string | null
          created_at: string
          extra_params: Json
          id: string
          is_active: boolean
          notes: string | null
          organization_id: string
          profile: string | null
          sku: string | null
          thickness_mm: number | null
          title: string | null
          updated_at: string
          weight_kg_m2: number | null
          width_full_mm: number | null
          width_work_mm: number | null
        }
        Insert: {
          base_price_rub_m2?: number
          bq_key?: string | null
          coating?: string | null
          created_at?: string
          extra_params?: Json
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id: string
          profile?: string | null
          sku?: string | null
          thickness_mm?: number | null
          title?: string | null
          updated_at?: string
          weight_kg_m2?: number | null
          width_full_mm?: number | null
          width_work_mm?: number | null
        }
        Update: {
          base_price_rub_m2?: number
          bq_key?: string | null
          coating?: string | null
          created_at?: string
          extra_params?: Json
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string
          profile?: string | null
          sku?: string | null
          thickness_mm?: number | null
          title?: string | null
          updated_at?: string
          weight_kg_m2?: number | null
          width_full_mm?: number | null
          width_work_mm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_catalog_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_color_overrides: {
        Row: {
          availability_status: string
          color_surcharge_rub_m2: number | null
          created_at: string
          id: string
          lead_time_days: number | null
          organization_id: string
          product_id: string
          ral: string
          stock_qty: number | null
          updated_at: string
        }
        Insert: {
          availability_status?: string
          color_surcharge_rub_m2?: number | null
          created_at?: string
          id?: string
          lead_time_days?: number | null
          organization_id: string
          product_id: string
          ral: string
          stock_qty?: number | null
          updated_at?: string
        }
        Update: {
          availability_status?: string
          color_surcharge_rub_m2?: number | null
          created_at?: string
          id?: string
          lead_time_days?: number | null
          organization_id?: string
          product_id?: string
          ral?: string
          stock_qty?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_color_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_color_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_color_overrides_ral_fkey"
            columns: ["ral"]
            isOneToOne: false
            referencedRelation: "ral_colors"
            referencedColumns: ["ral"]
          },
        ]
      }
      product_color_policies: {
        Row: {
          created_at: string
          group_code: string | null
          id: string
          organization_id: string
          policy_type: string
          priority: number
          product_id: string
          ral_list: string[] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_code?: string | null
          id?: string
          organization_id: string
          policy_type: string
          priority?: number
          product_id: string
          ral_list?: string[] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_code?: string | null
          id?: string
          organization_id?: string
          policy_type?: string
          priority?: number
          product_id?: string
          ral_list?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_color_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_color_policies_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          organization_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          organization_id: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          organization_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ral_colors: {
        Row: {
          group_code: string
          is_active: boolean
          name: string | null
          ral: string
        }
        Insert: {
          group_code?: string
          is_active?: boolean
          name?: string | null
          ral: string
        }
        Update: {
          group_code?: string
          is_active?: boolean
          name?: string | null
          ral?: string
        }
        Relationships: []
      }
      usage_logs: {
        Row: {
          cost_rub: number
          created_at: string
          duration_seconds: number
          event_type: string
          id: string
          lead_id: string | null
          organization_id: string
          source_id: string | null
          tokens_in: number
          tokens_out: number
        }
        Insert: {
          cost_rub?: number
          created_at?: string
          duration_seconds?: number
          event_type: string
          id?: string
          lead_id?: string | null
          organization_id: string
          source_id?: string | null
          tokens_in?: number
          tokens_out?: number
        }
        Update: {
          cost_rub?: number
          created_at?: string
          duration_seconds?: number
          event_type?: string
          id?: string
          lead_id?: string | null
          organization_id?: string
          source_id?: string | null
          tokens_in?: number
          tokens_out?: number
        }
        Relationships: [
          {
            foreignKeyName: "usage_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_billing_transaction: {
        Args: {
          p_amount_rub: number
          p_block_negative?: boolean
          p_idempotency_key: string
          p_organization_id: string
          p_reason: string
          p_reference_id: string
          p_reference_type: string
          p_type: string
        }
        Returns: {
          amount_rub: number
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          organization_id: string
          reason: string
          reference_id: string | null
          reference_type: string | null
          type: string
        }
        SetofOptions: {
          from: "*"
          to: "billing_transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_balance_row: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      get_available_colors: {
        Args: { p_product_id: string }
        Returns: {
          availability_status: string
          group_code: string
          lead_time_days: number
          ral: string
          ral_name: string
          surcharge_rub_m2: number
        }[]
      }
      get_price_by_color: {
        Args: { p_product_id: string; p_ral: string }
        Returns: number
      }
      is_org_admin: { Args: { org_id: string }; Returns: boolean }
      is_org_member: { Args: { org_id: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_service_role: { Args: never; Returns: boolean }
      normalize_email: { Args: { p_email: string }; Returns: string }
      normalize_phone_digits: { Args: { p_phone: string }; Returns: string }
      recalc_order_totals: { Args: { p_order_id: string }; Returns: undefined }
      rpc_cancel_outbound_email: {
        Args: { p_organization_id: string; p_outbox_id: string }
        Returns: boolean
      }
      rpc_change_user_role: {
        Args: {
          p_new_role: string
          p_organization_id: string
          p_user_id: string
        }
        Returns: string
      }
      rpc_invite_user_to_org: {
        Args: {
          p_email?: string
          p_full_name?: string
          p_organization_id: string
          p_role?: string
          p_user_id: string
        }
        Returns: string
      }
      rpc_onboard_create_org: {
        Args: { p_org_name: string; p_plan?: string }
        Returns: string
      }
      rpc_queue_outbound_email: {
        Args: {
          p_body_text: string
          p_from_account_id: string
          p_idempotency_key?: string
          p_lead_id?: string
          p_organization_id: string
          p_subject: string
          p_thread_id?: string
          p_to_email: string
        }
        Returns: string
      }
      rpc_remove_user_from_org: {
        Args: { p_organization_id: string; p_user_id: string }
        Returns: boolean
      }
      rpc_transfer_org_ownership: {
        Args: { p_new_owner_user_id: string; p_organization_id: string }
        Returns: boolean
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
