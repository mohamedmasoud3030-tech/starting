export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string
          created_at: string
          entity: string
          entity_id: string | null
          id: number
          metadata: Json | null
          organization_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: never
          metadata?: Json | null
          organization_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: never
          metadata?: Json | null
          organization_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          name_en: string | null
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          name_en?: string | null
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          name_en?: string | null
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_items: {
        Row: {
          category_id: string | null
          code: string | null
          cost_price: number
          created_at: string
          description: string | null
          id: string
          internal_notes: string | null
          item_type: Database["public"]["Enums"]["catalog_item_type"]
          name: string
          name_en: string | null
          organization_id: string
          pricing_method: Database["public"]["Enums"]["pricing_method"]
          selling_price: number
          sort_order: number
          status: Database["public"]["Enums"]["catalog_item_status"]
          unit: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          code?: string | null
          cost_price?: number
          created_at?: string
          description?: string | null
          id?: string
          internal_notes?: string | null
          item_type?: Database["public"]["Enums"]["catalog_item_type"]
          name: string
          name_en?: string | null
          organization_id: string
          pricing_method?: Database["public"]["Enums"]["pricing_method"]
          selling_price?: number
          sort_order?: number
          status?: Database["public"]["Enums"]["catalog_item_status"]
          unit?: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          code?: string | null
          cost_price?: number
          created_at?: string
          description?: string | null
          id?: string
          internal_notes?: string | null
          item_type?: Database["public"]["Enums"]["catalog_item_type"]
          name?: string
          name_en?: string | null
          organization_id?: string
          pricing_method?: Database["public"]["Enums"]["pricing_method"]
          selling_price?: number
          sort_order?: number
          status?: Database["public"]["Enums"]["catalog_item_status"]
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_org_category_fk"
            columns: ["category_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "catalog_categories"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "catalog_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          customer_type: Database["public"]["Enums"]["customer_type"]
          id: string
          is_active: boolean
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          created_at?: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          created_at?: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          kind: string
          last_value: number
          organization_id: string
          year: number
        }
        Insert: {
          kind: string
          last_value?: number
          organization_id: string
          year: number
        }
        Update: {
          kind?: string
          last_value?: number
          organization_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_capacity: {
        Row: {
          catalog_item_id: string
          created_at: string
          id: string
          is_active: boolean
          organization_id: string
          total_quantity: number
          updated_at: string
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          organization_id: string
          total_quantity: number
          updated_at?: string
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          total_quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_capacity_organization_id_catalog_item_id_fkey"
            columns: ["organization_id", "catalog_item_id"]
            isOneToOne: true
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "equipment_capacity_organization_id_catalog_item_id_fkey"
            columns: ["organization_id", "catalog_item_id"]
            isOneToOne: true
            referencedRelation: "catalog_items_operational"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      event_commercial_lines: {
        Row: {
          created_at: string
          description: string
          event_id: string
          expected_unit_cost: number
          id: string
          is_custom: boolean
          item_type: Database["public"]["Enums"]["catalog_item_type"]
          notes: string | null
          organization_id: string
          pricing_method: Database["public"]["Enums"]["pricing_method"]
          quantity: number
          sort_order: number
          source_catalog_item_id: string | null
          source_package_id: string | null
          total_expected_cost: number
          total_selling: number
          unit: string
          unit_selling_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          event_id: string
          expected_unit_cost: number
          id?: string
          is_custom?: boolean
          item_type: Database["public"]["Enums"]["catalog_item_type"]
          notes?: string | null
          organization_id: string
          pricing_method: Database["public"]["Enums"]["pricing_method"]
          quantity: number
          sort_order?: number
          source_catalog_item_id?: string | null
          source_package_id?: string | null
          total_expected_cost: number
          total_selling: number
          unit: string
          unit_selling_price: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          event_id?: string
          expected_unit_cost?: number
          id?: string
          is_custom?: boolean
          item_type?: Database["public"]["Enums"]["catalog_item_type"]
          notes?: string | null
          organization_id?: string
          pricing_method?: Database["public"]["Enums"]["pricing_method"]
          quantity?: number
          sort_order?: number
          source_catalog_item_id?: string | null
          source_package_id?: string | null
          total_expected_cost?: number
          total_selling?: number
          unit?: string
          unit_selling_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_commercial_lines_organization_id_event_id_fkey"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "event_commercial_lines_organization_id_source_catalog_item_fkey"
            columns: ["organization_id", "source_catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "event_commercial_lines_organization_id_source_catalog_item_fkey"
            columns: ["organization_id", "source_catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items_operational"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "event_commercial_lines_organization_id_source_package_id_fkey"
            columns: ["organization_id", "source_package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      event_equipment_reservations: {
        Row: {
          created_at: string
          created_by: string
          equipment_capacity_id: string
          event_id: string
          id: string
          idempotency_key: string
          organization_id: string
          quantity: number
          reserved_from: string
          reserved_until: string
          status: Database["public"]["Enums"]["reservation_status"]
        }
        Insert: {
          created_at?: string
          created_by: string
          equipment_capacity_id: string
          event_id: string
          id?: string
          idempotency_key: string
          organization_id: string
          quantity: number
          reserved_from: string
          reserved_until: string
          status?: Database["public"]["Enums"]["reservation_status"]
        }
        Update: {
          created_at?: string
          created_by?: string
          equipment_capacity_id?: string
          event_id?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          quantity?: number
          reserved_from?: string
          reserved_until?: string
          status?: Database["public"]["Enums"]["reservation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "event_equipment_reservations_organization_id_equipment_cap_fkey"
            columns: ["organization_id", "equipment_capacity_id"]
            isOneToOne: false
            referencedRelation: "equipment_capacity"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "event_equipment_reservations_organization_id_event_id_fkey"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      event_staff_assignments: {
        Row: {
          assignment_role: Database["public"]["Enums"]["staff_type"]
          compensation_method: Database["public"]["Enums"]["compensation_method"]
          created_at: string
          created_by: string
          event_id: string
          expected_compensation: number
          id: string
          idempotency_key: string
          notes: string | null
          organization_id: string
          rate: number
          scheduled_end: string
          scheduled_start: string
          staff_member_id: string
          status: Database["public"]["Enums"]["assignment_status"]
        }
        Insert: {
          assignment_role: Database["public"]["Enums"]["staff_type"]
          compensation_method: Database["public"]["Enums"]["compensation_method"]
          created_at?: string
          created_by: string
          event_id: string
          expected_compensation: number
          id?: string
          idempotency_key: string
          notes?: string | null
          organization_id: string
          rate: number
          scheduled_end: string
          scheduled_start: string
          staff_member_id: string
          status?: Database["public"]["Enums"]["assignment_status"]
        }
        Update: {
          assignment_role?: Database["public"]["Enums"]["staff_type"]
          compensation_method?: Database["public"]["Enums"]["compensation_method"]
          created_at?: string
          created_by?: string
          event_id?: string
          expected_compensation?: number
          id?: string
          idempotency_key?: string
          notes?: string | null
          organization_id?: string
          rate?: number
          scheduled_end?: string
          scheduled_start?: string
          staff_member_id?: string
          status?: Database["public"]["Enums"]["assignment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "event_staff_assignments_organization_id_event_id_fkey"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "event_staff_assignments_organization_id_staff_member_id_fkey"
            columns: ["organization_id", "staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "event_staff_assignments_organization_id_staff_member_id_fkey"
            columns: ["organization_id", "staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members_operational"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      event_status_history: {
        Row: {
          actor_id: string
          created_at: string
          event_id: string
          from_status: Database["public"]["Enums"]["event_status"] | null
          id: number
          organization_id: string
          reason: string | null
          to_status: Database["public"]["Enums"]["event_status"]
        }
        Insert: {
          actor_id: string
          created_at?: string
          event_id: string
          from_status?: Database["public"]["Enums"]["event_status"] | null
          id?: never
          organization_id: string
          reason?: string | null
          to_status: Database["public"]["Enums"]["event_status"]
        }
        Update: {
          actor_id?: string
          created_at?: string
          event_id?: string
          from_status?: Database["public"]["Enums"]["event_status"] | null
          id?: never
          organization_id?: string
          reason?: string | null
          to_status?: Database["public"]["Enums"]["event_status"]
        }
        Relationships: [
          {
            foreignKeyName: "event_status_history_organization_id_event_id_fkey"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      events: {
        Row: {
          accepted_quotation_id: string | null
          cancellation_reason: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string
          customer_id: string
          end_at: string
          event_number: string
          event_type: string
          guest_count: number
          id: string
          idempotency_key: string
          location_details: string | null
          notes: string | null
          organization_id: string
          start_at: string
          status: Database["public"]["Enums"]["event_status"]
          title: string
          updated_at: string
          updated_by: string
          venue_name: string
        }
        Insert: {
          accepted_quotation_id?: string | null
          cancellation_reason?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by: string
          customer_id: string
          end_at: string
          event_number: string
          event_type?: string
          guest_count: number
          id?: string
          idempotency_key: string
          location_details?: string | null
          notes?: string | null
          organization_id: string
          start_at: string
          status?: Database["public"]["Enums"]["event_status"]
          title: string
          updated_at?: string
          updated_by: string
          venue_name: string
        }
        Update: {
          accepted_quotation_id?: string | null
          cancellation_reason?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string
          end_at?: string
          event_number?: string
          event_type?: string
          guest_count?: number
          id?: string
          idempotency_key?: string
          location_details?: string | null
          notes?: string | null
          organization_id?: string
          start_at?: string
          status?: Database["public"]["Enums"]["event_status"]
          title?: string
          updated_at?: string
          updated_by?: string
          venue_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_accepted_quote_fk"
            columns: ["organization_id", "accepted_quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "events_accepted_quote_fk"
            columns: ["organization_id", "accepted_quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations_customer"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "events_customer_org_fk"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
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
          default_currency: string
          display_name: string | null
          id: string
          is_active: boolean
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_currency?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_currency?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      package_items: {
        Row: {
          catalog_item_id: string
          created_at: string
          id: string
          organization_id: string
          package_id: string
          quantity: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          id?: string
          organization_id: string
          package_id: string
          quantity?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          package_id?: string
          quantity?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_items_catalog_org_fk"
            columns: ["catalog_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "package_items_catalog_org_fk"
            columns: ["catalog_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "catalog_items_operational"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "package_items_package_org_fk"
            columns: ["package_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      packages: {
        Row: {
          base_guest_count: number | null
          created_at: string
          description: string | null
          id: string
          name: string
          name_en: string | null
          organization_id: string
          status: Database["public"]["Enums"]["package_status"]
          updated_at: string
        }
        Insert: {
          base_guest_count?: number | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          name_en?: string | null
          organization_id: string
          status?: Database["public"]["Enums"]["package_status"]
          updated_at?: string
        }
        Update: {
          base_guest_count?: number | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          name_en?: string | null
          organization_id?: string
          status?: Database["public"]["Enums"]["package_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      quick_quote_applied_packages: {
        Row: {
          applied_at: string
          organization_id: string
          package_id: string
          quick_quote_id: string
        }
        Insert: {
          applied_at?: string
          organization_id: string
          package_id: string
          quick_quote_id: string
        }
        Update: {
          applied_at?: string
          organization_id?: string
          package_id?: string
          quick_quote_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_quote_applied_packages_organization_id_package_id_fkey"
            columns: ["organization_id", "package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "quick_quote_applied_packages_organization_id_quick_quote_i_fkey"
            columns: ["organization_id", "quick_quote_id"]
            isOneToOne: false
            referencedRelation: "quick_quotes"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      quick_quote_lines: {
        Row: {
          created_at: string
          description: string
          id: string
          is_custom: boolean
          item_type: Database["public"]["Enums"]["catalog_item_type"]
          organization_id: string
          pricing_method: Database["public"]["Enums"]["pricing_method"]
          quantity: number
          quick_quote_id: string
          sort_order: number
          total_selling: number
          unit: string
          unit_selling_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          is_custom?: boolean
          item_type: Database["public"]["Enums"]["catalog_item_type"]
          organization_id: string
          pricing_method: Database["public"]["Enums"]["pricing_method"]
          quantity: number
          quick_quote_id: string
          sort_order?: number
          total_selling: number
          unit: string
          unit_selling_price: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          is_custom?: boolean
          item_type?: Database["public"]["Enums"]["catalog_item_type"]
          organization_id?: string
          pricing_method?: Database["public"]["Enums"]["pricing_method"]
          quantity?: number
          quick_quote_id?: string
          sort_order?: number
          total_selling?: number
          unit?: string
          unit_selling_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_quote_lines_organization_id_quick_quote_id_fkey"
            columns: ["organization_id", "quick_quote_id"]
            isOneToOne: false
            referencedRelation: "quick_quotes"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      quick_quotes: {
        Row: {
          created_at: string
          created_by: string
          end_at: string | null
          event_title: string | null
          event_type: string | null
          guest_count: number | null
          id: string
          idempotency_key: string
          notes: string | null
          organization_id: string
          prospect_company: string | null
          prospect_name: string
          prospect_phone: string | null
          prospect_whatsapp: string | null
          quotation_id: string | null
          quotation_number: string | null
          start_at: string | null
          status: Database["public"]["Enums"]["quick_quote_status"]
          updated_at: string
          venue_name: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          end_at?: string | null
          event_title?: string | null
          event_type?: string | null
          guest_count?: number | null
          id?: string
          idempotency_key: string
          notes?: string | null
          organization_id: string
          prospect_company?: string | null
          prospect_name: string
          prospect_phone?: string | null
          prospect_whatsapp?: string | null
          quotation_id?: string | null
          quotation_number?: string | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["quick_quote_status"]
          updated_at?: string
          venue_name?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          end_at?: string | null
          event_title?: string | null
          event_type?: string | null
          guest_count?: number | null
          id?: string
          idempotency_key?: string
          notes?: string | null
          organization_id?: string
          prospect_company?: string | null
          prospect_name?: string
          prospect_phone?: string | null
          prospect_whatsapp?: string | null
          quotation_id?: string | null
          quotation_number?: string | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["quick_quote_status"]
          updated_at?: string
          venue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quick_quotes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_quotes_quotation_fk"
            columns: ["quotation_id"]
            isOneToOne: true
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_quotes_quotation_fk"
            columns: ["quotation_id"]
            isOneToOne: true
            referencedRelation: "quotations_customer"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_lines: {
        Row: {
          description: string
          expected_unit_cost: number
          id: string
          is_custom: boolean
          item_type: Database["public"]["Enums"]["catalog_item_type"]
          organization_id: string
          pricing_method: Database["public"]["Enums"]["pricing_method"]
          quantity: number
          quotation_id: string
          sort_order: number
          total_expected_cost: number
          total_selling: number
          unit: string
          unit_selling_price: number
        }
        Insert: {
          description: string
          expected_unit_cost: number
          id?: string
          is_custom: boolean
          item_type: Database["public"]["Enums"]["catalog_item_type"]
          organization_id: string
          pricing_method: Database["public"]["Enums"]["pricing_method"]
          quantity: number
          quotation_id: string
          sort_order: number
          total_expected_cost: number
          total_selling: number
          unit: string
          unit_selling_price: number
        }
        Update: {
          description?: string
          expected_unit_cost?: number
          id?: string
          is_custom?: boolean
          item_type?: Database["public"]["Enums"]["catalog_item_type"]
          organization_id?: string
          pricing_method?: Database["public"]["Enums"]["pricing_method"]
          quantity?: number
          quotation_id?: string
          sort_order?: number
          total_expected_cost?: number
          total_selling?: number
          unit?: string
          unit_selling_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotation_lines_organization_id_quotation_id_fkey"
            columns: ["organization_id", "quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "quotation_lines_organization_id_quotation_id_fkey"
            columns: ["organization_id", "quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations_customer"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      quotations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          converted_at: string | null
          converted_event_id: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string
          issued_by: string
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          quotation_number: string
          revision: number
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          venue_snapshot: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          converted_at?: string | null
          converted_event_id?: string | null
          customer_id?: string | null
          customer_name_snapshot: string
          customer_phone_snapshot?: string | null
          end_at_snapshot?: string | null
          event_id?: string | null
          event_number_snapshot?: string | null
          event_title_snapshot: string
          guest_count_snapshot?: number | null
          id?: string
          idempotency_key: string
          issued_at?: string
          issued_by: string
          location_snapshot?: string | null
          notes?: string | null
          organization_id: string
          quotation_number: string
          revision: number
          start_at_snapshot?: string | null
          status?: Database["public"]["Enums"]["quotation_status"]
          terms?: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          venue_snapshot?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          converted_at?: string | null
          converted_event_id?: string | null
          customer_id?: string | null
          customer_name_snapshot?: string
          customer_phone_snapshot?: string | null
          end_at_snapshot?: string | null
          event_id?: string | null
          event_number_snapshot?: string | null
          event_title_snapshot?: string
          guest_count_snapshot?: number | null
          id?: string
          idempotency_key?: string
          issued_at?: string
          issued_by?: string
          location_snapshot?: string | null
          notes?: string | null
          organization_id?: string
          quotation_number?: string
          revision?: number
          start_at_snapshot?: string | null
          status?: Database["public"]["Enums"]["quotation_status"]
          terms?: string | null
          total_expected_cost?: number
          total_expected_profit?: number
          total_selling?: number
          venue_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotations_converted_event_org_fk"
            columns: ["organization_id", "converted_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "quotations_customer_org_fk"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "quotations_organization_id_event_id_fkey"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      staff_members: {
        Row: {
          created_at: string
          default_compensation_method: Database["public"]["Enums"]["compensation_method"]
          default_rate: number
          id: string
          is_active: boolean
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          staff_type: Database["public"]["Enums"]["staff_type"]
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          created_at?: string
          default_compensation_method: Database["public"]["Enums"]["compensation_method"]
          default_rate: number
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          staff_type: Database["public"]["Enums"]["staff_type"]
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          created_at?: string
          default_compensation_method?: Database["public"]["Enums"]["compensation_method"]
          default_rate?: number
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          staff_type?: Database["public"]["Enums"]["staff_type"]
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      catalog_items_operational: {
        Row: {
          category_id: string | null
          code: string | null
          created_at: string | null
          description: string | null
          id: string | null
          item_type: Database["public"]["Enums"]["catalog_item_type"] | null
          name: string | null
          name_en: string | null
          organization_id: string | null
          pricing_method: Database["public"]["Enums"]["pricing_method"] | null
          selling_price: number | null
          sort_order: number | null
          status: Database["public"]["Enums"]["catalog_item_status"] | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          category_id?: string | null
          code?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          item_type?: Database["public"]["Enums"]["catalog_item_type"] | null
          name?: string | null
          name_en?: string | null
          organization_id?: string | null
          pricing_method?: Database["public"]["Enums"]["pricing_method"] | null
          selling_price?: number | null
          sort_order?: number | null
          status?: Database["public"]["Enums"]["catalog_item_status"] | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          category_id?: string | null
          code?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          item_type?: Database["public"]["Enums"]["catalog_item_type"] | null
          name?: string | null
          name_en?: string | null
          organization_id?: string | null
          pricing_method?: Database["public"]["Enums"]["pricing_method"] | null
          selling_price?: number | null
          sort_order?: number | null
          status?: Database["public"]["Enums"]["catalog_item_status"] | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_org_category_fk"
            columns: ["category_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "catalog_categories"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "catalog_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      event_commercial_lines_operational: {
        Row: {
          created_at: string | null
          description: string | null
          event_id: string | null
          id: string | null
          is_custom: boolean | null
          item_type: Database["public"]["Enums"]["catalog_item_type"] | null
          notes: string | null
          organization_id: string | null
          pricing_method: Database["public"]["Enums"]["pricing_method"] | null
          quantity: number | null
          sort_order: number | null
          source_catalog_item_id: string | null
          source_package_id: string | null
          total_selling: number | null
          unit: string | null
          unit_selling_price: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          event_id?: string | null
          id?: string | null
          is_custom?: boolean | null
          item_type?: Database["public"]["Enums"]["catalog_item_type"] | null
          notes?: string | null
          organization_id?: string | null
          pricing_method?: Database["public"]["Enums"]["pricing_method"] | null
          quantity?: number | null
          sort_order?: number | null
          source_catalog_item_id?: string | null
          source_package_id?: string | null
          total_selling?: number | null
          unit?: string | null
          unit_selling_price?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          event_id?: string | null
          id?: string | null
          is_custom?: boolean | null
          item_type?: Database["public"]["Enums"]["catalog_item_type"] | null
          notes?: string | null
          organization_id?: string | null
          pricing_method?: Database["public"]["Enums"]["pricing_method"] | null
          quantity?: number | null
          sort_order?: number | null
          source_catalog_item_id?: string | null
          source_package_id?: string | null
          total_selling?: number | null
          unit?: string | null
          unit_selling_price?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_commercial_lines_organization_id_event_id_fkey"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "event_commercial_lines_organization_id_source_catalog_item_fkey"
            columns: ["organization_id", "source_catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "event_commercial_lines_organization_id_source_catalog_item_fkey"
            columns: ["organization_id", "source_catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items_operational"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "event_commercial_lines_organization_id_source_package_id_fkey"
            columns: ["organization_id", "source_package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      event_staff_assignments_operational: {
        Row: {
          assignment_role: Database["public"]["Enums"]["staff_type"] | null
          created_at: string | null
          event_id: string | null
          id: string | null
          notes: string | null
          organization_id: string | null
          scheduled_end: string | null
          scheduled_start: string | null
          staff_member_id: string | null
          status: Database["public"]["Enums"]["assignment_status"] | null
        }
        Insert: {
          assignment_role?: Database["public"]["Enums"]["staff_type"] | null
          created_at?: string | null
          event_id?: string | null
          id?: string | null
          notes?: string | null
          organization_id?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          staff_member_id?: string | null
          status?: Database["public"]["Enums"]["assignment_status"] | null
        }
        Update: {
          assignment_role?: Database["public"]["Enums"]["staff_type"] | null
          created_at?: string | null
          event_id?: string | null
          id?: string | null
          notes?: string | null
          organization_id?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          staff_member_id?: string | null
          status?: Database["public"]["Enums"]["assignment_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "event_staff_assignments_organization_id_event_id_fkey"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "event_staff_assignments_organization_id_staff_member_id_fkey"
            columns: ["organization_id", "staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "event_staff_assignments_organization_id_staff_member_id_fkey"
            columns: ["organization_id", "staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members_operational"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      quotation_lines_customer: {
        Row: {
          description: string | null
          id: string | null
          is_custom: boolean | null
          item_type: Database["public"]["Enums"]["catalog_item_type"] | null
          organization_id: string | null
          pricing_method: Database["public"]["Enums"]["pricing_method"] | null
          quantity: number | null
          quotation_id: string | null
          sort_order: number | null
          total_selling: number | null
          unit: string | null
          unit_selling_price: number | null
        }
        Insert: {
          description?: string | null
          id?: string | null
          is_custom?: boolean | null
          item_type?: Database["public"]["Enums"]["catalog_item_type"] | null
          organization_id?: string | null
          pricing_method?: Database["public"]["Enums"]["pricing_method"] | null
          quantity?: number | null
          quotation_id?: string | null
          sort_order?: number | null
          total_selling?: number | null
          unit?: string | null
          unit_selling_price?: number | null
        }
        Update: {
          description?: string | null
          id?: string | null
          is_custom?: boolean | null
          item_type?: Database["public"]["Enums"]["catalog_item_type"] | null
          organization_id?: string | null
          pricing_method?: Database["public"]["Enums"]["pricing_method"] | null
          quantity?: number | null
          quotation_id?: string | null
          sort_order?: number | null
          total_selling?: number | null
          unit?: string | null
          unit_selling_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quotation_lines_organization_id_quotation_id_fkey"
            columns: ["organization_id", "quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "quotation_lines_organization_id_quotation_id_fkey"
            columns: ["organization_id", "quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations_customer"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      quotations_customer: {
        Row: {
          accepted_at: string | null
          customer_name_snapshot: string | null
          customer_phone_snapshot: string | null
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string | null
          guest_count_snapshot: number | null
          id: string | null
          issued_at: string | null
          location_snapshot: string | null
          notes: string | null
          organization_id: string | null
          quotation_number: string | null
          revision: number | null
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"] | null
          terms: string | null
          total_selling: number | null
          venue_snapshot: string | null
        }
        Insert: {
          accepted_at?: string | null
          customer_name_snapshot?: string | null
          customer_phone_snapshot?: string | null
          end_at_snapshot?: string | null
          event_id?: string | null
          event_number_snapshot?: string | null
          event_title_snapshot?: string | null
          guest_count_snapshot?: number | null
          id?: string | null
          issued_at?: string | null
          location_snapshot?: string | null
          notes?: string | null
          organization_id?: string | null
          quotation_number?: string | null
          revision?: number | null
          start_at_snapshot?: string | null
          status?: Database["public"]["Enums"]["quotation_status"] | null
          terms?: string | null
          total_selling?: number | null
          venue_snapshot?: string | null
        }
        Update: {
          accepted_at?: string | null
          customer_name_snapshot?: string | null
          customer_phone_snapshot?: string | null
          end_at_snapshot?: string | null
          event_id?: string | null
          event_number_snapshot?: string | null
          event_title_snapshot?: string | null
          guest_count_snapshot?: number | null
          id?: string | null
          issued_at?: string | null
          location_snapshot?: string | null
          notes?: string | null
          organization_id?: string | null
          quotation_number?: string | null
          revision?: number | null
          start_at_snapshot?: string | null
          status?: Database["public"]["Enums"]["quotation_status"] | null
          terms?: string | null
          total_selling?: number | null
          venue_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotations_organization_id_event_id_fkey"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      staff_members_operational: {
        Row: {
          created_at: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          notes: string | null
          organization_id: string | null
          phone: string | null
          staff_type: Database["public"]["Enums"]["staff_type"] | null
          updated_at: string | null
          whatsapp: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          notes?: string | null
          organization_id?: string | null
          phone?: string | null
          staff_type?: Database["public"]["Enums"]["staff_type"] | null
          updated_at?: string | null
          whatsapp?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          notes?: string | null
          organization_id?: string | null
          phone?: string | null
          staff_type?: Database["public"]["Enums"]["staff_type"] | null
          updated_at?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_event_quotation: {
        Args: {
          p_idempotency_key: string
          p_org_id: string
          p_quotation_id: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          converted_at: string | null
          converted_event_id: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string
          issued_by: string
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          quotation_number: string
          revision: number
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      accept_quick_quote: {
        Args: {
          p_idempotency_key?: string
          p_org_id: string
          p_quotation_id: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          converted_at: string | null
          converted_event_id: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string
          issued_by: string
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          quotation_number: string
          revision: number
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_package_to_event: {
        Args: { p_event_id: string; p_org_id: string; p_package_id: string }
        Returns: number
      }
      apply_package_to_quick_quote: {
        Args: {
          p_org_id: string
          p_package_id: string
          p_quick_quote_id: string
        }
        Returns: number
      }
      assign_event_staff: {
        Args: {
          p_assignment_role: Database["public"]["Enums"]["staff_type"]
          p_compensation_method: Database["public"]["Enums"]["compensation_method"]
          p_event_id: string
          p_expected_compensation: number
          p_idempotency_key: string
          p_notes: string
          p_org_id: string
          p_rate: number
          p_staff_member_id: string
        }
        Returns: {
          assignment_role: Database["public"]["Enums"]["staff_type"]
          compensation_method: Database["public"]["Enums"]["compensation_method"]
          created_at: string
          created_by: string
          event_id: string
          expected_compensation: number
          id: string
          idempotency_key: string
          notes: string | null
          organization_id: string
          rate: number
          scheduled_end: string
          scheduled_start: string
          staff_member_id: string
          status: Database["public"]["Enums"]["assignment_status"]
        }
        SetofOptions: {
          from: "*"
          to: "event_staff_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      can_manage_commercial: { Args: { p_org_id: string }; Returns: boolean }
      can_read_cost: { Args: { p_org_id: string }; Returns: boolean }
      cancel_event: {
        Args: {
          p_event_id: string
          p_idempotency_key: string
          p_org_id: string
          p_reason: string
        }
        Returns: {
          accepted_quotation_id: string | null
          cancellation_reason: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string
          customer_id: string
          end_at: string
          event_number: string
          event_type: string
          guest_count: number
          id: string
          idempotency_key: string
          location_details: string | null
          notes: string | null
          organization_id: string
          start_at: string
          status: Database["public"]["Enums"]["event_status"]
          title: string
          updated_at: string
          updated_by: string
          venue_name: string
        }
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      commercial_total: {
        Args: {
          p_guests: number
          p_method: Database["public"]["Enums"]["pricing_method"]
          p_quantity: number
          p_unit: number
        }
        Returns: number
      }
      convert_quick_quote: {
        Args: {
          p_end_at?: string
          p_event_title?: string
          p_guest_count?: number
          p_idempotency_key: string
          p_org_id: string
          p_quotation_id: string
          p_start_at?: string
          p_venue_name?: string
        }
        Returns: {
          accepted_quotation_id: string | null
          cancellation_reason: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string
          customer_id: string
          end_at: string
          event_number: string
          event_type: string
          guest_count: number
          id: string
          idempotency_key: string
          location_details: string | null
          notes: string | null
          organization_id: string
          start_at: string
          status: Database["public"]["Enums"]["event_status"]
          title: string
          updated_at: string
          updated_by: string
          venue_name: string
        }
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_event: {
        Args: {
          p_contact_name?: string
          p_contact_phone?: string
          p_customer_id: string
          p_end_at: string
          p_event_type: string
          p_guest_count: number
          p_idempotency_key?: string
          p_location_details?: string
          p_notes?: string
          p_org_id: string
          p_start_at: string
          p_title: string
          p_venue_name: string
        }
        Returns: {
          accepted_quotation_id: string | null
          cancellation_reason: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string
          customer_id: string
          end_at: string
          event_number: string
          event_type: string
          guest_count: number
          id: string
          idempotency_key: string
          location_details: string | null
          notes: string | null
          organization_id: string
          start_at: string
          status: Database["public"]["Enums"]["event_status"]
          title: string
          updated_at: string
          updated_by: string
          venue_name: string
        }
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_organization: {
        Args: { p_display_name?: string; p_name: string }
        Returns: string
      }
      create_quick_quote: {
        Args: {
          p_end_at?: string
          p_event_title?: string
          p_event_type?: string
          p_guest_count?: number
          p_idempotency_key?: string
          p_notes?: string
          p_org_id: string
          p_prospect_company?: string
          p_prospect_name: string
          p_prospect_phone?: string
          p_prospect_whatsapp?: string
          p_start_at?: string
          p_venue_name?: string
        }
        Returns: {
          created_at: string
          created_by: string
          end_at: string | null
          event_title: string | null
          event_type: string | null
          guest_count: number | null
          id: string
          idempotency_key: string
          notes: string | null
          organization_id: string
          prospect_company: string | null
          prospect_name: string
          prospect_phone: string | null
          prospect_whatsapp: string | null
          quotation_id: string | null
          quotation_number: string | null
          start_at: string | null
          status: Database["public"]["Enums"]["quick_quote_status"]
          updated_at: string
          venue_name: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quick_quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_quick_quote_line: {
        Args: { p_line_id: string; p_org_id: string; p_quick_quote_id: string }
        Returns: undefined
      }
      discard_quick_quote: {
        Args: { p_org_id: string; p_quick_quote_id: string; p_reason?: string }
        Returns: undefined
      }
      equipment_availability: {
        Args: {
          p_capacity_id: string
          p_from: string
          p_org_id: string
          p_requested?: number
          p_until: string
        }
        Returns: {
          available: number
          reserved: number
          shortage: number
          total: number
        }[]
      }
      event_readiness: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: Json
      }
      has_org_role: {
        Args: {
          p_org_id: string
          p_roles: Database["public"]["Enums"]["app_role"][]
        }
        Returns: boolean
      }
      is_org_member: { Args: { p_org_id: string }; Returns: boolean }
      issue_event_quotation: {
        Args: {
          p_event_id: string
          p_idempotency_key: string
          p_notes: string
          p_org_id: string
          p_terms: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          converted_at: string | null
          converted_event_id: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string
          issued_by: string
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          quotation_number: string
          revision: number
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      issue_quick_quote: {
        Args: {
          p_idempotency_key?: string
          p_notes?: string
          p_org_id: string
          p_quick_quote_id: string
          p_terms?: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          converted_at: string | null
          converted_event_id: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string
          issued_by: string
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          quotation_number: string
          revision: number
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      next_document_number: {
        Args: { p_kind: string; p_org: string; p_prefix: string }
        Returns: string
      }
      record_audit: {
        Args: {
          p_action: string
          p_entity: string
          p_entity_id?: string
          p_metadata?: Json
          p_org_id: string
        }
        Returns: undefined
      }
      release_equipment_reservation: {
        Args: { p_org_id: string; p_reservation_id: string }
        Returns: undefined
      }
      release_staff_assignment: {
        Args: { p_assignment_id: string; p_org_id: string }
        Returns: undefined
      }
      reserve_event_equipment: {
        Args: {
          p_capacity_id: string
          p_event_id: string
          p_idempotency_key: string
          p_org_id: string
          p_quantity: number
        }
        Returns: Json
      }
      reset_quick_quote_lines: {
        Args: { p_org_id: string; p_quick_quote_id: string }
        Returns: undefined
      }
      save_event_commercial_line: {
        Args: {
          p_description: string
          p_event_id: string
          p_expected_unit_cost: number
          p_item_type: Database["public"]["Enums"]["catalog_item_type"]
          p_line_id: string
          p_notes?: string
          p_org_id: string
          p_pricing_method: Database["public"]["Enums"]["pricing_method"]
          p_quantity: number
          p_unit: string
          p_unit_selling_price: number
        }
        Returns: {
          created_at: string
          description: string
          event_id: string
          expected_unit_cost: number
          id: string
          is_custom: boolean
          item_type: Database["public"]["Enums"]["catalog_item_type"]
          notes: string | null
          organization_id: string
          pricing_method: Database["public"]["Enums"]["pricing_method"]
          quantity: number
          sort_order: number
          source_catalog_item_id: string | null
          source_package_id: string | null
          total_expected_cost: number
          total_selling: number
          unit: string
          unit_selling_price: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "event_commercial_lines"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_package: {
        Args: {
          p_base_guest_count?: number
          p_description?: string
          p_items?: Json
          p_name: string
          p_name_en?: string
          p_org_id: string
          p_package_id: string
          p_status?: Database["public"]["Enums"]["package_status"]
        }
        Returns: string
      }
      save_quick_quote_line: {
        Args: {
          p_description: string
          p_is_custom?: boolean
          p_item_type: Database["public"]["Enums"]["catalog_item_type"]
          p_line_id: string
          p_org_id: string
          p_pricing_method: Database["public"]["Enums"]["pricing_method"]
          p_quantity: number
          p_quick_quote_id: string
          p_unit: string
          p_unit_selling_price: number
        }
        Returns: {
          created_at: string
          description: string
          id: string
          is_custom: boolean
          item_type: Database["public"]["Enums"]["catalog_item_type"]
          organization_id: string
          pricing_method: Database["public"]["Enums"]["pricing_method"]
          quantity: number
          quick_quote_id: string
          sort_order: number
          total_selling: number
          unit: string
          unit_selling_price: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "quick_quote_lines"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transition_event_status: {
        Args: {
          p_event_id: string
          p_org_id: string
          p_reason?: string
          p_to: Database["public"]["Enums"]["event_status"]
        }
        Returns: {
          accepted_quotation_id: string | null
          cancellation_reason: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string
          customer_id: string
          end_at: string
          event_number: string
          event_type: string
          guest_count: number
          id: string
          idempotency_key: string
          location_details: string | null
          notes: string | null
          organization_id: string
          start_at: string
          status: Database["public"]["Enums"]["event_status"]
          title: string
          updated_at: string
          updated_by: string
          venue_name: string
        }
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "OWNER" | "MANAGER" | "SUPERVISOR" | "WAREHOUSE" | "ACCOUNTANT"
      assignment_status: "ACTIVE" | "RELEASED" | "CANCELLED"
      catalog_item_status: "ACTIVE" | "INACTIVE"
      catalog_item_type:
        | "SERVICE"
        | "REUSABLE_EQUIPMENT"
        | "CONSUMABLE"
        | "STAFF"
        | "CATERING"
        | "TRANSPORT"
        | "ADDON"
        | "OTHER"
      compensation_method: "PER_EVENT" | "PER_HOUR" | "PER_DAY" | "MANUAL"
      customer_type: "INDIVIDUAL" | "COMPANY" | "GOVERNMENT"
      event_status:
        | "DRAFT"
        | "QUOTED"
        | "CONFIRMED"
        | "PREPARING"
        | "DISPATCHED"
        | "IN_PROGRESS"
        | "RETURNING"
        | "CLOSED"
        | "CANCELLED"
      membership_status: "ACTIVE" | "INACTIVE" | "INVITED"
      package_status: "ACTIVE" | "INACTIVE"
      pricing_method:
        | "FIXED"
        | "PER_EVENT"
        | "PER_GUEST"
        | "PER_UNIT"
        | "PER_HOUR"
        | "PER_DAY"
        | "MANUAL"
      quick_quote_status:
        "DRAFT" | "ISSUED" | "ACCEPTED" | "CONVERTED" | "DISCARDED"
      quotation_status: "ISSUED" | "ACCEPTED" | "SUPERSEDED"
      reservation_status: "ACTIVE" | "RELEASED" | "CANCELLED"
      staff_type:
        "HOST" | "HOSTESS" | "SUPERVISOR" | "DRIVER" | "WAREHOUSE" | "OTHER"
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
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
  public: {
    Enums: {
      app_role: ["OWNER", "MANAGER", "SUPERVISOR", "WAREHOUSE", "ACCOUNTANT"],
      assignment_status: ["ACTIVE", "RELEASED", "CANCELLED"],
      catalog_item_status: ["ACTIVE", "INACTIVE"],
      catalog_item_type: [
        "SERVICE",
        "REUSABLE_EQUIPMENT",
        "CONSUMABLE",
        "STAFF",
        "CATERING",
        "TRANSPORT",
        "ADDON",
        "OTHER",
      ],
      compensation_method: ["PER_EVENT", "PER_HOUR", "PER_DAY", "MANUAL"],
      customer_type: ["INDIVIDUAL", "COMPANY", "GOVERNMENT"],
      event_status: [
        "DRAFT",
        "QUOTED",
        "CONFIRMED",
        "PREPARING",
        "DISPATCHED",
        "IN_PROGRESS",
        "RETURNING",
        "CLOSED",
        "CANCELLED",
      ],
      membership_status: ["ACTIVE", "INACTIVE", "INVITED"],
      package_status: ["ACTIVE", "INACTIVE"],
      pricing_method: [
        "FIXED",
        "PER_EVENT",
        "PER_GUEST",
        "PER_UNIT",
        "PER_HOUR",
        "PER_DAY",
        "MANUAL",
      ],
      quick_quote_status: [
        "DRAFT",
        "ISSUED",
        "ACCEPTED",
        "CONVERTED",
        "DISCARDED",
      ],
      quotation_status: ["ISSUED", "ACCEPTED", "SUPERSEDED"],
      reservation_status: ["ACTIVE", "RELEASED", "CANCELLED"],
      staff_type: [
        "HOST",
        "HOSTESS",
        "SUPERVISOR",
        "DRIVER",
        "WAREHOUSE",
        "OTHER",
      ],
    },
  },
} as const
