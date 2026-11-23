export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor: string | null
          actor_name: string | null
          actor_role: Database["public"]["Enums"]["member_role"] | null
          at: string
          category: string
          clinic_id: string
          data: Json
          id: number
          patient_id: string | null
          patient_name: string | null
          sensitive: boolean
        }
        Insert: {
          id?: never
        }
        Update: {
          id?: never
        }
        Relationships: []
      }
      allergy_groups: {
        Row: {
          code: string
          keywords: string[]
          label_ar: string
          label_en: string
        }
        Insert: {
          code: string
          keywords?: string[]
          label_ar: string
          label_en: string
        }
        Update: {
          code?: string
          keywords?: string[]
          label_ar?: string
          label_en?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          booked_name: string | null
          chair_id: string
          clinic_id: string
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          doctor_id: string | null
          ends_at: string
          id: string
          notes: string | null
          patient_id: string
          procedure_id: string | null
          source: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          treatment_plan_id: string | null
        }
        Insert: {
          booked_name?: string | null
          chair_id: string
          clinic_id: string
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id?: string | null
          ends_at: string
          id?: string
          notes?: string | null
          patient_id: string
          procedure_id?: string | null
          source?: string
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          treatment_plan_id?: string | null
        }
        Update: {
          booked_name?: string | null
          chair_id?: string
          clinic_id?: string
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id?: string | null
          ends_at?: string
          id?: string
          notes?: string | null
          patient_id?: string
          procedure_id?: string | null
          source?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          treatment_plan_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_chair_id_clinic_id_fkey"
            columns: ["chair_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "chairs"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "appointments_clinic_id_doctor_id_fkey"
            columns: ["clinic_id", "doctor_id"]
            isOneToOne: false
            referencedRelation: "clinic_members"
            referencedColumns: ["clinic_id", "user_id"]
          },
          {
            foreignKeyName: "appointments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "appointments_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
          {
            foreignKeyName: "appointments_procedure_id_clinic_id_fkey"
            columns: ["procedure_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "appointments_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_balance"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "appointments_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_overview"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "appointments_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "appointments_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "unscheduled_treatment"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
        ]
      }
      assistant_queries: {
        Row: {
          answered: boolean
          asked_at: string
          asked_by: string
          clinic_id: string
          error: string | null
          id: string
          question: string
          tools_used: string[]
        }
        Insert: {
          answered?: boolean
          asked_at?: string
          asked_by?: string
          clinic_id: string
          error?: string | null
          id?: string
          question: string
          tools_used?: string[]
        }
        Update: {
          answered?: boolean
          asked_at?: string
          asked_by?: string
          clinic_id?: string
          error?: string | null
          id?: string
          question?: string
          tools_used?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "assistant_queries_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_closings: {
        Row: {
          business_date: string
          cash_in: number
          cash_out: number
          clinic_id: string
          closed_at: string
          closed_by: string
          counted_cash: number
          difference: number
          expected_cash: number
          id: string
          note: string | null
          opening_float: number
          reason: string | null
        }
        Insert: {
          business_date: string
          cash_in: number
          cash_out: number
          clinic_id: string
          closed_at?: string
          closed_by?: string
          counted_cash: number
          difference: number
          expected_cash: number
          id?: string
          note?: string | null
          opening_float: number
          reason?: string | null
        }
        Update: {
          business_date?: string
          cash_in?: number
          cash_out?: number
          clinic_id?: string
          closed_at?: string
          closed_by?: string
          counted_cash?: number
          difference?: number
          expected_cash?: number
          id?: string
          note?: string | null
          opening_float?: number
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_closings_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      chairs: {
        Row: {
          active: boolean
          clinic_id: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          clinic_id: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          clinic_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "chairs_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_members: {
        Row: {
          active: boolean
          clinic_id: string
          commission_percent: number
          created_at: string
          display_name: string
          phone: string | null
          registration_no: string | null
          role: Database["public"]["Enums"]["member_role"]
          specialty: string | null
          user_id: string
          work_days: number[]
          works_from: string | null
          works_to: string | null
        }
        Insert: {
          active?: boolean
          clinic_id: string
          commission_percent?: number
          created_at?: string
          display_name: string
          phone?: string | null
          registration_no?: string | null
          role: Database["public"]["Enums"]["member_role"]
          specialty?: string | null
          user_id: string
          work_days?: number[]
          works_from?: string | null
          works_to?: string | null
        }
        Update: {
          active?: boolean
          clinic_id?: string
          commission_percent?: number
          created_at?: string
          display_name?: string
          phone?: string | null
          registration_no?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          specialty?: string | null
          user_id?: string
          work_days?: number[]
          works_from?: string | null
          works_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinic_members_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinics: {
        Row: {
          admin_percent: number
          booking_daily_limit: number
          booking_enabled: boolean
          booking_horizon_days: number
          booking_min_notice_hours: number
          booking_slug: string | null
          booking_show_prices: boolean
          closed_weekdays: number[]
          address: string | null
          cash_float: number
          closes_at: string
          commission_basis: string
          created_at: string
          currency: string
          grace_days: number
          id: string
          installment_day: number | null
          lab_stage_days: number
          legal_venue: string | null
          lock_threshold: number
          logo_url: string | null
          name: string
          next_receipt_no: number
          opens_at: string
          represented_by: string | null
          slot_minutes: number
          suspend_after_days: number
          timezone: string
        }
        Insert: {
          admin_percent?: number
          booking_daily_limit?: number
          booking_enabled?: boolean
          booking_horizon_days?: number
          booking_min_notice_hours?: number
          booking_slug?: string | null
          booking_show_prices?: boolean
          closed_weekdays?: number[]
          address?: string | null
          cash_float?: number
          closes_at?: string
          commission_basis?: string
          created_at?: string
          currency?: string
          grace_days?: number
          id?: string
          installment_day?: number | null
          lab_stage_days?: number
          legal_venue?: string | null
          lock_threshold?: number
          logo_url?: string | null
          name: string
          next_receipt_no?: number
          opens_at?: string
          represented_by?: string | null
          slot_minutes?: number
          suspend_after_days?: number
          timezone?: string
        }
        Update: {
          admin_percent?: number
          booking_daily_limit?: number
          booking_enabled?: boolean
          booking_horizon_days?: number
          booking_min_notice_hours?: number
          booking_slug?: string | null
          booking_show_prices?: boolean
          closed_weekdays?: number[]
          address?: string | null
          cash_float?: number
          closes_at?: string
          commission_basis?: string
          created_at?: string
          currency?: string
          grace_days?: number
          id?: string
          installment_day?: number | null
          lab_stage_days?: number
          legal_venue?: string | null
          lock_threshold?: number
          logo_url?: string | null
          name?: string
          next_receipt_no?: number
          opens_at?: string
          represented_by?: string | null
          slot_minutes?: number
          suspend_after_days?: number
          timezone?: string
        }
        Relationships: []
      }
      deleted_patients: {
        Row: {
          clinic_id: string
          counts: Json
          deleted_at: string
          deleted_by: string
          full_name: string
          id: string
          phone: string | null
          reason: string | null
        }
        Insert: {
          clinic_id: string
          counts: Json
          deleted_at?: string
          deleted_by?: string
          full_name: string
          id?: string
          phone?: string | null
          reason?: string | null
        }
        Update: {
          clinic_id?: string
          counts?: Json
          deleted_at?: string
          deleted_by?: string
          full_name?: string
          id?: string
          phone?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deleted_patients_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_payouts: {
        Row: {
          amount: number
          clinic_id: string
          created_at: string
          created_by: string
          expense_id: string | null
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          paid_on: string
          period_from: string | null
          period_to: string | null
          user_id: string
        }
        Insert: {
          amount: number
          clinic_id: string
          created_at?: string
          created_by?: string
          expense_id?: string | null
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          paid_on: string
          period_from?: string | null
          period_to?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          clinic_id?: string
          created_at?: string
          created_by?: string
          expense_id?: string | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          paid_on?: string
          period_from?: string | null
          period_to?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_payouts_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_payouts_clinic_id_user_id_fkey"
            columns: ["clinic_id", "user_id"]
            isOneToOne: false
            referencedRelation: "clinic_members"
            referencedColumns: ["clinic_id", "user_id"]
          },
          {
            foreignKeyName: "doctor_payouts_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      drugs: {
        Row: {
          active: boolean
          allergy_group: string | null
          clinic_id: string
          created_at: string
          default_dose: string | null
          default_duration: string | null
          default_frequency: string | null
          default_notes: string | null
          form: string | null
          generic_name: string | null
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          allergy_group?: string | null
          clinic_id: string
          created_at?: string
          default_dose?: string | null
          default_duration?: string | null
          default_frequency?: string | null
          default_notes?: string | null
          form?: string | null
          generic_name?: string | null
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          allergy_group?: string | null
          clinic_id?: string
          created_at?: string
          default_dose?: string | null
          default_duration?: string | null
          default_frequency?: string | null
          default_notes?: string | null
          form?: string | null
          generic_name?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "drugs_allergy_group_fkey"
            columns: ["allergy_group"]
            isOneToOne: false
            referencedRelation: "allergy_groups"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "drugs_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          clinic_id: string
          created_at: string
          created_by: string | null
          id: string
          lab_case_id: string | null
          material_movement_id: string | null
          method: Database["public"]["Enums"]["payment_method"] | null
          note: string | null
          paid_to: string | null
          spent_on: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          clinic_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          lab_case_id?: string | null
          material_movement_id?: string | null
          method?: Database["public"]["Enums"]["payment_method"] | null
          note?: string | null
          paid_to?: string | null
          spent_on: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          amount?: number
          category?: Database["public"]["Enums"]["expense_category"]
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lab_case_id?: string | null
          material_movement_id?: string | null
          method?: Database["public"]["Enums"]["payment_method"] | null
          note?: string | null
          paid_to?: string | null
          spent_on?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_lab_case_id_fkey"
            columns: ["lab_case_id"]
            isOneToOne: true
            referencedRelation: "lab_case_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_lab_case_id_fkey"
            columns: ["lab_case_id"]
            isOneToOne: true
            referencedRelation: "lab_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_material_movement_id_fkey"
            columns: ["material_movement_id"]
            isOneToOne: true
            referencedRelation: "material_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      form_requests: {
        Row: {
          clinic_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          patient_id: string
          template_id: string
          token_hash: string
          treatment_plan_id: string | null
        }
        Insert: {
          clinic_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          patient_id: string
          template_id: string
          token_hash: string
          treatment_plan_id?: string | null
        }
        Update: {
          clinic_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          patient_id?: string
          template_id?: string
          token_hash?: string
          treatment_plan_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_requests_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_requests_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "form_requests_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
          {
            foreignKeyName: "form_requests_template_id_clinic_id_fkey"
            columns: ["template_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "form_requests_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_balance"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "form_requests_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_overview"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "form_requests_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "form_requests_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "unscheduled_treatment"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
        ]
      }
      form_submissions: {
        Row: {
          answers: Json
          clinic_id: string
          id: string
          patient_id: string
          request_id: string | null
          signature_data: string
          signed_at: string
          signed_by_name: string
          template_id: string
          treatment_plan_id: string | null
        }
        Insert: {
          answers: Json
          clinic_id: string
          id?: string
          patient_id: string
          request_id?: string | null
          signature_data: string
          signed_at?: string
          signed_by_name: string
          template_id: string
          treatment_plan_id?: string | null
        }
        Update: {
          answers?: Json
          clinic_id?: string
          id?: string
          patient_id?: string
          request_id?: string | null
          signature_data?: string
          signed_at?: string
          signed_by_name?: string
          template_id?: string
          treatment_plan_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "form_submissions_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
          {
            foreignKeyName: "form_submissions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "form_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_template_id_clinic_id_fkey"
            columns: ["template_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "form_submissions_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_balance"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "form_submissions_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_overview"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "form_submissions_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "form_submissions_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "unscheduled_treatment"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
        ]
      }
      form_templates: {
        Row: {
          active: boolean
          body: Json
          clinic_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          title: string
          version: number
        }
        Insert: {
          active?: boolean
          body: Json
          clinic_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          title: string
          version?: number
        }
        Update: {
          active?: boolean
          body?: Json
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_templates_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      installment_agreements: {
        Row: {
          clinic_id: string
          created_at: string
          document_path: string | null
          id: string
          installment_plan_id: string
          signature_data: string | null
          signed_at: string | null
          signed_by_name: string | null
          terms: Json
          version: number
        }
        Insert: {
          clinic_id: string
          created_at?: string
          document_path?: string | null
          id?: string
          installment_plan_id: string
          signature_data?: string | null
          signed_at?: string | null
          signed_by_name?: string | null
          terms: Json
          version: number
        }
        Update: {
          clinic_id?: string
          created_at?: string
          document_path?: string | null
          id?: string
          installment_plan_id?: string
          signature_data?: string | null
          signed_at?: string | null
          signed_by_name?: string | null
          terms?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "installment_agreements_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_agreements_installment_plan_id_clinic_id_fkey"
            columns: ["installment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "installment_plan_summary"
            referencedColumns: ["installment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "installment_agreements_installment_plan_id_clinic_id_fkey"
            columns: ["installment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "installment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      installment_plan_revisions: {
        Row: {
          changed_at: string
          changed_by: string | null
          clinic_id: string
          id: string
          installment_plan_id: string
          new_months: number
          new_net_total: number
          old_net_total: number
          paid_at_revision: number
          reason: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          clinic_id: string
          id?: string
          installment_plan_id: string
          new_months: number
          new_net_total: number
          old_net_total: number
          paid_at_revision: number
          reason: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          clinic_id?: string
          id?: string
          installment_plan_id?: string
          new_months?: number
          new_net_total?: number
          old_net_total?: number
          paid_at_revision?: number
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_plan_revisions_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plan_revisions_installment_plan_id_clinic_id_fkey"
            columns: ["installment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "installment_plan_summary"
            referencedColumns: ["installment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "installment_plan_revisions_installment_plan_id_clinic_id_fkey"
            columns: ["installment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "installment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      installment_plans: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          clinic_id: string
          created_at: string
          created_by: string | null
          down_payment: number
          first_due_date: string | null
          id: string
          months: number
          net_total: number
          patient_id: string
          status: Database["public"]["Enums"]["installment_plan_status"]
          treatment_plan_id: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          clinic_id: string
          created_at?: string
          created_by?: string | null
          down_payment?: number
          first_due_date?: string | null
          id?: string
          months: number
          net_total: number
          patient_id: string
          status?: Database["public"]["Enums"]["installment_plan_status"]
          treatment_plan_id: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          down_payment?: number
          first_due_date?: string | null
          id?: string
          months?: number
          net_total?: number
          patient_id?: string
          status?: Database["public"]["Enums"]["installment_plan_status"]
          treatment_plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_plans_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "installment_plans_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
          {
            foreignKeyName: "installment_plans_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_balance"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "installment_plans_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_overview"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "installment_plans_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "installment_plans_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "unscheduled_treatment"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
        ]
      }
      installments: {
        Row: {
          amount: number
          cancelled_at: string | null
          clinic_id: string
          created_at: string
          due_date: string
          id: string
          installment_plan_id: string
          is_down_payment: boolean
          seq: number
        }
        Insert: {
          amount: number
          cancelled_at?: string | null
          clinic_id: string
          created_at?: string
          due_date: string
          id?: string
          installment_plan_id: string
          is_down_payment?: boolean
          seq: number
        }
        Update: {
          amount?: number
          cancelled_at?: string | null
          clinic_id?: string
          created_at?: string
          due_date?: string
          id?: string
          installment_plan_id?: string
          is_down_payment?: boolean
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "installments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installments_installment_plan_id_clinic_id_fkey"
            columns: ["installment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "installment_plan_summary"
            referencedColumns: ["installment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "installments_installment_plan_id_clinic_id_fkey"
            columns: ["installment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "installment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      lab_cases: {
        Row: {
          billing_on: string | null
          cancelled_at: string | null
          clinic_id: string
          created_at: string
          created_by: string | null
          description: string
          doctor_id: string | null
          expected_on: string
          fitted_on: string | null
          id: string
          invoiced_amount: number | null
          item_id: string | null
          lab_fee: number | null
          lab_id: string
          needs_tryin: boolean
          notes: string | null
          patient_id: string
          plan_item_id: string | null
          received_on: string | null
          sent_on: string
          shade: string | null
          tryin_done_on: string | null
          tryin_expected_on: string | null
          tryin_received_on: string | null
          unit_price: number | null
          units: number
        }
        Insert: {
          billing_on?: string | null
          cancelled_at?: string | null
          clinic_id: string
          created_at?: string
          created_by?: string | null
          description: string
          doctor_id?: string | null
          expected_on: string
          fitted_on?: string | null
          id?: string
          invoiced_amount?: number | null
          item_id?: string | null
          lab_fee?: number | null
          lab_id: string
          needs_tryin?: boolean
          notes?: string | null
          patient_id: string
          plan_item_id?: string | null
          received_on?: string | null
          sent_on: string
          shade?: string | null
          tryin_done_on?: string | null
          tryin_expected_on?: string | null
          tryin_received_on?: string | null
          unit_price?: number | null
          units?: number
        }
        Update: {
          billing_on?: string | null
          cancelled_at?: string | null
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          doctor_id?: string | null
          expected_on?: string
          fitted_on?: string | null
          id?: string
          invoiced_amount?: number | null
          item_id?: string | null
          lab_fee?: number | null
          lab_id?: string
          needs_tryin?: boolean
          notes?: string | null
          patient_id?: string
          plan_item_id?: string | null
          received_on?: string | null
          sent_on?: string
          shade?: string | null
          tryin_done_on?: string | null
          tryin_expected_on?: string | null
          tryin_received_on?: string | null
          unit_price?: number | null
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "lab_cases_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_cases_doctor_fk"
            columns: ["clinic_id", "doctor_id"]
            isOneToOne: false
            referencedRelation: "clinic_members"
            referencedColumns: ["clinic_id", "user_id"]
          },
          {
            foreignKeyName: "lab_cases_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "lab_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_cases_lab_id_clinic_id_fkey"
            columns: ["lab_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "lab_cases_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "lab_cases_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
          {
            foreignKeyName: "lab_cases_plan_item_id_fkey"
            columns: ["plan_item_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_items"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_items: {
        Row: {
          active: boolean
          clinic_id: string
          created_at: string
          id: string
          lab_id: string | null
          name: string
          unit_price: number
        }
        Insert: {
          active?: boolean
          clinic_id: string
          created_at?: string
          id?: string
          lab_id?: string | null
          name: string
          unit_price?: number
        }
        Update: {
          active?: boolean
          clinic_id?: string
          created_at?: string
          id?: string
          lab_id?: string | null
          name?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "lab_items_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_items_lab_id_clinic_id_fkey"
            columns: ["lab_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      labs: {
        Row: {
          active: boolean
          clinic_id: string
          id: string
          name: string
          phone: string | null
        }
        Insert: {
          active?: boolean
          clinic_id: string
          id?: string
          name: string
          phone?: string | null
        }
        Update: {
          active?: boolean
          clinic_id?: string
          id?: string
          name?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "labs_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      material_movements: {
        Row: {
          clinic_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["movement_kind"]
          material_id: string
          note: string | null
          occurred_on: string
          plan_item_id: string | null
          quantity: number
          total_cost: number | null
        }
        Insert: {
          clinic_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["movement_kind"]
          material_id: string
          note?: string | null
          occurred_on?: string
          plan_item_id?: string | null
          quantity: number
          total_cost?: number | null
        }
        Update: {
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["movement_kind"]
          material_id?: string
          note?: string | null
          occurred_on?: string
          plan_item_id?: string | null
          quantity?: number
          total_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "material_movements_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_movements_material_id_clinic_id_fkey"
            columns: ["material_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "material_stock"
            referencedColumns: ["material_id", "clinic_id"]
          },
          {
            foreignKeyName: "material_movements_material_id_clinic_id_fkey"
            columns: ["material_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "material_movements_plan_item_id_fkey"
            columns: ["plan_item_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_items"
            referencedColumns: ["id"]
          },
        ]
      }
      materials: {
        Row: {
          active: boolean
          clinic_id: string
          created_at: string
          id: string
          min_stock: number
          name: string
          supplier_name: string | null
          supplier_phone: string | null
          unit: string
        }
        Insert: {
          active?: boolean
          clinic_id: string
          created_at?: string
          id?: string
          min_stock?: number
          name: string
          supplier_name?: string | null
          supplier_phone?: string | null
          unit?: string
        }
        Update: {
          active?: boolean
          clinic_id?: string
          created_at?: string
          id?: string
          min_stock?: number
          name?: string
          supplier_name?: string | null
          supplier_phone?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "materials_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          active: boolean
          clinic_id: string
          created_at: string
          id: string
          name: string
          note: string | null
          share_percent: number
          user_id: string | null
        }
        Insert: {
          active?: boolean
          clinic_id: string
          created_at?: string
          id?: string
          name: string
          note?: string | null
          share_percent?: number
          user_id?: string | null
        }
        Update: {
          active?: boolean
          clinic_id?: string
          created_at?: string
          id?: string
          name?: string
          note?: string | null
          share_percent?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partners_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_files: {
        Row: {
          caption: string | null
          caption_updated_at: string | null
          clinic_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["file_kind"]
          mime_type: string | null
          patient_id: string
          session_id: string | null
          size_bytes: number | null
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          caption_updated_at?: string | null
          clinic_id: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["file_kind"]
          mime_type?: string | null
          patient_id: string
          session_id?: string | null
          size_bytes?: number | null
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          caption_updated_at?: string | null
          clinic_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["file_kind"]
          mime_type?: string | null
          patient_id?: string
          session_id?: string | null
          size_bytes?: number | null
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_files_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_files_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "patient_files_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
          {
            foreignKeyName: "patient_files_session_id_clinic_id_fkey"
            columns: ["session_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      patients: {
        Row: {
          address: string | null
          allergy_groups: string[]
          archive_reason: string | null
          archived_at: string | null
          clinic_id: string
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          full_name: string
          gender: string | null
          id: string
          medical_alerts: string | null
          national_id: string | null
          next_recall_due: string | null
          notes: string | null
          payer_id: string | null
          phone: string
          primary_doctor_id: string | null
          recall_interval_months: number | null
          recall_type: string
          source: string | null
          source_note: string | null
          whatsapp_phone: string | null
        }
        Insert: {
          address?: string | null
          allergy_groups?: string[]
          archive_reason?: string | null
          archived_at?: string | null
          clinic_id: string
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          full_name: string
          gender?: string | null
          id?: string
          medical_alerts?: string | null
          national_id?: string | null
          next_recall_due?: string | null
          notes?: string | null
          payer_id?: string | null
          phone: string
          primary_doctor_id?: string | null
          recall_interval_months?: number | null
          recall_type?: string
          source?: string | null
          source_note?: string | null
          whatsapp_phone?: string | null
        }
        Update: {
          address?: string | null
          allergy_groups?: string[]
          archive_reason?: string | null
          archived_at?: string | null
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          full_name?: string
          gender?: string | null
          id?: string
          medical_alerts?: string | null
          national_id?: string | null
          next_recall_due?: string | null
          notes?: string | null
          payer_id?: string | null
          phone?: string
          primary_doctor_id?: string | null
          recall_interval_months?: number | null
          recall_type?: string
          source?: string | null
          source_note?: string | null
          whatsapp_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patients_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_clinic_id_primary_doctor_id_fkey"
            columns: ["clinic_id", "primary_doctor_id"]
            isOneToOne: false
            referencedRelation: "clinic_members"
            referencedColumns: ["clinic_id", "user_id"]
          },
          {
            foreignKeyName: "patients_payer_id_clinic_id_fkey"
            columns: ["payer_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "payers"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      payers: {
        Row: {
          active: boolean
          clinic_id: string
          created_at: string
          discount_percent: number
          id: string
          name: string
          note: string | null
          phone: string | null
        }
        Insert: {
          active?: boolean
          clinic_id: string
          created_at?: string
          discount_percent?: number
          id?: string
          name: string
          note?: string | null
          phone?: string | null
        }
        Update: {
          active?: boolean
          clinic_id?: string
          created_at?: string
          discount_percent?: number
          id?: string
          name?: string
          note?: string | null
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payers_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_allocations: {
        Row: {
          amount: number
          clinic_id: string
          created_at: string
          id: string
          installment_id: string
          payment_id: string
        }
        Insert: {
          amount: number
          clinic_id: string
          created_at?: string
          id?: string
          installment_id: string
          payment_id: string
        }
        Update: {
          amount?: number
          clinic_id?: string
          created_at?: string
          id?: string
          installment_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_installment_id_clinic_id_fkey"
            columns: ["installment_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "installment_agenda"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "payment_allocations_installment_id_clinic_id_fkey"
            columns: ["installment_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "installment_status"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "payment_allocations_installment_id_clinic_id_fkey"
            columns: ["installment_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "installments"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_clinic_id_fkey"
            columns: ["payment_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          clinic_id: string
          created_at: string
          id: string
          installment_plan_id: string | null
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          patient_id: string
          receipt_no: number
          received_at: string
          received_by: string | null
          reverses_payment_id: string | null
          treatment_plan_id: string | null
        }
        Insert: {
          amount: number
          clinic_id: string
          created_at?: string
          id?: string
          installment_plan_id?: string | null
          method: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          patient_id: string
          receipt_no: number
          received_at?: string
          received_by?: string | null
          reverses_payment_id?: string | null
          treatment_plan_id?: string | null
        }
        Update: {
          amount?: number
          clinic_id?: string
          created_at?: string
          id?: string
          installment_plan_id?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          patient_id?: string
          receipt_no?: number
          received_at?: string
          received_by?: string | null
          reverses_payment_id?: string | null
          treatment_plan_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_installment_plan_id_clinic_id_fkey"
            columns: ["installment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "installment_plan_summary"
            referencedColumns: ["installment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "payments_installment_plan_id_clinic_id_fkey"
            columns: ["installment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "installment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "payments_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "payments_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
          {
            foreignKeyName: "payments_reverses_payment_id_fkey"
            columns: ["reverses_payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_balance"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "payments_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_overview"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "payments_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "payments_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "unscheduled_treatment"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
        ]
      }
      prescription_items: {
        Row: {
          allergy_group: string | null
          clinic_id: string
          dose: string | null
          drug_id: string | null
          drug_name: string
          duration: string | null
          frequency: string | null
          id: string
          notes: string | null
          position: number
          prescription_id: string
        }
        Insert: {
          allergy_group?: string | null
          clinic_id: string
          dose?: string | null
          drug_id?: string | null
          drug_name: string
          duration?: string | null
          frequency?: string | null
          id?: string
          notes?: string | null
          position: number
          prescription_id: string
        }
        Update: {
          allergy_group?: string | null
          clinic_id?: string
          dose?: string | null
          drug_id?: string | null
          drug_name?: string
          duration?: string | null
          frequency?: string | null
          id?: string
          notes?: string | null
          position?: number
          prescription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescription_items_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_items_drug_id_fkey"
            columns: ["drug_id"]
            isOneToOne: false
            referencedRelation: "drugs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_items_prescription_id_clinic_id_fkey"
            columns: ["prescription_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      prescription_templates: {
        Row: {
          clinic_id: string
          created_at: string
          created_by: string | null
          id: string
          items: Json
          name: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          items?: Json
          name: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          items?: Json
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescription_templates_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          allergy_override_reason: string | null
          clinic_id: string
          id: string
          notes: string | null
          patient_id: string
          prescribed_at: string
          prescribed_by: string
          treatment_plan_id: string | null
        }
        Insert: {
          allergy_override_reason?: string | null
          clinic_id: string
          id?: string
          notes?: string | null
          patient_id: string
          prescribed_at?: string
          prescribed_by?: string
          treatment_plan_id?: string | null
        }
        Update: {
          allergy_override_reason?: string | null
          clinic_id?: string
          id?: string
          notes?: string | null
          patient_id?: string
          prescribed_at?: string
          prescribed_by?: string
          treatment_plan_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "prescriptions_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
          {
            foreignKeyName: "prescriptions_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_balance"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "prescriptions_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_overview"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "prescriptions_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "prescriptions_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "unscheduled_treatment"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
        ]
      }
      procedure_materials: {
        Row: {
          clinic_id: string
          material_id: string
          procedure_id: string
          quantity: number
        }
        Insert: {
          clinic_id: string
          material_id: string
          procedure_id: string
          quantity: number
        }
        Update: {
          clinic_id?: string
          material_id?: string
          procedure_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "procedure_materials_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedure_materials_material_id_clinic_id_fkey"
            columns: ["material_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "material_stock"
            referencedColumns: ["material_id", "clinic_id"]
          },
          {
            foreignKeyName: "procedure_materials_material_id_clinic_id_fkey"
            columns: ["material_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "procedure_materials_procedure_id_clinic_id_fkey"
            columns: ["procedure_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      procedures: {
        Row: {
          active: boolean
          aftercare_template: string | null
          bookable_online: boolean
          clinic_id: string
          default_duration_min: number
          default_price: number
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          aftercare_template?: string | null
          bookable_online?: boolean
          clinic_id: string
          default_duration_min?: number
          default_price: number
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          aftercare_template?: string | null
          bookable_online?: boolean
          clinic_id?: string
          default_duration_min?: number
          default_price?: number
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "procedures_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          appointment_id: string | null
          clinic_id: string
          created_at: string
          doctor_id: string | null
          id: string
          is_recall_visit: boolean
          lock_override: boolean
          notes: string | null
          override_by: string | null
          override_reason: string | null
          patient_id: string
          performed_at: string
          performed_by: string | null
          treatment_plan_id: string | null
        }
        Insert: {
          appointment_id?: string | null
          clinic_id: string
          created_at?: string
          doctor_id?: string | null
          id?: string
          is_recall_visit?: boolean
          lock_override?: boolean
          notes?: string | null
          override_by?: string | null
          override_reason?: string | null
          patient_id: string
          performed_at?: string
          performed_by?: string | null
          treatment_plan_id?: string | null
        }
        Update: {
          appointment_id?: string | null
          clinic_id?: string
          created_at?: string
          doctor_id?: string | null
          id?: string
          is_recall_visit?: boolean
          lock_override?: boolean
          notes?: string | null
          override_by?: string | null
          override_reason?: string | null
          patient_id?: string
          performed_at?: string
          performed_by?: string | null
          treatment_plan_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_appointment_id_clinic_id_fkey"
            columns: ["appointment_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "sessions_appointment_id_clinic_id_fkey"
            columns: ["appointment_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "pending_bookings"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "sessions_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_doctor_fk"
            columns: ["clinic_id", "doctor_id"]
            isOneToOne: false
            referencedRelation: "clinic_members"
            referencedColumns: ["clinic_id", "user_id"]
          },
          {
            foreignKeyName: "sessions_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "sessions_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
          {
            foreignKeyName: "sessions_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_balance"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "sessions_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_overview"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "sessions_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "sessions_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "unscheduled_treatment"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
        ]
      }
      treatment_plan_items: {
        Row: {
          clinic_id: string
          created_at: string
          description: string | null
          done_in_session_id: string | null
          id: string
          plan_id: string
          price: number
          procedure_id: string | null
          status: Database["public"]["Enums"]["plan_item_status"]
          tooth_number: number | null
        }
        Insert: {
          clinic_id: string
          created_at?: string
          description?: string | null
          done_in_session_id?: string | null
          id?: string
          plan_id: string
          price: number
          procedure_id?: string | null
          status?: Database["public"]["Enums"]["plan_item_status"]
          tooth_number?: number | null
        }
        Update: {
          clinic_id?: string
          created_at?: string
          description?: string | null
          done_in_session_id?: string | null
          id?: string
          plan_id?: string
          price?: number
          procedure_id?: string | null
          status?: Database["public"]["Enums"]["plan_item_status"]
          tooth_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plan_items_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plan_items_done_in_session_id_clinic_id_fkey"
            columns: ["done_in_session_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "treatment_plan_items_plan_id_clinic_id_fkey"
            columns: ["plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_balance"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "treatment_plan_items_plan_id_clinic_id_fkey"
            columns: ["plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_overview"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "treatment_plan_items_plan_id_clinic_id_fkey"
            columns: ["plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "treatment_plan_items_plan_id_clinic_id_fkey"
            columns: ["plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "unscheduled_treatment"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "treatment_plan_items_procedure_id_clinic_id_fkey"
            columns: ["procedure_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      treatment_plans: {
        Row: {
          accepted_at: string | null
          clinic_id: string
          created_at: string
          created_by: string | null
          decline_reason: string | null
          declined_at: string | null
          discount: number
          id: string
          notes: string | null
          patient_id: string
          payer_id: string | null
          payer_percent: number | null
          presented_at: string | null
          status: Database["public"]["Enums"]["plan_status"]
          title: string
        }
        Insert: {
          accepted_at?: string | null
          clinic_id: string
          created_at?: string
          created_by?: string | null
          decline_reason?: string | null
          declined_at?: string | null
          discount?: number
          id?: string
          notes?: string | null
          patient_id: string
          payer_id?: string | null
          payer_percent?: number | null
          presented_at?: string | null
          status?: Database["public"]["Enums"]["plan_status"]
          title: string
        }
        Update: {
          accepted_at?: string | null
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          decline_reason?: string | null
          declined_at?: string | null
          discount?: number
          id?: string
          notes?: string | null
          patient_id?: string
          payer_id?: string | null
          payer_percent?: number | null
          presented_at?: string | null
          status?: Database["public"]["Enums"]["plan_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plans_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plans_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "treatment_plans_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
          {
            foreignKeyName: "treatment_plans_payer_id_clinic_id_fkey"
            columns: ["payer_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "payers"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
    }
    Views: {
      case_acceptance_monthly: {
        Row: {
          acceptance_rate_pct: number | null
          accepted: number | null
          accepted_value: number | null
          clinic_id: string | null
          declined: number | null
          month: string | null
          presented: number | null
          presented_value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plans_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      installment_agenda: {
        Row: {
          amount: number | null
          clinic_id: string | null
          days_overdue: number | null
          due_date: string | null
          full_name: string | null
          grace_end: string | null
          id: string | null
          installment_plan_id: string | null
          is_down_payment: boolean | null
          is_partial: boolean | null
          last_paid_at: string | null
          paid: number | null
          patient_id: string | null
          phone: string | null
          remaining: number | null
          seq: number | null
          status: string | null
          treatment_plan_id: string | null
          whatsapp_phone: string | null
        }
        Relationships: [
          {
            foreignKeyName: "installments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installments_installment_plan_id_clinic_id_fkey"
            columns: ["installment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "installment_plan_summary"
            referencedColumns: ["installment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "installments_installment_plan_id_clinic_id_fkey"
            columns: ["installment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "installment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      installment_plan_summary: {
        Row: {
          clinic_id: string | null
          current_plan_total: number | null
          installment_plan_id: string | null
          needs_revision: boolean | null
          net_total: number | null
          next_due_date: string | null
          outstanding: number | null
          overdue_amount: number | null
          overdue_count: number | null
          patient_id: string | null
          sessions_locked: boolean | null
          status: Database["public"]["Enums"]["installment_plan_status"] | null
          total_paid: number | null
          treatment_plan_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "installment_plans_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "installment_plans_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
          {
            foreignKeyName: "installment_plans_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_balance"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "installment_plans_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_overview"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "installment_plans_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "installment_plans_treatment_plan_id_clinic_id_fkey"
            columns: ["treatment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "unscheduled_treatment"
            referencedColumns: ["treatment_plan_id", "clinic_id"]
          },
        ]
      }
      installment_status: {
        Row: {
          amount: number | null
          clinic_id: string | null
          days_overdue: number | null
          due_date: string | null
          grace_end: string | null
          id: string | null
          installment_plan_id: string | null
          is_down_payment: boolean | null
          is_partial: boolean | null
          last_paid_at: string | null
          paid: number | null
          patient_id: string | null
          remaining: number | null
          seq: number | null
          status: string | null
          treatment_plan_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "installments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installments_installment_plan_id_clinic_id_fkey"
            columns: ["installment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "installment_plan_summary"
            referencedColumns: ["installment_plan_id", "clinic_id"]
          },
          {
            foreignKeyName: "installments_installment_plan_id_clinic_id_fkey"
            columns: ["installment_plan_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "installment_plans"
            referencedColumns: ["id", "clinic_id"]
          },
        ]
      }
      lab_case_status: {
        Row: {
          at_risk: boolean | null
          billed_on: string | null
          billing_on: string | null
          cancelled_at: string | null
          clinic_id: string | null
          created_at: string | null
          created_by: string | null
          days_late: number | null
          description: string | null
          doctor_id: string | null
          doctor_name: string | null
          expected_on: string | null
          fitted_on: string | null
          full_name: string | null
          id: string | null
          invoiced_amount: number | null
          item_id: string | null
          item_name: string | null
          lab_fee: number | null
          lab_id: string | null
          lab_name: string | null
          needs_tryin: boolean | null
          next_appointment_at: string | null
          next_due: string | null
          notes: string | null
          patient_id: string | null
          plan_item_id: string | null
          received_on: string | null
          sent_on: string | null
          shade: string | null
          stage: string | null
          stage_late: boolean | null
          status: string | null
          tryin_done_on: string | null
          tryin_expected_on: string | null
          tryin_received_on: string | null
          turnaround_days: number | null
          unit_price: number | null
          units: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_cases_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_cases_doctor_fk"
            columns: ["clinic_id", "doctor_id"]
            isOneToOne: false
            referencedRelation: "clinic_members"
            referencedColumns: ["clinic_id", "user_id"]
          },
          {
            foreignKeyName: "lab_cases_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "lab_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_cases_lab_id_clinic_id_fkey"
            columns: ["lab_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "lab_cases_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "lab_cases_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
          {
            foreignKeyName: "lab_cases_plan_item_id_fkey"
            columns: ["plan_item_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_items"
            referencedColumns: ["id"]
          },
        ]
      }
      latest_medical_history: {
        Row: {
          answers: Json | null
          clinic_id: string | null
          needs_update: boolean | null
          patient_id: string | null
          signed_at: string | null
          submission_id: string | null
          title: string | null
          version: number | null
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "form_submissions_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
        ]
      }
      material_stock: {
        Row: {
          active: boolean | null
          clinic_id: string | null
          is_low: boolean | null
          last_purchase_on: string | null
          last_unit_cost: number | null
          material_id: string | null
          min_stock: number | null
          name: string | null
          on_hand: number | null
          supplier_name: string | null
          supplier_phone: string | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "materials_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_balance: {
        Row: {
          clinic_id: string | null
          outstanding: number | null
          overdue_amount: number | null
          overdue_count: number | null
          patient_id: string | null
          per_session_outstanding: number | null
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plans_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plans_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "treatment_plans_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
        ]
      }
      patient_payment_reliability: {
        Row: {
          avg_days_after_due: number | null
          clinic_id: string | null
          currently_overdue: number | null
          installments_paid: number | null
          overdue_amount: number | null
          paid_late: number | null
          patient_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "installments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_bookings: {
        Row: {
          booked_name: string | null
          clinic_id: string | null
          created_at: string | null
          ends_at: string | null
          full_name: string | null
          id: string | null
          notes: string | null
          patient_id: string | null
          phone: string | null
          service_name: string | null
          starts_at: string | null
          whatsapp_phone: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "appointments_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
        ]
      }
      recall_list: {
        Row: {
          clinic_id: string | null
          days_overdue: number | null
          full_name: string | null
          has_upcoming_appointment: boolean | null
          next_recall_due: string | null
          patient_id: string | null
          phone: string | null
          recall_type: string | null
          status: string | null
          whatsapp_phone: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patients_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_plan_balance: {
        Row: {
          billing: string | null
          clinic_id: string | null
          installment_plan_id: string | null
          net_total: number | null
          outstanding: number | null
          overdue_amount: number | null
          overdue_count: number | null
          paid: number | null
          patient_id: string | null
          sessions_locked: boolean | null
          status: Database["public"]["Enums"]["plan_status"] | null
          title: string | null
          treatment_plan_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plans_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plans_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "treatment_plans_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
        ]
      }
      treatment_plan_overview: {
        Row: {
          accepted_at: string | null
          clinic_id: string | null
          consent_signed: boolean | null
          decline_reason: string | null
          declined_at: string | null
          full_name: string | null
          net_total: number | null
          patient_id: string | null
          presented_at: string | null
          status: Database["public"]["Enums"]["plan_status"] | null
          title: string | null
          treatment_plan_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plans_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plans_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "treatment_plans_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
        ]
      }
      unscheduled_treatment: {
        Row: {
          accepted_at: string | null
          clinic_id: string | null
          full_name: string | null
          last_session_at: string | null
          patient_id: string | null
          phone: string | null
          remaining_items: number | null
          remaining_value: number | null
          title: string | null
          treatment_plan_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plans_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plans_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id", "clinic_id"]
          },
          {
            foreignKeyName: "treatment_plans_patient_id_clinic_id_fkey"
            columns: ["patient_id", "clinic_id"]
            isOneToOne: false
            referencedRelation: "recall_list"
            referencedColumns: ["patient_id", "clinic_id"]
          },
        ]
      }
    }
    Functions: {
      _generate_installments: {
        Args: {
          p_balance: number
          p_clinic: string
          p_first_due: string
          p_installment_plan: string
          p_months: number
          p_start_seq: number
        }
        Returns: undefined
      }
      _next_receipt_no: { Args: { p_clinic: string }; Returns: number }
      _snapshot_installment_agreement: {
        Args: { p_installment_plan_id: string; p_reason: string }
        Returns: undefined
      }
      agreements_needing_reissue: {
        Args: { p_clinic: string }
        Returns: {
          installment_plan_id: string
          net_total: number
          patient_id: string
          patient_name: string
          version: number
          was_signed: boolean
        }[]
      }
      archive_patient: {
        Args: { p_archive?: boolean; p_patient: string; p_reason?: string }
        Returns: undefined
      }
      assistant_day_schedule: {
        Args: { p_clinic: string; p_date: string }
        Returns: {
          chair: string
          doctor_name: string
          ends_at: string
          full_name: string
          notes: string
          phone: string
          starts_at: string
          status: string
        }[]
      }
      assistant_patient_brief: {
        Args: { p_clinic: string; p_query: string }
        Returns: {
          doctor_name: string
          full_name: string
          next_visit: string
          outstanding: number
          overdue_count: number
          patient_id: string
          phone: string
        }[]
      }
      attach_agreement_document: {
        Args: { p_agreement_id: string; p_document_path: string }
        Returns: undefined
      }
      book_appointment: {
        Args: {
          p_name: string
          p_note?: string
          p_phone: string
          p_procedure: string
          p_slug: string
          p_start: string
        }
        Returns: Json
      }
      booking_clinic: { Args: { p_slug: string }; Returns: Json }
      booking_day: {
        Args: { p_date: string; p_procedure: string; p_slug: string }
        Returns: {
          free: boolean
          slot: string
        }[]
      }
      audit_week: {
        Args: { p_clinic: string }
        Returns: Json
      }
      clinic_report: {
        Args: { p_clinic: string; p_from: string; p_to: string }
        Returns: Json
      }
      booking_slots: {
        Args: { p_date: string; p_procedure: string; p_slug: string }
        Returns: {
          slot: string
        }[]
      }
      can_handle_cash: { Args: { p_clinic: string }; Returns: boolean }
      cancel_installment_plan: {
        Args: { p_installment_plan_id: string; p_reason: string }
        Returns: undefined
      }
      cancel_treatment_plan: {
        Args: { p_plan: string; p_reason: string }
        Returns: undefined
      }
      cash_day_summary: {
        Args: { p_clinic: string; p_date: string }
        Returns: Json
      }
      clinic_profit: {
        Args: { p_clinic: string; p_from: string; p_to: string }
        Returns: Json
      }
      clinic_team: {
        Args: { p_clinic: string }
        Returns: {
          active: boolean
          commission_percent: number
          created_at: string
          display_name: string
          email: string
          last_sign_in: string
          phone: string
          registration_no: string
          role: Database["public"]["Enums"]["member_role"]
          specialty: string
          user_id: string
        }[]
      }
      clinic_today: { Args: { p_clinic: string }; Returns: string }
      collection_attribution: {
        Args: { p_clinic: string; p_from: string; p_to: string }
        Returns: Json
      }
      confirm_booking: { Args: { p_appointment: string }; Returns: undefined }
      create_clinic: {
        Args: { p_display_name: string; p_name: string }
        Returns: string
      }
      create_form_request: {
        Args: {
          p_patient_id: string
          p_template_id: string
          p_treatment_plan_id?: string
          p_valid_hours?: number
        }
        Returns: string
      }
      create_installment_plan: {
        Args: {
          p_down_payment: number
          p_first_due_date: string
          p_months: number
          p_treatment_plan_id: string
        }
        Returns: string
      }
      create_prescription: {
        Args: {
          p_items: Json
          p_notes?: string
          p_override_reason?: string
          p_patient_id: string
          p_treatment_plan_id?: string
        }
        Returns: string
      }
      delete_material: {
        Args: { p_force?: boolean; p_material: string }
        Returns: Json
      }
      delete_patient: {
        Args: { p_force?: boolean; p_patient: string; p_reason?: string }
        Returns: Json
      }
      delete_treatment_plan: { Args: { p_plan: string }; Returns: undefined }
      doctor_earnings: {
        Args: { p_clinic: string; p_from: string; p_to: string }
        Returns: {
          base_amount: number
          basis: string
          collected: number
          display_name: string
          earned: number
          lab_cost: number
          percent: number
          user_id: string
        }[]
      }
      doctor_overview: {
        Args: { p_clinic: string; p_from: string; p_to: string }
        Returns: {
          active: boolean
          appointments: number
          base_amount: number
          collected: number
          display_name: string
          earned: number
          earned_all_time: number
          lab_cost: number
          paid_all_time: number
          paid_in_period: number
          patients: number
          percent: number
          phone: string
          registration_no: string
          role: Database["public"]["Enums"]["member_role"]
          sessions: number
          specialty: string
          user_id: string
          work_days: number[]
          work_value: number
          works_from: string
          works_to: string
        }[]
      }
      doctor_patients: {
        Args: { p_clinic: string; p_doctor: string }
        Returns: {
          assigned: boolean
          full_name: string
          last_visit: string
          outstanding: number
          patient_id: string
          phone: string
          sessions: number
        }[]
      }
      finance_summary: {
        Args: { p_clinic: string; p_from: string; p_to: string }
        Returns: Json
      }
      get_form_by_token: { Args: { p_token: string }; Returns: Json }
      has_role: {
        Args: {
          p_clinic: string
          p_roles: Database["public"]["Enums"]["member_role"][]
        }
        Returns: boolean
      }
      is_doctor: { Args: { p_clinic: string }; Returns: boolean }
      is_member: { Args: { p_clinic: string }; Returns: boolean }
      lab_invoice_check: {
        Args: { p_clinic: string; p_from: string; p_to: string }
        Returns: {
          cases: number
          difference: number
          expected: number
          invoiced: number
          lab_id: string
          lab_name: string
          units: number
        }[]
      }
      lab_months: {
        Args: { p_clinic: string; p_lab: string }
        Returns: {
          cases: number
          difference: number
          expected: number
          invoiced: number
          month: string
          still_out: number
          units: number
        }[]
      }
      log_assistant_query: {
        Args: {
          p_answered: boolean
          p_clinic: string
          p_error?: string
          p_question: string
          p_tools: string[]
        }
        Returns: undefined
      }
      patient_record_counts: { Args: { p_patient: string }; Returns: Json }
      patient_sources: {
        Args: { p_clinic: string; p_from: string; p_to: string }
        Returns: {
          collected: number
          patients: number
          source: string
        }[]
      }
      plan_net_total: { Args: { p_plan: string }; Returns: number }
      prescription_conflicts: {
        Args: { p_drugs: string[]; p_patient: string }
        Returns: {
          allergy_group: string
          drug_id: string
          drug_name: string
          label_ar: string
          label_en: string
          source: string
        }[]
      }
      record_cash_closing: {
        Args: {
          p_clinic: string
          p_counted: number
          p_date: string
          p_note?: string
          p_reason?: string
        }
        Returns: string
      }
      record_direct_payment: {
        Args: {
          p_amount: number
          p_method: Database["public"]["Enums"]["payment_method"]
          p_note?: string
          p_patient_id: string
          p_treatment_plan_id?: string
        }
        Returns: string
      }
      record_doctor_payout: {
        Args: {
          p_amount: number
          p_clinic: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_note?: string
          p_paid_on?: string
          p_period_from?: string
          p_period_to?: string
          p_user: string
        }
        Returns: string
      }
      record_payment: {
        Args: {
          p_amount: number
          p_installment_plan_id: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_note?: string
        }
        Returns: string
      }
      record_purchase: {
        Args: {
          p_material_id: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_note?: string
          p_occurred_on?: string
          p_quantity: number
          p_total_cost: number
        }
        Returns: string
      }
      record_session: {
        Args: {
          p_doctor_id?: string
          p_done_item_ids?: string[]
          p_is_recall_visit: boolean
          p_notes: string
          p_override_reason?: string
          p_patient_id: string
          p_treatment_plan_id?: string
        }
        Returns: string
      }
      record_stock_count: {
        Args: { p_counted: number; p_material_id: string }
        Returns: number
      }
      record_usage: {
        Args: { p_material_id: string; p_note?: string; p_quantity: number }
        Returns: string
      }
      reissue_installment_agreement: {
        Args: { p_plan: string }
        Returns: number
      }
      reverse_payment: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: string
      }
      revise_installment_plan: {
        Args: {
          p_first_due_date: string
          p_installment_plan_id: string
          p_months: number
          p_reason: string
        }
        Returns: undefined
      }
      seed_default_drugs: { Args: { p_clinic: string }; Returns: undefined }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      sign_installment_agreement: {
        Args: {
          p_agreement_id: string
          p_signature_data: string
          p_signed_by_name: string
        }
        Returns: undefined
      }
      submit_form: {
        Args: {
          p_answers: Json
          p_signature_data: string
          p_signed_by_name: string
          p_token: string
        }
        Returns: string
      }
    }
    Enums: {
      appointment_status:
        | "booked"
        | "arrived"
        | "in_session"
        | "done"
        | "cancelled"
        | "no_show"
      expense_category:
        | "rent"
        | "salaries"
        | "materials"
        | "lab"
        | "utilities"
        | "maintenance"
        | "marketing"
        | "other"
        | "doctors"
        | "admin"
      file_kind: "xray" | "photo" | "document"
      installment_plan_status: "active" | "completed" | "cancelled"
      member_role: "owner" | "doctor" | "receptionist"
      movement_kind: "purchase" | "usage" | "auto_usage" | "adjustment"
      payment_method: "cash" | "card" | "instapay" | "wallet" | "bank_transfer"
      plan_item_status: "planned" | "done" | "cancelled"
      plan_status:
        | "draft"
        | "presented"
        | "declined"
        | "active"
        | "completed"
        | "cancelled"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      appointment_status: [
        "booked",
        "arrived",
        "in_session",
        "done",
        "cancelled",
        "no_show",
      ],
      expense_category: [
        "rent",
        "salaries",
        "materials",
        "lab",
        "utilities",
        "maintenance",
        "marketing",
        "other",
        "doctors",
        "admin",
      ],
      file_kind: ["xray", "photo", "document"],
      installment_plan_status: ["active", "completed", "cancelled"],
      member_role: ["owner", "doctor", "receptionist"],
      movement_kind: ["purchase", "usage", "auto_usage", "adjustment"],
      payment_method: ["cash", "card", "instapay", "wallet", "bank_transfer"],
      plan_item_status: ["planned", "done", "cancelled"],
      plan_status: [
        "draft",
        "presented",
        "declined",
        "active",
        "completed",
        "cancelled",
      ],
    },
  },
} as const

