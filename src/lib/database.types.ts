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
      attachment_evidence: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          evidence_type: Database["public"]["Enums"]["attachment_evidence_type"]
          file_name: string
          id: string
          metadata: Json | null
          mime_type: string
          organization_id: string
          reclaimed_at: string | null
          size_bytes: number
          storage_path: string
          superseded_at: string | null
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          evidence_type: Database["public"]["Enums"]["attachment_evidence_type"]
          file_name: string
          id?: string
          metadata?: Json | null
          mime_type: string
          organization_id: string
          reclaimed_at?: string | null
          size_bytes: number
          storage_path: string
          superseded_at?: string | null
          uploaded_by: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          evidence_type?: Database["public"]["Enums"]["attachment_evidence_type"]
          file_name?: string
          id?: string
          metadata?: Json | null
          mime_type?: string
          organization_id?: string
          reclaimed_at?: string | null
          size_bytes?: number
          storage_path?: string
          superseded_at?: string | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachment_evidence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
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
      chart_of_accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          code: string
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          normal_balance: Database["public"]["Enums"]["normal_balance"]
          organization_id: string
          parent_id: string | null
          purpose: string | null
        }
        Insert: {
          account_type: Database["public"]["Enums"]["account_type"]
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          normal_balance: Database["public"]["Enums"]["normal_balance"]
          organization_id: string
          parent_id?: string | null
          purpose?: string | null
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          normal_balance?: Database["public"]["Enums"]["normal_balance"]
          organization_id?: string
          parent_id?: string | null
          purpose?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      command_idempotency: {
        Row: {
          actor_id: string
          command_name: string
          command_scope: string
          created_at: string
          idempotency_key: string
          organization_id: string
          request_fingerprint: string
          response_payload: Json
          result_entity: string
          result_id: string
        }
        Insert: {
          actor_id: string
          command_name: string
          command_scope: string
          created_at?: string
          idempotency_key: string
          organization_id: string
          request_fingerprint: string
          response_payload: Json
          result_entity: string
          result_id: string
        }
        Update: {
          actor_id?: string
          command_name?: string
          command_scope?: string
          created_at?: string
          idempotency_key?: string
          organization_id?: string
          request_fingerprint?: string
          response_payload?: Json
          result_entity?: string
          result_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "command_idempotency_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      consumable_movements: {
        Row: {
          actor_id: string
          created_at: string
          event_delta: number
          event_id: string | null
          id: string
          idempotency_key: string
          movement_kind: Database["public"]["Enums"]["consumable_movement_kind"]
          organization_id: string
          quantity: number
          reason: string | null
          reference: string | null
          request_fingerprint: string
          stock_item_id: string
          warehouse_delta: number
        }
        Insert: {
          actor_id: string
          created_at?: string
          event_delta?: number
          event_id?: string | null
          id?: string
          idempotency_key: string
          movement_kind: Database["public"]["Enums"]["consumable_movement_kind"]
          organization_id: string
          quantity: number
          reason?: string | null
          reference?: string | null
          request_fingerprint: string
          stock_item_id: string
          warehouse_delta?: number
        }
        Update: {
          actor_id?: string
          created_at?: string
          event_delta?: number
          event_id?: string | null
          id?: string
          idempotency_key?: string
          movement_kind?: Database["public"]["Enums"]["consumable_movement_kind"]
          organization_id?: string
          quantity?: number
          reason?: string | null
          reference?: string | null
          request_fingerprint?: string
          stock_item_id?: string
          warehouse_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "consumable_movements_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "consumable_movements_stock_item_fk"
            columns: ["organization_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "consumable_stock_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      consumable_stock_items: {
        Row: {
          catalog_item_id: string
          created_at: string
          created_by: string
          id: string
          is_tracking_active: boolean
          minimum_stock_quantity: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          created_by: string
          id?: string
          is_tracking_active?: boolean
          minimum_stock_quantity?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          created_by?: string
          id?: string
          is_tracking_active?: boolean
          minimum_stock_quantity?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consumable_stock_items_catalog_fk"
            columns: ["organization_id", "catalog_item_id"]
            isOneToOne: true
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      customer_payment_allocations: {
        Row: {
          allocated_by: string
          created_at: string
          event_id: string
          gross_amount: number
          id: string
          invoice_id: string
          net_amount: number
          organization_id: string
          payment_id: string
          vat_amount: number
        }
        Insert: {
          allocated_by: string
          created_at?: string
          event_id: string
          gross_amount: number
          id?: string
          invoice_id: string
          net_amount: number
          organization_id: string
          payment_id: string
          vat_amount?: number
        }
        Update: {
          allocated_by?: string
          created_at?: string
          event_id?: string
          gross_amount?: number
          id?: string
          invoice_id?: string
          net_amount?: number
          organization_id?: string
          payment_id?: string
          vat_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_payment_allocations_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "customer_payment_allocations_invoice_fk"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_summaries"
            referencedColumns: ["organization_id", "invoice_id"]
          },
          {
            foreignKeyName: "customer_payment_allocations_invoice_fk"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "customer_payment_allocations_payment_fk"
            columns: ["organization_id", "payment_id"]
            isOneToOne: false
            referencedRelation: "customer_payments"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      customer_payments: {
        Row: {
          amount: number
          created_at: string
          event_id: string
          id: string
          idempotency_key: string
          notes: string | null
          organization_id: string
          paid_at: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string
          reference: string | null
          request_fingerprint: string
          status: Database["public"]["Enums"]["customer_payment_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          event_id: string
          id?: string
          idempotency_key: string
          notes?: string | null
          organization_id: string
          paid_at: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string
          reference?: string | null
          request_fingerprint: string
          status?: Database["public"]["Enums"]["customer_payment_status"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          event_id?: string
          id?: string
          idempotency_key?: string
          notes?: string | null
          organization_id?: string
          paid_at?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          recorded_by?: string
          reference?: string | null
          request_fingerprint?: string
          status?: Database["public"]["Enums"]["customer_payment_status"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_payments_org_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
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
            foreignKeyName: "event_commercial_lines_organization_id_source_package_id_fkey"
            columns: ["organization_id", "source_package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      event_consumable_reconciliations: {
        Row: {
          actor_id: string
          event_id: string
          id: string
          idempotency_key: string
          notes: string | null
          organization_id: string
          reconciled_at: string
          request_fingerprint: string
          total_consumed_quantity: number
          total_issued_quantity: number
          total_returned_quantity: number
          total_wasted_quantity: number
        }
        Insert: {
          actor_id: string
          event_id: string
          id?: string
          idempotency_key: string
          notes?: string | null
          organization_id: string
          reconciled_at?: string
          request_fingerprint: string
          total_consumed_quantity: number
          total_issued_quantity: number
          total_returned_quantity: number
          total_wasted_quantity: number
        }
        Update: {
          actor_id?: string
          event_id?: string
          id?: string
          idempotency_key?: string
          notes?: string | null
          organization_id?: string
          reconciled_at?: string
          request_fingerprint?: string
          total_consumed_quantity?: number
          total_issued_quantity?: number
          total_returned_quantity?: number
          total_wasted_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "consumable_reconciliations_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      event_equipment_movements: {
        Row: {
          actor_id: string
          condition_notes: string | null
          created_at: string
          damage_loss_valuation_omr: number | null
          damaged_quantity: number
          dispatched_quantity: number
          equipment_capacity_id: string
          event_id: string
          id: string
          idempotency_key: string
          lost_quantity: number
          movement_kind: Database["public"]["Enums"]["warehouse_movement_kind"]
          organization_id: string
          reference: string | null
          request_fingerprint: string
          reservation_id: string
          returned_good_quantity: number
          unit_valuation_omr: number | null
          valuation_basis:
            | Database["public"]["Enums"]["warehouse_valuation_basis"]
            | null
        }
        Insert: {
          actor_id: string
          condition_notes?: string | null
          created_at?: string
          damage_loss_valuation_omr?: number | null
          damaged_quantity?: number
          dispatched_quantity?: number
          equipment_capacity_id: string
          event_id: string
          id?: string
          idempotency_key: string
          lost_quantity?: number
          movement_kind: Database["public"]["Enums"]["warehouse_movement_kind"]
          organization_id: string
          reference?: string | null
          request_fingerprint: string
          reservation_id: string
          returned_good_quantity?: number
          unit_valuation_omr?: number | null
          valuation_basis?:
            | Database["public"]["Enums"]["warehouse_valuation_basis"]
            | null
        }
        Update: {
          actor_id?: string
          condition_notes?: string | null
          created_at?: string
          damage_loss_valuation_omr?: number | null
          damaged_quantity?: number
          dispatched_quantity?: number
          equipment_capacity_id?: string
          event_id?: string
          id?: string
          idempotency_key?: string
          lost_quantity?: number
          movement_kind?: Database["public"]["Enums"]["warehouse_movement_kind"]
          organization_id?: string
          reference?: string | null
          request_fingerprint?: string
          reservation_id?: string
          returned_good_quantity?: number
          unit_valuation_omr?: number | null
          valuation_basis?:
            | Database["public"]["Enums"]["warehouse_valuation_basis"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "movements_capacity_fk"
            columns: ["organization_id", "equipment_capacity_id"]
            isOneToOne: false
            referencedRelation: "equipment_capacity"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "movements_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "movements_reservation_fk"
            columns: ["organization_id", "reservation_id"]
            isOneToOne: false
            referencedRelation: "event_equipment_reservations"
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
      event_expenses: {
        Row: {
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          description: string
          event_id: string
          expense_date: string
          id: string
          idempotency_key: string
          organization_id: string
          payee: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          recorded_by: string
          reference: string | null
          request_fingerprint: string
          status: Database["public"]["Enums"]["customer_payment_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          description: string
          event_id: string
          expense_date: string
          id?: string
          idempotency_key: string
          organization_id: string
          payee?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          recorded_by: string
          reference?: string | null
          request_fingerprint: string
          status?: Database["public"]["Enums"]["customer_payment_status"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          description?: string
          event_id?: string
          expense_date?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          payee?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          recorded_by?: string
          reference?: string | null
          request_fingerprint?: string
          status?: Database["public"]["Enums"]["customer_payment_status"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_expenses_org_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      event_financial_closures: {
        Row: {
          close_note: string | null
          closed_at: string
          closed_by: string
          collected_at_close: number | null
          costs_at_close: number | null
          created_at: string
          event_id: string
          id: string
          margin_at_close: number | null
          organization_id: string
          outstanding_at_close: number | null
          profit_at_close: number | null
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          revenue_at_close: number | null
        }
        Insert: {
          close_note?: string | null
          closed_at?: string
          closed_by: string
          collected_at_close?: number | null
          costs_at_close?: number | null
          created_at?: string
          event_id: string
          id?: string
          margin_at_close?: number | null
          organization_id: string
          outstanding_at_close?: number | null
          profit_at_close?: number | null
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          revenue_at_close?: number | null
        }
        Update: {
          close_note?: string | null
          closed_at?: string
          closed_by?: string
          collected_at_close?: number | null
          costs_at_close?: number | null
          created_at?: string
          event_id?: string
          id?: string
          margin_at_close?: number | null
          organization_id?: string
          outstanding_at_close?: number | null
          profit_at_close?: number | null
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          revenue_at_close?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_financial_closures_org_event_fk"
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
      event_transition_overrides: {
        Row: {
          actor_id: string
          created_at: string
          event_id: string
          from_status: Database["public"]["Enums"]["event_status"]
          id: number
          organization_id: string
          reason: string
          to_status: Database["public"]["Enums"]["event_status"]
        }
        Insert: {
          actor_id: string
          created_at?: string
          event_id: string
          from_status: Database["public"]["Enums"]["event_status"]
          id?: never
          organization_id: string
          reason: string
          to_status: Database["public"]["Enums"]["event_status"]
        }
        Update: {
          actor_id?: string
          created_at?: string
          event_id?: string
          from_status?: Database["public"]["Enums"]["event_status"]
          id?: never
          organization_id?: string
          reason?: string
          to_status?: Database["public"]["Enums"]["event_status"]
        }
        Relationships: [
          {
            foreignKeyName: "event_transition_overrides_organization_id_event_id_fkey"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      event_warehouse_reconciliations: {
        Row: {
          actor_id: string
          event_id: string
          id: string
          idempotency_key: string
          notes: string | null
          organization_id: string
          reconciled_at: string
          request_fingerprint: string
          total_damage_loss_valuation_omr: number
          total_damaged_quantity: number
          total_dispatched_quantity: number
          total_lost_quantity: number
          total_reserved_quantity: number
          total_returned_good_quantity: number
        }
        Insert: {
          actor_id: string
          event_id: string
          id?: string
          idempotency_key: string
          notes?: string | null
          organization_id: string
          reconciled_at?: string
          request_fingerprint: string
          total_damage_loss_valuation_omr: number
          total_damaged_quantity: number
          total_dispatched_quantity: number
          total_lost_quantity: number
          total_reserved_quantity: number
          total_returned_good_quantity: number
        }
        Update: {
          actor_id?: string
          event_id?: string
          id?: string
          idempotency_key?: string
          notes?: string | null
          organization_id?: string
          reconciled_at?: string
          request_fingerprint?: string
          total_damage_loss_valuation_omr?: number
          total_damaged_quantity?: number
          total_dispatched_quantity?: number
          total_lost_quantity?: number
          total_reserved_quantity?: number
          total_returned_good_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "reconciliations_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: true
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
      face_match_attempts: {
        Row: {
          action: string
          attempted_by: string
          confidence_label: string | null
          consumed_at: string | null
          created_at: string
          event_id: string
          id: string
          organization_id: string
          provider_code: string
          staff_member_id: string
          status: Database["public"]["Enums"]["face_match_status"]
        }
        Insert: {
          action: string
          attempted_by: string
          confidence_label?: string | null
          consumed_at?: string | null
          created_at?: string
          event_id: string
          id?: string
          organization_id: string
          provider_code: string
          staff_member_id: string
          status?: Database["public"]["Enums"]["face_match_status"]
        }
        Update: {
          action?: string
          attempted_by?: string
          confidence_label?: string | null
          consumed_at?: string | null
          created_at?: string
          event_id?: string
          id?: string
          organization_id?: string
          provider_code?: string
          staff_member_id?: string
          status?: Database["public"]["Enums"]["face_match_status"]
        }
        Relationships: [
          {
            foreignKeyName: "face_match_attempts_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "face_match_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "face_match_attempts_staff_fk"
            columns: ["organization_id", "staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      host_payout_allocations: {
        Row: {
          amount: number
          created_at: string
          event_id: string
          id: string
          organization_id: string
          payout_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          event_id: string
          id?: string
          organization_id: string
          payout_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          event_id?: string
          id?: string
          organization_id?: string
          payout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "host_payout_allocations_org_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "host_payout_allocations_org_payout_fk"
            columns: ["organization_id", "payout_id"]
            isOneToOne: false
            referencedRelation: "host_payouts"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      host_payouts: {
        Row: {
          amount: number
          created_at: string
          event_id: string | null
          id: string
          idempotency_key: string
          organization_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payout_date: string
          reason: string | null
          recorded_by: string
          reference: string | null
          request_fingerprint: string
          staff_member_id: string
          status: Database["public"]["Enums"]["host_payment_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          event_id?: string | null
          id?: string
          idempotency_key: string
          organization_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payout_date: string
          reason?: string | null
          recorded_by: string
          reference?: string | null
          request_fingerprint: string
          staff_member_id: string
          status?: Database["public"]["Enums"]["host_payment_status"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          event_id?: string | null
          id?: string
          idempotency_key?: string
          organization_id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payout_date?: string
          reason?: string | null
          recorded_by?: string
          reference?: string | null
          request_fingerprint?: string
          staff_member_id?: string
          status?: Database["public"]["Enums"]["host_payment_status"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "host_payouts_org_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "host_payouts_org_staff_fk"
            columns: ["organization_id", "staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      invoice_installments: {
        Row: {
          amount: number
          created_at: string
          due_date: string
          id: string
          invoice_id: string
          kind: Database["public"]["Enums"]["invoice_installment_kind"]
          organization_id: string
          seq: number
          status: Database["public"]["Enums"]["installment_status"]
        }
        Insert: {
          amount: number
          created_at?: string
          due_date: string
          id?: string
          invoice_id: string
          kind: Database["public"]["Enums"]["invoice_installment_kind"]
          organization_id: string
          seq: number
          status?: Database["public"]["Enums"]["installment_status"]
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string
          id?: string
          invoice_id?: string
          kind?: Database["public"]["Enums"]["invoice_installment_kind"]
          organization_id?: string
          seq?: number
          status?: Database["public"]["Enums"]["installment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "invoice_installments_org_fk"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_summaries"
            referencedColumns: ["organization_id", "invoice_id"]
          },
          {
            foreignKeyName: "invoice_installments_org_fk"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          created_by: string
          currency: string
          due_at: string | null
          event_id: string
          id: string
          invoice_number: string
          issued_at: string
          note: string | null
          organization_id: string
          pre_vat_total: number
          quotation_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          total_amount: number
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          currency?: string
          due_at?: string | null
          event_id: string
          id?: string
          invoice_number: string
          issued_at?: string
          note?: string | null
          organization_id: string
          pre_vat_total?: number
          quotation_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          total_amount: number
          vat_amount?: number
          vat_percent?: number
          vat_registered?: boolean
          vat_registration_number?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          currency?: string
          due_at?: string | null
          event_id?: string
          id?: string
          invoice_number?: string
          issued_at?: string
          note?: string | null
          organization_id?: string
          pre_vat_total?: number
          quotation_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          total_amount?: number
          vat_amount?: number
          vat_percent?: number
          vat_registered?: boolean
          vat_registration_number?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_org_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoices_org_quotation_fk"
            columns: ["organization_id", "quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_at: string
          created_by: string
          entry_date: string
          entry_number: string
          event_at: string | null
          event_id: string | null
          id: string
          idempotency_key: string
          is_reversal: boolean
          memo: string | null
          organization_id: string
          request_fingerprint: string
          reversal_of: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["journal_source_type"]
        }
        Insert: {
          created_at?: string
          created_by: string
          entry_date: string
          entry_number: string
          event_at?: string | null
          event_id?: string | null
          id?: string
          idempotency_key: string
          is_reversal?: boolean
          memo?: string | null
          organization_id: string
          request_fingerprint: string
          reversal_of?: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["journal_source_type"]
        }
        Update: {
          created_at?: string
          created_by?: string
          entry_date?: string
          entry_number?: string
          event_at?: string | null
          event_id?: string | null
          id?: string
          idempotency_key?: string
          is_reversal?: boolean
          memo?: string | null
          organization_id?: string
          request_fingerprint?: string
          reversal_of?: string | null
          source_id?: string
          source_type?: Database["public"]["Enums"]["journal_source_type"]
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "journal_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_reversal_org_fk"
            columns: ["organization_id", "reversal_of"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      journal_lines: {
        Row: {
          account_id: string
          created_at: string
          credit: number
          debit: number
          entry_date: string
          entry_id: string
          id: string
          line_memo: string | null
          organization_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          credit?: number
          debit?: number
          entry_date?: string
          entry_id: string
          id?: string
          line_memo?: string | null
          organization_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          credit?: number
          debit?: number
          entry_date?: string
          entry_id?: string
          id?: string
          line_memo?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_org_fk"
            columns: ["organization_id", "account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "journal_lines_entry_org_fk"
            columns: ["organization_id", "entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      org_invitations: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          code: string
          created_at: string
          created_by: string | null
          email: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          email: string
          id?: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          status?: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_member_permissions: {
        Row: {
          allowed: boolean
          capability: string
          created_at: string
          organization_id: string
          set_by: string
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed: boolean
          capability: string
          created_at?: string
          organization_id: string
          set_by: string
          updated_at?: string
          user_id: string
        }
        Update: {
          allowed?: boolean
          capability?: string
          created_at?: string
          organization_id?: string
          set_by?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_member_permissions_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
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
      organization_settings: {
        Row: {
          accent_color: string | null
          accounting_cutover_at: string | null
          accounting_cutover_by: string | null
          accounting_cutover_vat_payable: number | null
          address_line1: string | null
          city: string | null
          commercial_registration: string | null
          country: string | null
          created_at: string
          document_footer: string | null
          document_terms: string | null
          email: string | null
          event_number_prefix: string
          invoice_number_prefix: string
          logo_url: string | null
          manager_name: string | null
          manager_title: string | null
          name_en: string | null
          organization_id: string
          phone_primary: string | null
          phone_secondary: string | null
          po_box: string | null
          postal_code: string | null
          primary_color: string | null
          quotation_number_prefix: string
          region: string | null
          updated_at: string
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          whatsapp: string | null
        }
        Insert: {
          accent_color?: string | null
          accounting_cutover_at?: string | null
          accounting_cutover_by?: string | null
          accounting_cutover_vat_payable?: number | null
          address_line1?: string | null
          city?: string | null
          commercial_registration?: string | null
          country?: string | null
          created_at?: string
          document_footer?: string | null
          document_terms?: string | null
          email?: string | null
          event_number_prefix?: string
          invoice_number_prefix?: string
          logo_url?: string | null
          manager_name?: string | null
          manager_title?: string | null
          name_en?: string | null
          organization_id: string
          phone_primary?: string | null
          phone_secondary?: string | null
          po_box?: string | null
          postal_code?: string | null
          primary_color?: string | null
          quotation_number_prefix?: string
          region?: string | null
          updated_at?: string
          vat_percent?: number
          vat_registered?: boolean
          vat_registration_number?: string | null
          whatsapp?: string | null
        }
        Update: {
          accent_color?: string | null
          accounting_cutover_at?: string | null
          accounting_cutover_by?: string | null
          accounting_cutover_vat_payable?: number | null
          address_line1?: string | null
          city?: string | null
          commercial_registration?: string | null
          country?: string | null
          created_at?: string
          document_footer?: string | null
          document_terms?: string | null
          email?: string | null
          event_number_prefix?: string
          invoice_number_prefix?: string
          logo_url?: string | null
          manager_name?: string | null
          manager_title?: string | null
          name_en?: string | null
          organization_id?: string
          phone_primary?: string | null
          phone_secondary?: string | null
          po_box?: string | null
          postal_code?: string | null
          primary_color?: string | null
          quotation_number_prefix?: string
          region?: string | null
          updated_at?: string
          vat_percent?: number
          vat_registered?: boolean
          vat_registration_number?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
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
          max_guests: number | null
          min_guests: number | null
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
          max_guests?: number | null
          min_guests?: number | null
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
          max_guests?: number | null
          min_guests?: number | null
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
      procurement_order_lines: {
        Row: {
          agreed_total_cost: number
          agreed_unit_cost: number
          catalog_item_id: string | null
          created_at: string
          description: string
          id: string
          line_kind: Database["public"]["Enums"]["procurement_line_kind"]
          order_id: string
          organization_id: string
          quantity: number
          sort_order: number
          stock_item_id: string | null
          unit: string
        }
        Insert: {
          agreed_total_cost: number
          agreed_unit_cost: number
          catalog_item_id?: string | null
          created_at?: string
          description: string
          id?: string
          line_kind: Database["public"]["Enums"]["procurement_line_kind"]
          order_id: string
          organization_id: string
          quantity: number
          sort_order?: number
          stock_item_id?: string | null
          unit: string
        }
        Update: {
          agreed_total_cost?: number
          agreed_unit_cost?: number
          catalog_item_id?: string | null
          created_at?: string
          description?: string
          id?: string
          line_kind?: Database["public"]["Enums"]["procurement_line_kind"]
          order_id?: string
          organization_id?: string
          quantity?: number
          sort_order?: number
          stock_item_id?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_order_lines_catalog_fk"
            columns: ["organization_id", "catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "procurement_order_lines_order_fk"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "procurement_orders"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "procurement_order_lines_stock_item_fk"
            columns: ["organization_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "consumable_stock_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      procurement_orders: {
        Row: {
          agreed_total_cost: number
          approved_at: string | null
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string
          event_id: string | null
          expected_delivery_at: string | null
          id: string
          notes: string | null
          order_date: string
          order_number: string
          organization_id: string
          sent_at: string | null
          sent_by: string | null
          status: Database["public"]["Enums"]["procurement_order_status"]
          supplier_contact_name_snapshot: string | null
          supplier_id: string
          supplier_name_snapshot: string | null
          supplier_phone_snapshot: string | null
          updated_at: string
          updated_by: string
        }
        Insert: {
          agreed_total_cost?: number
          approved_at?: string | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by: string
          event_id?: string | null
          expected_delivery_at?: string | null
          id?: string
          notes?: string | null
          order_date: string
          order_number: string
          organization_id: string
          sent_at?: string | null
          sent_by?: string | null
          status?: Database["public"]["Enums"]["procurement_order_status"]
          supplier_contact_name_snapshot?: string | null
          supplier_id: string
          supplier_name_snapshot?: string | null
          supplier_phone_snapshot?: string | null
          updated_at?: string
          updated_by: string
        }
        Update: {
          agreed_total_cost?: number
          approved_at?: string | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string
          event_id?: string | null
          expected_delivery_at?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          order_number?: string
          organization_id?: string
          sent_at?: string | null
          sent_by?: string | null
          status?: Database["public"]["Enums"]["procurement_order_status"]
          supplier_contact_name_snapshot?: string | null
          supplier_id?: string
          supplier_name_snapshot?: string | null
          supplier_phone_snapshot?: string | null
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_orders_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "procurement_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_orders_supplier_fk"
            columns: ["organization_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      procurement_receipt_lines: {
        Row: {
          consumable_movement_id: string | null
          created_at: string
          id: string
          order_id: string
          order_line_id: string
          organization_id: string
          quantity: number
          receipt_id: string
        }
        Insert: {
          consumable_movement_id?: string | null
          created_at?: string
          id?: string
          order_id: string
          order_line_id: string
          organization_id: string
          quantity: number
          receipt_id: string
        }
        Update: {
          consumable_movement_id?: string | null
          created_at?: string
          id?: string
          order_id?: string
          order_line_id?: string
          organization_id?: string
          quantity?: number
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_receipt_lines_movement_fk"
            columns: ["organization_id", "consumable_movement_id"]
            isOneToOne: true
            referencedRelation: "consumable_movements"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "procurement_receipt_lines_order_line_fk"
            columns: ["organization_id", "order_id", "order_line_id"]
            isOneToOne: false
            referencedRelation: "procurement_order_lines"
            referencedColumns: ["organization_id", "order_id", "id"]
          },
          {
            foreignKeyName: "procurement_receipt_lines_receipt_fk"
            columns: ["organization_id", "receipt_id", "order_id"]
            isOneToOne: false
            referencedRelation: "procurement_receipts"
            referencedColumns: ["organization_id", "id", "order_id"]
          },
        ]
      }
      procurement_receipts: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string
          notes: string | null
          order_id: string
          organization_id: string
          received_at: string
          received_by: string
          reference: string | null
          request_fingerprint: string
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key: string
          notes?: string | null
          order_id: string
          organization_id: string
          received_at: string
          received_by: string
          reference?: string | null
          request_fingerprint: string
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string
          notes?: string | null
          order_id?: string
          organization_id?: string
          received_at?: string
          received_by?: string
          reference?: string | null
          request_fingerprint?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_receipts_order_fk"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "procurement_orders"
            referencedColumns: ["organization_id", "id"]
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
      quotation_lines: {
        Row: {
          created_at: string
          description: string
          expected_unit_cost: number
          id: string
          is_custom: boolean
          item_type: Database["public"]["Enums"]["catalog_item_type"]
          notes: string | null
          organization_id: string
          pricing_method: Database["public"]["Enums"]["pricing_method"]
          quantity: number
          quotation_id: string
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
          expected_unit_cost: number
          id?: string
          is_custom: boolean
          item_type: Database["public"]["Enums"]["catalog_item_type"]
          notes?: string | null
          organization_id: string
          pricing_method: Database["public"]["Enums"]["pricing_method"]
          quantity: number
          quotation_id: string
          sort_order: number
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
          expected_unit_cost?: number
          id?: string
          is_custom?: boolean
          item_type?: Database["public"]["Enums"]["catalog_item_type"]
          notes?: string | null
          organization_id?: string
          pricing_method?: Database["public"]["Enums"]["pricing_method"]
          quantity?: number
          quotation_id?: string
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
            foreignKeyName: "quotation_lines_catalog_org_fk"
            columns: ["organization_id", "source_catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "quotation_lines_organization_id_quotation_id_fkey"
            columns: ["organization_id", "quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "quotation_lines_package_org_fk"
            columns: ["organization_id", "source_package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      quotations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          cancellation_reason: string | null
          converted_at: string | null
          converted_event_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          discount_amount: number
          discount_type: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value: number
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          event_type_snapshot: string
          expired_at: string | null
          expired_by: string | null
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string | null
          issued_by: string | null
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          pre_vat_total: number
          prospect_company: string | null
          prospect_whatsapp: string | null
          quotation_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          revision: number
          series_id: string | null
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          subtotal: number
          superseded_reason: string | null
          surcharge_amount: number
          surcharge_note: string | null
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          transport_amount: number
          transport_note: string | null
          transport_required: boolean
          transport_zone: string | null
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          venue_snapshot: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          cancellation_reason?: string | null
          converted_at?: string | null
          converted_event_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name_snapshot: string
          customer_phone_snapshot?: string | null
          discount_amount?: number
          discount_type?: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value?: number
          end_at_snapshot?: string | null
          event_id?: string | null
          event_number_snapshot?: string | null
          event_title_snapshot: string
          event_type_snapshot?: string
          expired_at?: string | null
          expired_by?: string | null
          guest_count_snapshot?: number | null
          id?: string
          idempotency_key: string
          issued_at?: string | null
          issued_by?: string | null
          location_snapshot?: string | null
          notes?: string | null
          organization_id: string
          pre_vat_total?: number
          prospect_company?: string | null
          prospect_whatsapp?: string | null
          quotation_number?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          revision: number
          series_id?: string | null
          start_at_snapshot?: string | null
          status?: Database["public"]["Enums"]["quotation_status"]
          subtotal?: number
          superseded_reason?: string | null
          surcharge_amount?: number
          surcharge_note?: string | null
          terms?: string | null
          total_expected_cost?: number
          total_expected_profit?: number
          total_selling?: number
          transport_amount?: number
          transport_note?: string | null
          transport_required?: boolean
          transport_zone?: string | null
          updated_at?: string
          valid_until?: string | null
          vat_amount?: number
          vat_percent?: number
          vat_registered?: boolean
          vat_registration_number?: string | null
          venue_snapshot?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          cancellation_reason?: string | null
          converted_at?: string | null
          converted_event_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name_snapshot?: string
          customer_phone_snapshot?: string | null
          discount_amount?: number
          discount_type?: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value?: number
          end_at_snapshot?: string | null
          event_id?: string | null
          event_number_snapshot?: string | null
          event_title_snapshot?: string
          event_type_snapshot?: string
          expired_at?: string | null
          expired_by?: string | null
          guest_count_snapshot?: number | null
          id?: string
          idempotency_key?: string
          issued_at?: string | null
          issued_by?: string | null
          location_snapshot?: string | null
          notes?: string | null
          organization_id?: string
          pre_vat_total?: number
          prospect_company?: string | null
          prospect_whatsapp?: string | null
          quotation_number?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          revision?: number
          series_id?: string | null
          start_at_snapshot?: string | null
          status?: Database["public"]["Enums"]["quotation_status"]
          subtotal?: number
          superseded_reason?: string | null
          surcharge_amount?: number
          surcharge_note?: string | null
          terms?: string | null
          total_expected_cost?: number
          total_expected_profit?: number
          total_selling?: number
          transport_amount?: number
          transport_note?: string | null
          transport_required?: boolean
          transport_zone?: string | null
          updated_at?: string
          valid_until?: string | null
          vat_amount?: number
          vat_percent?: number
          vat_registered?: boolean
          vat_registration_number?: string | null
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
      staff_advance_settlements: {
        Row: {
          advance_id: string | null
          amount: number
          created_at: string
          id: string
          idempotency_key: string
          organization_id: string
          reason: string | null
          recorded_by: string
          request_fingerprint: string
          settlement_date: string
          staff_member_id: string
          status: Database["public"]["Enums"]["host_payment_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          advance_id?: string | null
          amount: number
          created_at?: string
          id?: string
          idempotency_key: string
          organization_id: string
          reason?: string | null
          recorded_by: string
          request_fingerprint: string
          settlement_date: string
          staff_member_id: string
          status?: Database["public"]["Enums"]["host_payment_status"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          advance_id?: string | null
          amount?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          reason?: string | null
          recorded_by?: string
          request_fingerprint?: string
          settlement_date?: string
          staff_member_id?: string
          status?: Database["public"]["Enums"]["host_payment_status"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_advance_settlements_advance_fk"
            columns: ["organization_id", "advance_id"]
            isOneToOne: false
            referencedRelation: "staff_advances"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "staff_advance_settlements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_advance_settlements_staff_fk"
            columns: ["organization_id", "staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      staff_advances: {
        Row: {
          advance_date: string
          amount: number
          created_at: string
          id: string
          idempotency_key: string
          organization_id: string
          reason: string | null
          recorded_by: string
          request_fingerprint: string
          staff_member_id: string
          status: Database["public"]["Enums"]["host_payment_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          advance_date: string
          amount: number
          created_at?: string
          id?: string
          idempotency_key: string
          organization_id: string
          reason?: string | null
          recorded_by: string
          request_fingerprint: string
          staff_member_id: string
          status?: Database["public"]["Enums"]["host_payment_status"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          advance_date?: string
          amount?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          reason?: string | null
          recorded_by?: string
          request_fingerprint?: string
          staff_member_id?: string
          status?: Database["public"]["Enums"]["host_payment_status"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_advances_org_staff_fk"
            columns: ["organization_id", "staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      staff_attendance: {
        Row: {
          assignment_id: string | null
          attendance_date: string
          break_minutes: number
          check_in: string | null
          check_in_method: Database["public"]["Enums"]["attendance_method"]
          check_out: string | null
          check_out_method: Database["public"]["Enums"]["attendance_method"]
          confirmed_by: string | null
          created_at: string
          earned_amount: number
          event_id: string
          hours_worked: number
          id: string
          idempotency_key: string
          match_attempt_id: string | null
          notes: string | null
          organization_id: string
          recorded_by: string
          request_fingerprint: string
          shift: Database["public"]["Enums"]["staff_shift"]
          staff_member_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          wage_method: Database["public"]["Enums"]["compensation_method"]
          wage_rate: number
        }
        Insert: {
          assignment_id?: string | null
          attendance_date: string
          break_minutes?: number
          check_in?: string | null
          check_in_method?: Database["public"]["Enums"]["attendance_method"]
          check_out?: string | null
          check_out_method?: Database["public"]["Enums"]["attendance_method"]
          confirmed_by?: string | null
          created_at?: string
          earned_amount?: number
          event_id: string
          hours_worked?: number
          id?: string
          idempotency_key: string
          match_attempt_id?: string | null
          notes?: string | null
          organization_id: string
          recorded_by: string
          request_fingerprint: string
          shift: Database["public"]["Enums"]["staff_shift"]
          staff_member_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          wage_method: Database["public"]["Enums"]["compensation_method"]
          wage_rate: number
        }
        Update: {
          assignment_id?: string | null
          attendance_date?: string
          break_minutes?: number
          check_in?: string | null
          check_in_method?: Database["public"]["Enums"]["attendance_method"]
          check_out?: string | null
          check_out_method?: Database["public"]["Enums"]["attendance_method"]
          confirmed_by?: string | null
          created_at?: string
          earned_amount?: number
          event_id?: string
          hours_worked?: number
          id?: string
          idempotency_key?: string
          match_attempt_id?: string | null
          notes?: string | null
          organization_id?: string
          recorded_by?: string
          request_fingerprint?: string
          shift?: Database["public"]["Enums"]["staff_shift"]
          staff_member_id?: string
          status?: Database["public"]["Enums"]["attendance_status"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          wage_method?: Database["public"]["Enums"]["compensation_method"]
          wage_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_attendance_org_assignment_fk"
            columns: ["organization_id", "assignment_id"]
            isOneToOne: false
            referencedRelation: "event_staff_assignments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "staff_attendance_org_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "staff_attendance_org_staff_fk"
            columns: ["organization_id", "staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      staff_face_enrollments: {
        Row: {
          capture_count: number
          created_at: string
          enrolled_by: string
          id: string
          model_version: string
          organization_id: string
          provider_code: string
          revoke_reason: string | null
          revoked_at: string | null
          staff_member_id: string
          status: Database["public"]["Enums"]["face_enrollment_status"]
          template_ref: string
          updated_at: string
        }
        Insert: {
          capture_count: number
          created_at?: string
          enrolled_by: string
          id?: string
          model_version: string
          organization_id: string
          provider_code: string
          revoke_reason?: string | null
          revoked_at?: string | null
          staff_member_id: string
          status?: Database["public"]["Enums"]["face_enrollment_status"]
          template_ref: string
          updated_at?: string
        }
        Update: {
          capture_count?: number
          created_at?: string
          enrolled_by?: string
          id?: string
          model_version?: string
          organization_id?: string
          provider_code?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          staff_member_id?: string
          status?: Database["public"]["Enums"]["face_enrollment_status"]
          template_ref?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_face_enrollments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_face_enrollments_staff_fk"
            columns: ["organization_id", "staff_member_id"]
            isOneToOne: true
            referencedRelation: "staff_members"
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
          id_number: string | null
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
          id_number?: string | null
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
          id_number?: string | null
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
      supplier_invoice_lines: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          line_kind: Database["public"]["Enums"]["procurement_line_kind"]
          order_id: string
          order_line_id: string
          organization_id: string
          quantity: number
          total_cost: number
          unit: string
          unit_cost: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          line_kind: Database["public"]["Enums"]["procurement_line_kind"]
          order_id: string
          order_line_id: string
          organization_id: string
          quantity: number
          total_cost: number
          unit: string
          unit_cost: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          line_kind?: Database["public"]["Enums"]["procurement_line_kind"]
          order_id?: string
          order_line_id?: string
          organization_id?: string
          quantity?: number
          total_cost?: number
          unit?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_invoice_lines_invoice_fk"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "supplier_invoice_lines_order_line_fk"
            columns: ["organization_id", "order_id", "order_line_id"]
            isOneToOne: false
            referencedRelation: "procurement_order_lines"
            referencedColumns: ["organization_id", "order_id", "id"]
          },
        ]
      }
      supplier_invoices: {
        Row: {
          amount: number
          created_at: string
          due_date: string | null
          event_id: string | null
          id: string
          idempotency_key: string
          invoice_date: string
          invoice_number: string
          notes: string | null
          order_id: string
          organization_id: string
          override_reason: string | null
          owner_override: boolean
          recorded_by: string
          request_fingerprint: string
          status: Database["public"]["Enums"]["customer_payment_status"]
          supplier_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          due_date?: string | null
          event_id?: string | null
          id?: string
          idempotency_key: string
          invoice_date: string
          invoice_number: string
          notes?: string | null
          order_id: string
          organization_id: string
          override_reason?: string | null
          owner_override?: boolean
          recorded_by: string
          request_fingerprint: string
          status?: Database["public"]["Enums"]["customer_payment_status"]
          supplier_id: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string | null
          event_id?: string | null
          id?: string
          idempotency_key?: string
          invoice_date?: string
          invoice_number?: string
          notes?: string | null
          order_id?: string
          organization_id?: string
          override_reason?: string | null
          owner_override?: boolean
          recorded_by?: string
          request_fingerprint?: string
          status?: Database["public"]["Enums"]["customer_payment_status"]
          supplier_id?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_invoices_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "supplier_invoices_order_fk"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "procurement_orders"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "supplier_invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoices_supplier_fk"
            columns: ["organization_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      supplier_payment_allocations: {
        Row: {
          amount: number
          created_at: string
          id: string
          invoice_id: string
          organization_id: string
          payment_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          invoice_id: string
          organization_id: string
          payment_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id?: string
          organization_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payment_allocations_invoice_fk"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "supplier_payment_allocations_payment_fk"
            columns: ["organization_id", "payment_id"]
            isOneToOne: false
            referencedRelation: "supplier_payments"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          idempotency_key: string
          organization_id: string
          payment_date: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          reason: string | null
          recorded_by: string
          reference: string | null
          request_fingerprint: string
          status: Database["public"]["Enums"]["customer_payment_status"]
          supplier_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          idempotency_key: string
          organization_id: string
          payment_date: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          reason?: string | null
          recorded_by: string
          reference?: string | null
          request_fingerprint: string
          status?: Database["public"]["Enums"]["customer_payment_status"]
          supplier_id: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          payment_date?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          reason?: string | null
          recorded_by?: string
          reference?: string | null
          request_fingerprint?: string
          status?: Database["public"]["Enums"]["customer_payment_status"]
          supplier_id?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_supplier_fk"
            columns: ["organization_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      suppliers: {
        Row: {
          category: Database["public"]["Enums"]["supplier_category"]
          commercial_registration_number: string | null
          contact_name: string | null
          created_at: string
          created_by: string
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          status: Database["public"]["Enums"]["supplier_status"]
          updated_at: string
          updated_by: string
          whatsapp: string | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["supplier_category"]
          commercial_registration_number?: string | null
          contact_name?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          status?: Database["public"]["Enums"]["supplier_status"]
          updated_at?: string
          updated_by: string
          whatsapp?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["supplier_category"]
          commercial_registration_number?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["supplier_status"]
          updated_at?: string
          updated_by?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_accounts: {
        Row: {
          account_tail: string | null
          bank_name: string | null
          chart_account_id: string
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          organization_id: string
          treasury_type: Database["public"]["Enums"]["treasury_account_type"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_tail?: string | null
          bank_name?: string | null
          chart_account_id: string
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          organization_id: string
          treasury_type: Database["public"]["Enums"]["treasury_account_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_tail?: string | null
          bank_name?: string | null
          chart_account_id?: string
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          organization_id?: string
          treasury_type?: Database["public"]["Enums"]["treasury_account_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treasury_accounts_chart_fk"
            columns: ["organization_id", "chart_account_id"]
            isOneToOne: true
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "treasury_accounts_organization_id_fkey"
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
        Relationships: []
      }
      consumable_stock_summary: {
        Row: {
          catalog_item_id: string | null
          catalog_status:
            | Database["public"]["Enums"]["catalog_item_status"]
            | null
          created_at: string | null
          is_low_stock: boolean | null
          is_tracking_active: boolean | null
          item_name: string | null
          item_unit: string | null
          minimum_stock_quantity: number | null
          on_hand_quantity: number | null
          organization_id: string | null
          stock_item_id: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      customer_payment_summaries: {
        Row: {
          amount: number | null
          created_at: string | null
          event_id: string | null
          event_number: string | null
          notes: string | null
          organization_id: string | null
          paid_at: string | null
          payment_id: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          recorded_by: string | null
          reference: string | null
          status: Database["public"]["Enums"]["customer_payment_status"] | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Relationships: []
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
        Relationships: []
      }
      event_consumable_lines: {
        Row: {
          catalog_item_id: string | null
          consumed_quantity: number | null
          event_id: string | null
          is_reconciled: boolean | null
          issued_quantity: number | null
          item_name: string | null
          item_unit: string | null
          organization_id: string | null
          outstanding_quantity: number | null
          reconciled_at: string | null
          returned_quantity: number | null
          stock_item_id: string | null
          wasted_quantity: number | null
        }
        Relationships: []
      }
      event_expense_category_summaries: {
        Row: {
          category: Database["public"]["Enums"]["expense_category"] | null
          count: number | null
          event_id: string | null
          organization_id: string | null
          total: number | null
        }
        Relationships: []
      }
      event_expense_summaries: {
        Row: {
          amount: number | null
          category: Database["public"]["Enums"]["expense_category"] | null
          created_at: string | null
          description: string | null
          event_id: string | null
          event_number: string | null
          expense_date: string | null
          id: string | null
          organization_id: string | null
          payee: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          reference: string | null
          status: Database["public"]["Enums"]["customer_payment_status"] | null
          void_reason: string | null
          voided_at: string | null
        }
        Relationships: []
      }
      event_finance_summaries: {
        Row: {
          accepted_revenue: number | null
          actual_cost: number | null
          actual_profit: number | null
          amount_paid: number | null
          committed_cost: number | null
          delivered_cost: number | null
          event_id: string | null
          event_number: string | null
          event_status: Database["public"]["Enums"]["event_status"] | null
          expected_cost: number | null
          expected_profit: number | null
          expense_cost: number | null
          gross_margin: number | null
          margin_percent: number | null
          organization_id: string | null
          outstanding_balance: number | null
          procurement_cost: number | null
          staff_cost: number | null
        }
        Relationships: []
      }
      event_procurement_cost_summaries: {
        Row: {
          active_committed_cost: number | null
          active_order_count: number | null
          all_approved_order_cost: number | null
          cancelled_order_count: number | null
          delivered_cost: number | null
          event_id: string | null
          event_number: string | null
          organization_id: string | null
        }
        Relationships: []
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
        Relationships: []
      }
      event_warehouse_lines: {
        Row: {
          capacity_total_quantity: number | null
          catalog_item_id: string | null
          damaged_quantity: number | null
          dispatched_quantity: number | null
          equipment_capacity_id: string | null
          equipment_name: string | null
          equipment_unit: string | null
          event_id: string | null
          is_reconciled: boolean | null
          lost_quantity: number | null
          organization_id: string | null
          outstanding_quantity: number | null
          reconciled_at: string | null
          reservation_id: string | null
          reservation_status:
            | Database["public"]["Enums"]["reservation_status"]
            | null
          reserved_from: string | null
          reserved_quantity: number | null
          reserved_until: string | null
          returned_good_quantity: number | null
        }
        Relationships: []
      }
      event_warehouse_lines_valued: {
        Row: {
          damage_loss_valuation_omr: number | null
          damaged_quantity: number | null
          dispatched_quantity: number | null
          equipment_capacity_id: string | null
          event_id: string | null
          lost_quantity: number | null
          organization_id: string | null
          outstanding_quantity: number | null
          reservation_id: string | null
          reserved_quantity: number | null
          returned_good_quantity: number | null
          unit_valuation_omr: number | null
          valuation_basis: string | null
        }
        Relationships: []
      }
      host_event_payroll_summaries: {
        Row: {
          advances_total: number | null
          attendance_count: number | null
          due_total: number | null
          earned_total: number | null
          event_id: string | null
          event_number: string | null
          event_title: string | null
          late_total: number | null
          organization_id: string | null
          paid_total: number | null
          payouts_total: number | null
          staff_member_id: string | null
          staff_name: string | null
          staff_type: Database["public"]["Enums"]["staff_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_attendance_org_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "staff_attendance_org_staff_fk"
            columns: ["organization_id", "staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      host_payout_allocation_summaries: {
        Row: {
          allocation_id: string | null
          amount: number | null
          created_at: string | null
          event_id: string | null
          event_number: string | null
          event_title: string | null
          organization_id: string | null
          payout_date: string | null
          payout_id: string | null
          payout_status:
            | Database["public"]["Enums"]["host_payment_status"]
            | null
          staff_member_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "host_payout_allocations_org_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "host_payout_allocations_org_payout_fk"
            columns: ["organization_id", "payout_id"]
            isOneToOne: false
            referencedRelation: "host_payouts"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      host_payout_summaries: {
        Row: {
          amount: number | null
          created_at: string | null
          event_id: string | null
          event_number: string | null
          organization_id: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          payout_date: string | null
          payout_id: string | null
          reason: string | null
          recorded_by: string | null
          reference: string | null
          staff_member_id: string | null
          staff_name: string | null
          staff_type: Database["public"]["Enums"]["staff_type"] | null
          status: Database["public"]["Enums"]["host_payment_status"] | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Relationships: []
      }
      invoice_installment_summaries: {
        Row: {
          amount: number | null
          cumulative_amount: number | null
          due_date: string | null
          effective_status: string | null
          event_id: string | null
          installment_id: string | null
          invoice_id: string | null
          invoice_number: string | null
          invoice_paid_total: number | null
          kind: Database["public"]["Enums"]["invoice_installment_kind"] | null
          organization_id: string | null
          plan_status: Database["public"]["Enums"]["installment_status"] | null
          seq: number | null
        }
        Relationships: []
      }
      invoice_summaries: {
        Row: {
          created_at: string | null
          due_at: string | null
          event_id: string | null
          event_number: string | null
          event_title: string | null
          invoice_id: string | null
          invoice_number: string | null
          invoice_status: Database["public"]["Enums"]["invoice_status"] | null
          issued_at: string | null
          note: string | null
          organization_id: string | null
          paid_total: number | null
          pre_vat_total: number | null
          quotation_id: string | null
          remaining_balance: number | null
          total_amount: number | null
          vat_amount: number | null
          vat_percent: number | null
          vat_registered: boolean | null
          vat_registration_number: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_org_event_fk"
            columns: ["organization_id", "event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoices_org_quotation_fk"
            columns: ["organization_id", "quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      payments_command_idempotency: {
        Row: {
          actor_id: string | null
          command_name: string | null
          created_at: string | null
          idempotency_key: string | null
          organization_id: string | null
          request_fingerprint: string | null
          response_payload: Json | null
          result_entity: string | null
          result_id: string | null
        }
        Insert: {
          actor_id?: string | null
          command_name?: string | null
          created_at?: string | null
          idempotency_key?: string | null
          organization_id?: string | null
          request_fingerprint?: string | null
          response_payload?: Json | null
          result_entity?: string | null
          result_id?: string | null
        }
        Update: {
          actor_id?: string | null
          command_name?: string | null
          created_at?: string | null
          idempotency_key?: string | null
          organization_id?: string | null
          request_fingerprint?: string | null
          response_payload?: Json | null
          result_entity?: string | null
          result_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "command_idempotency_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_command_idempotency: {
        Row: {
          actor_id: string | null
          command_name: string | null
          created_at: string | null
          idempotency_key: string | null
          organization_id: string | null
          request_fingerprint: string | null
          response_payload: Json | null
          result_entity: string | null
          result_id: string | null
        }
        Insert: {
          actor_id?: string | null
          command_name?: string | null
          created_at?: string | null
          idempotency_key?: string | null
          organization_id?: string | null
          request_fingerprint?: string | null
          response_payload?: Json | null
          result_entity?: string | null
          result_id?: string | null
        }
        Update: {
          actor_id?: string | null
          command_name?: string | null
          created_at?: string | null
          idempotency_key?: string | null
          organization_id?: string | null
          request_fingerprint?: string | null
          response_payload?: Json | null
          result_entity?: string | null
          result_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "command_idempotency_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_order_details: {
        Row: {
          agreed_total_cost: number | null
          approved_at: string | null
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string | null
          created_by: string | null
          event_id: string | null
          event_number: string | null
          event_title: string | null
          expected_delivery_at: string | null
          notes: string | null
          order_date: string | null
          order_id: string | null
          order_number: string | null
          organization_id: string | null
          sent_at: string | null
          sent_by: string | null
          status: Database["public"]["Enums"]["procurement_order_status"] | null
          supplier_contact_name_snapshot: string | null
          supplier_id: string | null
          supplier_name: string | null
          supplier_name_snapshot: string | null
          supplier_phone_snapshot: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      procurement_order_line_summaries: {
        Row: {
          agreed_total_cost: number | null
          agreed_unit_cost: number | null
          catalog_item_id: string | null
          created_at: string | null
          description: string | null
          line_kind: Database["public"]["Enums"]["procurement_line_kind"] | null
          order_id: string | null
          order_line_id: string | null
          ordered_quantity: number | null
          organization_id: string | null
          received_quantity: number | null
          remaining_quantity: number | null
          sort_order: number | null
          stock_item_id: string | null
          unit: string | null
        }
        Relationships: []
      }
      procurement_order_summaries: {
        Row: {
          agreed_total_cost: number | null
          approved_at: string | null
          cancelled_at: string | null
          confirmed_at: string | null
          created_at: string | null
          event_id: string | null
          event_number: string | null
          event_title: string | null
          expected_delivery_at: string | null
          line_count: number | null
          order_date: string | null
          order_id: string | null
          order_number: string | null
          organization_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["procurement_order_status"] | null
          supplier_id: string | null
          supplier_name: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      procurement_receipt_line_summaries: {
        Row: {
          consumable_movement_id: string | null
          created_at: string | null
          order_id: string | null
          order_line_id: string | null
          organization_id: string | null
          quantity: number | null
          receipt_id: string | null
          receipt_line_id: string | null
        }
        Relationships: []
      }
      procurement_receipt_summaries: {
        Row: {
          created_at: string | null
          event_id: string | null
          has_stock_movements: boolean | null
          line_count: number | null
          notes: string | null
          order_id: string | null
          order_number: string | null
          order_status:
            | Database["public"]["Enums"]["procurement_order_status"]
            | null
          organization_id: string | null
          receipt_id: string | null
          received_at: string | null
          received_by: string | null
          reference: string | null
          supplier_name: string | null
        }
        Relationships: []
      }
      procurement_receiving_line_summaries: {
        Row: {
          catalog_item_id: string | null
          description: string | null
          line_kind: Database["public"]["Enums"]["procurement_line_kind"] | null
          order_id: string | null
          order_line_id: string | null
          ordered_quantity: number | null
          organization_id: string | null
          received_quantity: number | null
          remaining_quantity: number | null
          sort_order: number | null
          stock_item_id: string | null
          unit: string | null
        }
        Relationships: []
      }
      procurement_receiving_order_summaries: {
        Row: {
          confirmed_at: string | null
          event_id: string | null
          event_number: string | null
          event_title: string | null
          expected_delivery_at: string | null
          order_date: string | null
          order_id: string | null
          order_number: string | null
          organization_id: string | null
          status: Database["public"]["Enums"]["procurement_order_status"] | null
          supplier_contact_name: string | null
          supplier_id: string | null
          supplier_name: string | null
          supplier_phone: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      quotation_lines_customer: {
        Row: {
          description: string | null
          expected_unit_cost: number | null
          id: string | null
          is_custom: boolean | null
          item_type: Database["public"]["Enums"]["catalog_item_type"] | null
          notes: string | null
          organization_id: string | null
          pricing_method: Database["public"]["Enums"]["pricing_method"] | null
          quantity: number | null
          quotation_id: string | null
          sort_order: number | null
          source_catalog_item_id: string | null
          source_package_id: string | null
          total_expected_cost: number | null
          total_selling: number | null
          unit: string | null
          unit_selling_price: number | null
        }
        Relationships: []
      }
      quotations_customer: {
        Row: {
          accepted_at: string | null
          converted_event_id: string | null
          created_at: string | null
          customer_id: string | null
          customer_name_snapshot: string | null
          customer_phone_snapshot: string | null
          discount_amount: number | null
          discount_type:
            | Database["public"]["Enums"]["quotation_discount_type"]
            | null
          discount_value: number | null
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string | null
          event_type_snapshot: string | null
          expired_at: string | null
          guest_count_snapshot: number | null
          id: string | null
          is_expired: boolean | null
          issued_at: string | null
          location_snapshot: string | null
          notes: string | null
          organization_id: string | null
          pre_vat_total: number | null
          prospect_company: string | null
          prospect_whatsapp: string | null
          quotation_number: string | null
          rejected_at: string | null
          revision: number | null
          series_id: string | null
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"] | null
          subtotal: number | null
          superseded_reason: string | null
          surcharge_amount: number | null
          surcharge_note: string | null
          terms: string | null
          total_selling: number | null
          transport_amount: number | null
          transport_note: string | null
          transport_required: boolean | null
          transport_zone: string | null
          updated_at: string | null
          valid_until: string | null
          vat_amount: number | null
          vat_percent: number | null
          vat_registered: boolean | null
          vat_registration_number: string | null
          venue_snapshot: string | null
        }
        Relationships: []
      }
      staff_advances_summaries: {
        Row: {
          advance_date: string | null
          advance_id: string | null
          amount: number | null
          created_at: string | null
          organization_id: string | null
          reason: string | null
          recorded_by: string | null
          staff_member_id: string | null
          staff_name: string | null
          staff_type: Database["public"]["Enums"]["staff_type"] | null
          status: Database["public"]["Enums"]["host_payment_status"] | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Relationships: []
      }
      staff_attendance_summaries: {
        Row: {
          assignment_id: string | null
          attendance_date: string | null
          attendance_id: string | null
          attendance_status:
            | Database["public"]["Enums"]["attendance_status"]
            | null
          break_minutes: number | null
          check_in: string | null
          check_out: string | null
          created_at: string | null
          earned_amount: number | null
          event_id: string | null
          event_number: string | null
          event_title: string | null
          hours_worked: number | null
          notes: string | null
          organization_id: string | null
          record_status: Database["public"]["Enums"]["attendance_status"] | null
          recorded_by: string | null
          shift: Database["public"]["Enums"]["staff_shift"] | null
          staff_member_id: string | null
          staff_name: string | null
          staff_type: Database["public"]["Enums"]["staff_type"] | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          wage_method: Database["public"]["Enums"]["compensation_method"] | null
          wage_rate: number | null
        }
        Relationships: []
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
        Relationships: []
      }
      staff_payroll_command_idempotency: {
        Row: {
          actor_id: string | null
          command_name: string | null
          created_at: string | null
          idempotency_key: string | null
          organization_id: string | null
          request_fingerprint: string | null
          response_payload: Json | null
          result_entity: string | null
          result_id: string | null
        }
        Insert: {
          actor_id?: string | null
          command_name?: string | null
          created_at?: string | null
          idempotency_key?: string | null
          organization_id?: string | null
          request_fingerprint?: string | null
          response_payload?: Json | null
          result_entity?: string | null
          result_id?: string | null
        }
        Update: {
          actor_id?: string | null
          command_name?: string | null
          created_at?: string | null
          idempotency_key?: string | null
          organization_id?: string | null
          request_fingerprint?: string | null
          response_payload?: Json | null
          result_entity?: string | null
          result_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "command_idempotency_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_details: {
        Row: {
          category: Database["public"]["Enums"]["supplier_category"] | null
          commercial_registration_number: string | null
          contact_name: string | null
          created_at: string | null
          email: string | null
          name: string | null
          notes: string | null
          organization_id: string | null
          phone: string | null
          status: Database["public"]["Enums"]["supplier_status"] | null
          supplier_id: string | null
          updated_at: string | null
          whatsapp: string | null
        }
        Relationships: []
      }
      supplier_summaries: {
        Row: {
          category: Database["public"]["Enums"]["supplier_category"] | null
          contact_name: string | null
          created_at: string | null
          name: string | null
          organization_id: string | null
          phone: string | null
          status: Database["public"]["Enums"]["supplier_status"] | null
          supplier_id: string | null
          updated_at: string | null
          whatsapp: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _chart_id: { Args: { p_code: string; p_org_id: string }; Returns: string }
      _customer_gross_vat: {
        Args: { p_event_id: string; p_gross: number; p_org_id: string }
        Returns: {
          net: number
          vat: number
          vat_percent: number
          vat_registered: boolean
        }[]
      }
      _event_account_balance: {
        Args: { p_account_id: string; p_event_id: string; p_org_id: string }
        Returns: number
      }
      _event_unallocated_deposits_gross: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: number
      }
      _ledger_event_raw: {
        Args: { p_account_id: string; p_event_id: string; p_org_id: string }
        Returns: number
      }
      _ledger_raw: {
        Args: { p_account_id: string; p_org_id: string }
        Returns: number
      }
      _opening_customer_positions: {
        Args: { p_org_id: string }
        Returns: {
          ar: number
          contract_asset: number
          deferred: number
          deposits: number
          event_id: string
        }[]
      }
      _opening_lines_with_equity: {
        Args: { p_org_id: string; p_pairs: Json }
        Returns: Json
      }
      _post_close_revenue: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: undefined
      }
      _post_reversal: {
        Args: {
          p_event_at?: string
          p_event_id?: string
          p_idempotency_key: string
          p_org_id: string
          p_original_entry_id: string
          p_reason: string
          p_source_id: string
          p_void_source_type: Database["public"]["Enums"]["journal_source_type"]
        }
        Returns: {
          created_at: string
          created_by: string
          entry_date: string
          entry_number: string
          event_at: string | null
          event_id: string | null
          id: string
          idempotency_key: string
          is_reversal: boolean
          memo: string | null
          organization_id: string
          request_fingerprint: string
          reversal_of: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["journal_source_type"]
        }
        SetofOptions: {
          from: "*"
          to: "journal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _resolve_expense_treasury: {
        Args: { p_org_id: string; p_treasury_id: string }
        Returns: {
          chart_id: string
          treasury_id: string
        }[]
      }
      _resolve_treasury_chart: {
        Args: { p_org_id: string; p_treasury_id: string }
        Returns: string
      }
      _staff_advance_remaining: {
        Args: { p_advance_id: string; p_org_id: string }
        Returns: number
      }
      _staff_payroll_position: {
        Args: { p_org_id: string; p_staff_member_id: string }
        Returns: {
          payable: number
          receivable: number
        }[]
      }
      _supplier_ap_position: {
        Args: { p_org_id: string; p_supplier_id: string }
        Returns: number
      }
      _supplier_invoice_ap: {
        Args: { p_invoice_id: string; p_org_id: string }
        Returns: number
      }
      _view_catalog_items_operational: {
        Args: never
        Returns: {
          category_id: string
          code: string
          created_at: string
          description: string
          id: string
          item_type: Database["public"]["Enums"]["catalog_item_type"]
          name: string
          name_en: string
          organization_id: string
          pricing_method: Database["public"]["Enums"]["pricing_method"]
          selling_price: number
          sort_order: number
          status: Database["public"]["Enums"]["catalog_item_status"]
          unit: string
          updated_at: string
        }[]
      }
      _view_consumable_stock_summary: {
        Args: never
        Returns: {
          catalog_item_id: string
          catalog_status: Database["public"]["Enums"]["catalog_item_status"]
          created_at: string
          is_low_stock: boolean
          is_tracking_active: boolean
          item_name: string
          item_unit: string
          minimum_stock_quantity: number
          on_hand_quantity: number
          organization_id: string
          stock_item_id: string
          updated_at: string
        }[]
      }
      _view_customer_payment_summaries: {
        Args: never
        Returns: {
          amount: number
          created_at: string
          event_id: string
          event_number: string
          notes: string
          organization_id: string
          paid_at: string
          payment_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string
          reference: string
          status: Database["public"]["Enums"]["customer_payment_status"]
          void_reason: string
          voided_at: string
          voided_by: string
        }[]
      }
      _view_event_commercial_lines_operational: {
        Args: never
        Returns: {
          created_at: string
          description: string
          event_id: string
          id: string
          is_custom: boolean
          item_type: Database["public"]["Enums"]["catalog_item_type"]
          notes: string
          organization_id: string
          pricing_method: Database["public"]["Enums"]["pricing_method"]
          quantity: number
          sort_order: number
          source_catalog_item_id: string
          source_package_id: string
          total_selling: number
          unit: string
          unit_selling_price: number
          updated_at: string
        }[]
      }
      _view_event_consumable_lines: {
        Args: never
        Returns: {
          catalog_item_id: string
          consumed_quantity: number
          event_id: string
          is_reconciled: boolean
          issued_quantity: number
          item_name: string
          item_unit: string
          organization_id: string
          outstanding_quantity: number
          reconciled_at: string
          returned_quantity: number
          stock_item_id: string
          wasted_quantity: number
        }[]
      }
      _view_event_expense_category_summaries: {
        Args: never
        Returns: {
          category: Database["public"]["Enums"]["expense_category"]
          count: number
          event_id: string
          organization_id: string
          total: number
        }[]
      }
      _view_event_expense_summaries: {
        Args: never
        Returns: {
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          description: string
          event_id: string
          event_number: string
          expense_date: string
          id: string
          organization_id: string
          payee: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          reference: string
          status: Database["public"]["Enums"]["customer_payment_status"]
          void_reason: string
          voided_at: string
        }[]
      }
      _view_event_finance_summaries: {
        Args: never
        Returns: {
          accepted_revenue: number
          actual_cost: number
          actual_profit: number
          amount_paid: number
          committed_cost: number
          delivered_cost: number
          event_id: string
          event_number: string
          event_status: Database["public"]["Enums"]["event_status"]
          expected_cost: number
          expected_profit: number
          expense_cost: number
          gross_margin: number
          margin_percent: number
          organization_id: string
          outstanding_balance: number
          procurement_cost: number
          staff_cost: number
        }[]
      }
      _view_event_procurement_cost_summaries: {
        Args: never
        Returns: {
          active_committed_cost: number
          active_order_count: number
          all_approved_order_cost: number
          cancelled_order_count: number
          delivered_cost: number
          event_id: string
          event_number: string
          organization_id: string
        }[]
      }
      _view_event_staff_assignments_operational: {
        Args: never
        Returns: {
          assignment_role: Database["public"]["Enums"]["staff_type"]
          created_at: string
          event_id: string
          id: string
          notes: string
          organization_id: string
          scheduled_end: string
          scheduled_start: string
          staff_member_id: string
          status: Database["public"]["Enums"]["assignment_status"]
        }[]
      }
      _view_event_warehouse_lines: {
        Args: never
        Returns: {
          capacity_total_quantity: number
          catalog_item_id: string
          damaged_quantity: number
          dispatched_quantity: number
          equipment_capacity_id: string
          equipment_name: string
          equipment_unit: string
          event_id: string
          is_reconciled: boolean
          lost_quantity: number
          organization_id: string
          outstanding_quantity: number
          reconciled_at: string
          reservation_id: string
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_from: string
          reserved_quantity: number
          reserved_until: string
          returned_good_quantity: number
        }[]
      }
      _view_event_warehouse_lines_valued: {
        Args: never
        Returns: {
          damage_loss_valuation_omr: number
          damaged_quantity: number
          dispatched_quantity: number
          equipment_capacity_id: string
          event_id: string
          lost_quantity: number
          organization_id: string
          outstanding_quantity: number
          reservation_id: string
          reserved_quantity: number
          returned_good_quantity: number
          unit_valuation_omr: number
          valuation_basis: string
        }[]
      }
      _view_host_event_payroll_summaries: {
        Args: never
        Returns: {
          advances_total: number
          attendance_count: number
          due_total: number
          earned_total: number
          event_id: string
          event_number: string
          event_title: string
          late_total: number
          organization_id: string
          paid_total: number
          payouts_total: number
          staff_member_id: string
          staff_name: string
          staff_type: Database["public"]["Enums"]["staff_type"]
        }[]
      }
      _view_host_payout_summaries: {
        Args: never
        Returns: {
          amount: number
          created_at: string
          event_id: string
          event_number: string
          organization_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payout_date: string
          payout_id: string
          reason: string
          recorded_by: string
          reference: string
          staff_member_id: string
          staff_name: string
          staff_type: Database["public"]["Enums"]["staff_type"]
          status: Database["public"]["Enums"]["host_payment_status"]
          void_reason: string
          voided_at: string
          voided_by: string
        }[]
      }
      _view_invoice_installment_summaries: {
        Args: never
        Returns: {
          amount: number
          cumulative_amount: number
          due_date: string
          effective_status: string
          event_id: string
          installment_id: string
          invoice_id: string
          invoice_number: string
          invoice_paid_total: number
          kind: Database["public"]["Enums"]["invoice_installment_kind"]
          organization_id: string
          plan_status: Database["public"]["Enums"]["installment_status"]
          seq: number
        }[]
      }
      _view_invoice_summaries: {
        Args: never
        Returns: {
          created_at: string
          due_at: string
          event_id: string
          event_number: string
          event_title: string
          invoice_id: string
          invoice_number: string
          invoice_status: Database["public"]["Enums"]["invoice_status"]
          issued_at: string
          note: string
          organization_id: string
          paid_total: number
          quotation_id: string
          remaining_balance: number
          total_amount: number
          void_reason: string
          voided_at: string
          voided_by: string
        }[]
      }
      _view_procurement_order_details: {
        Args: never
        Returns: {
          agreed_total_cost: number
          approved_at: string
          approved_by: string
          cancellation_reason: string
          cancelled_at: string
          cancelled_by: string
          confirmed_at: string
          confirmed_by: string
          created_at: string
          created_by: string
          event_id: string
          event_number: string
          event_title: string
          expected_delivery_at: string
          notes: string
          order_date: string
          order_id: string
          order_number: string
          organization_id: string
          sent_at: string
          sent_by: string
          status: Database["public"]["Enums"]["procurement_order_status"]
          supplier_contact_name_snapshot: string
          supplier_id: string
          supplier_name: string
          supplier_name_snapshot: string
          supplier_phone_snapshot: string
          updated_at: string
        }[]
      }
      _view_procurement_order_line_summaries: {
        Args: never
        Returns: {
          agreed_total_cost: number
          agreed_unit_cost: number
          catalog_item_id: string
          created_at: string
          description: string
          line_kind: Database["public"]["Enums"]["procurement_line_kind"]
          order_id: string
          order_line_id: string
          ordered_quantity: number
          organization_id: string
          received_quantity: number
          remaining_quantity: number
          sort_order: number
          stock_item_id: string
          unit: string
        }[]
      }
      _view_procurement_order_summaries: {
        Args: never
        Returns: {
          agreed_total_cost: number
          approved_at: string
          cancelled_at: string
          confirmed_at: string
          created_at: string
          event_id: string
          event_number: string
          event_title: string
          expected_delivery_at: string
          line_count: number
          order_date: string
          order_id: string
          order_number: string
          organization_id: string
          sent_at: string
          status: Database["public"]["Enums"]["procurement_order_status"]
          supplier_id: string
          supplier_name: string
          updated_at: string
        }[]
      }
      _view_procurement_receipt_line_summaries: {
        Args: never
        Returns: {
          consumable_movement_id: string
          created_at: string
          order_id: string
          order_line_id: string
          organization_id: string
          quantity: number
          receipt_id: string
          receipt_line_id: string
        }[]
      }
      _view_procurement_receipt_summaries: {
        Args: never
        Returns: {
          created_at: string
          event_id: string
          has_stock_movements: boolean
          line_count: number
          notes: string
          order_id: string
          order_number: string
          order_status: Database["public"]["Enums"]["procurement_order_status"]
          organization_id: string
          receipt_id: string
          received_at: string
          received_by: string
          reference: string
          supplier_name: string
        }[]
      }
      _view_procurement_receiving_line_summaries: {
        Args: never
        Returns: {
          catalog_item_id: string
          description: string
          line_kind: Database["public"]["Enums"]["procurement_line_kind"]
          order_id: string
          order_line_id: string
          ordered_quantity: number
          organization_id: string
          received_quantity: number
          remaining_quantity: number
          sort_order: number
          stock_item_id: string
          unit: string
        }[]
      }
      _view_procurement_receiving_order_summaries: {
        Args: never
        Returns: {
          confirmed_at: string
          event_id: string
          event_number: string
          event_title: string
          expected_delivery_at: string
          order_date: string
          order_id: string
          order_number: string
          organization_id: string
          status: Database["public"]["Enums"]["procurement_order_status"]
          supplier_contact_name: string
          supplier_id: string
          supplier_name: string
          supplier_phone: string
          updated_at: string
        }[]
      }
      _view_quotation_lines_customer: {
        Args: never
        Returns: {
          description: string
          expected_unit_cost: number
          id: string
          is_custom: boolean
          item_type: Database["public"]["Enums"]["catalog_item_type"]
          notes: string
          organization_id: string
          pricing_method: Database["public"]["Enums"]["pricing_method"]
          quantity: number
          quotation_id: string
          sort_order: number
          source_catalog_item_id: string
          source_package_id: string
          total_expected_cost: number
          total_selling: number
          unit: string
          unit_selling_price: number
        }[]
      }
      _view_quotations_customer: {
        Args: never
        Returns: {
          accepted_at: string
          converted_event_id: string
          created_at: string
          customer_id: string
          customer_name_snapshot: string
          customer_phone_snapshot: string
          discount_amount: number
          discount_type: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value: number
          end_at_snapshot: string
          event_id: string
          event_number_snapshot: string
          event_title_snapshot: string
          event_type_snapshot: string
          expired_at: string
          guest_count_snapshot: number
          id: string
          is_expired: boolean
          issued_at: string
          location_snapshot: string
          notes: string
          organization_id: string
          pre_vat_total: number
          prospect_company: string
          prospect_whatsapp: string
          quotation_number: string
          rejected_at: string
          revision: number
          series_id: string
          start_at_snapshot: string
          status: Database["public"]["Enums"]["quotation_status"]
          subtotal: number
          superseded_reason: string
          surcharge_amount: number
          surcharge_note: string
          terms: string
          total_selling: number
          transport_amount: number
          transport_note: string
          transport_required: boolean
          transport_zone: string
          updated_at: string
          valid_until: string
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string
          venue_snapshot: string
        }[]
      }
      _view_staff_advances_summaries: {
        Args: never
        Returns: {
          advance_date: string
          advance_id: string
          amount: number
          created_at: string
          organization_id: string
          reason: string
          recorded_by: string
          staff_member_id: string
          staff_name: string
          staff_type: Database["public"]["Enums"]["staff_type"]
          status: Database["public"]["Enums"]["host_payment_status"]
          void_reason: string
          voided_at: string
          voided_by: string
        }[]
      }
      _view_staff_attendance_summaries: {
        Args: never
        Returns: {
          assignment_id: string
          attendance_date: string
          attendance_id: string
          attendance_status: Database["public"]["Enums"]["attendance_status"]
          break_minutes: number
          check_in: string
          check_out: string
          created_at: string
          earned_amount: number
          event_id: string
          event_number: string
          event_title: string
          hours_worked: number
          notes: string
          organization_id: string
          record_status: Database["public"]["Enums"]["attendance_status"]
          recorded_by: string
          shift: Database["public"]["Enums"]["staff_shift"]
          staff_member_id: string
          staff_name: string
          staff_type: Database["public"]["Enums"]["staff_type"]
          void_reason: string
          voided_at: string
          voided_by: string
          wage_method: Database["public"]["Enums"]["compensation_method"]
          wage_rate: number
        }[]
      }
      _view_staff_members_operational: {
        Args: never
        Returns: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string
          organization_id: string
          phone: string
          staff_type: Database["public"]["Enums"]["staff_type"]
          updated_at: string
          whatsapp: string
        }[]
      }
      _view_supplier_details: {
        Args: never
        Returns: {
          category: Database["public"]["Enums"]["supplier_category"]
          commercial_registration_number: string
          contact_name: string
          created_at: string
          email: string
          name: string
          notes: string
          organization_id: string
          phone: string
          status: Database["public"]["Enums"]["supplier_status"]
          supplier_id: string
          updated_at: string
          whatsapp: string
        }[]
      }
      _view_supplier_summaries: {
        Args: never
        Returns: {
          category: Database["public"]["Enums"]["supplier_category"]
          contact_name: string
          created_at: string
          name: string
          organization_id: string
          phone: string
          status: Database["public"]["Enums"]["supplier_status"]
          supplier_id: string
          updated_at: string
          whatsapp: string
        }[]
      }
      accept_event_quotation: {
        Args: {
          p_idempotency_key: string
          p_org_id: string
          p_quotation_id: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          cancellation_reason: string | null
          converted_at: string | null
          converted_event_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          discount_amount: number
          discount_type: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value: number
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          event_type_snapshot: string
          expired_at: string | null
          expired_by: string | null
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string | null
          issued_by: string | null
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          pre_vat_total: number
          prospect_company: string | null
          prospect_whatsapp: string | null
          quotation_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          revision: number
          series_id: string | null
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          subtotal: number
          superseded_reason: string | null
          surcharge_amount: number
          surcharge_note: string | null
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          transport_amount: number
          transport_note: string | null
          transport_required: boolean
          transport_zone: string | null
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      accept_quotation: {
        Args: {
          p_idempotency_key?: string
          p_org_id: string
          p_quotation_id: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          cancellation_reason: string | null
          converted_at: string | null
          converted_event_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          discount_amount: number
          discount_type: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value: number
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          event_type_snapshot: string
          expired_at: string | null
          expired_by: string | null
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string | null
          issued_by: string | null
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          pre_vat_total: number
          prospect_company: string | null
          prospect_whatsapp: string | null
          quotation_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          revision: number
          series_id: string | null
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          subtotal: number
          superseded_reason: string | null
          surcharge_amount: number
          surcharge_note: string | null
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          transport_amount: number
          transport_note: string | null
          transport_required: boolean
          transport_zone: string | null
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      account_balance: {
        Args: { p_account_id: string; p_org_id: string }
        Returns: {
          balance: number
          credit_total: number
          debit_total: number
          normal_balance: Database["public"]["Enums"]["normal_balance"]
          raw_balance: number
        }[]
      }
      account_balance_at_time: {
        Args: { p_account_id: string; p_as_of: string; p_org_id: string }
        Returns: {
          balance: number
          credit_total: number
          debit_total: number
          normal_balance: Database["public"]["Enums"]["normal_balance"]
          raw_balance: number
        }[]
      }
      account_raw_balance: {
        Args: { p_account_id: string; p_org_id: string }
        Returns: {
          credit_total: number
          debit_total: number
          raw_balance: number
        }[]
      }
      accounting_customer_positions: {
        Args: { p_event_id?: string; p_org_id: string }
        Returns: {
          accounts_receivable_gross: number
          collected_amount_gross: number
          commercial_pre_vat: number
          commercial_value: number
          customer_deposits_gross: number
          customer_deposits_net: number
          customer_id: string
          customer_name: string
          event_id: string
          event_number: string
          event_status: Database["public"]["Enums"]["event_status"]
          invoiced_amount_gross: number
          invoiced_amount_net: number
          outstanding_ar: number
          recognized_revenue: number
          unbilled_receivable_gross: number
          vat_amount: number
        }[]
      }
      accounting_cutover_status: {
        Args: { p_org_id: string }
        Returns: {
          committed: boolean
          cutover_at: string
          cutover_by: string
          opening_entities: Json
          opening_journal_count: number
          vat_payable: number
        }[]
      }
      accounting_journal_history: {
        Args: {
          p_event_id?: string
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_org_id: string
          p_source_type?: Database["public"]["Enums"]["journal_source_type"]
          p_to?: string
        }
        Returns: {
          account_code: string
          account_id: string
          account_name: string
          credit: number
          debit: number
          entry_date: string
          entry_id: string
          entry_number: string
          event_at: string
          event_id: string
          is_reversal: boolean
          line_memo: string
          memo: string
          reversal_of: string
          reversed_by: string
          source_id: string
          source_type: Database["public"]["Enums"]["journal_source_type"]
        }[]
      }
      accounting_payroll_positions: {
        Args: { p_org_id: string }
        Returns: {
          advances_outstanding: number
          net_position: number
          payable: number
          receivable: number
          staff_member_id: string
          staff_name: string
        }[]
      }
      accounting_reconciliation: {
        Args: { p_org_id: string }
        Returns: {
          difference: number
          dimension: string
          entity_id: string
          entity_label: string
          ledger_balance: number
          metric: string
          operational_balance: number
          status: string
        }[]
      }
      accounting_supplier_positions: {
        Args: { p_org_id: string }
        Returns: {
          ap_balance: number
          last_posting_date: string
          open_invoice_count: number
          supplier_id: string
          supplier_name: string
        }[]
      }
      accounting_trial_balance: {
        Args: { p_from?: string; p_org_id: string; p_to?: string }
        Returns: {
          account_id: string
          account_type: Database["public"]["Enums"]["account_type"]
          balance: number
          code: string
          credit_total: number
          debit_total: number
          name: string
          normal_balance: Database["public"]["Enums"]["normal_balance"]
          raw_balance: number
        }[]
      }
      adjust_consumable_stock: {
        Args: {
          p_idempotency_key: string
          p_org_id: string
          p_quantity: number
          p_reason: string
          p_stock_item_id: string
        }
        Returns: {
          actor_id: string
          created_at: string
          event_delta: number
          event_id: string | null
          id: string
          idempotency_key: string
          movement_kind: Database["public"]["Enums"]["consumable_movement_kind"]
          organization_id: string
          quantity: number
          reason: string | null
          reference: string | null
          request_fingerprint: string
          stock_item_id: string
          warehouse_delta: number
        }
        SetofOptions: {
          from: "*"
          to: "consumable_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_package_to_event: {
        Args: { p_event_id: string; p_org_id: string; p_package_id: string }
        Returns: number
      }
      apply_package_to_quotation: {
        Args: { p_org_id: string; p_package_id: string; p_quotation_id: string }
        Returns: number
      }
      approve_procurement_order: {
        Args: {
          p_idempotency_key: string
          p_order_id: string
          p_org_id: string
        }
        Returns: {
          agreed_total_cost: number
          approved_at: string | null
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string
          event_id: string | null
          expected_delivery_at: string | null
          id: string
          notes: string | null
          order_date: string
          order_number: string
          organization_id: string
          sent_at: string | null
          sent_by: string | null
          status: Database["public"]["Enums"]["procurement_order_status"]
          supplier_contact_name_snapshot: string | null
          supplier_id: string
          supplier_name_snapshot: string | null
          supplier_phone_snapshot: string | null
          updated_at: string
          updated_by: string
        }
        SetofOptions: {
          from: "*"
          to: "procurement_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_consumable_quantity: {
        Args: { p_allow_negative?: boolean; p_quantity: number }
        Returns: undefined
      }
      assert_journal_omr: { Args: { p_amount: number }; Returns: undefined }
      assert_payment_omr: { Args: { p_amount: number }; Returns: undefined }
      assert_procurement_omr: { Args: { p_amount: number }; Returns: undefined }
      assert_procurement_quantity: {
        Args: { p_quantity: number }
        Returns: undefined
      }
      assert_treasury_sufficient: {
        Args: { p_org_id: string; p_out_amount: number; p_treasury_id: string }
        Returns: undefined
      }
      assert_wage_rate: { Args: { p_rate: number }; Returns: undefined }
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
      attach_evidence: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_evidence_type: Database["public"]["Enums"]["attachment_evidence_type"]
          p_file_name: string
          p_idempotency_key?: string
          p_metadata?: Json
          p_mime_type: string
          p_org_id: string
          p_size_bytes: number
          p_storage_path: string
          p_supersede?: boolean
        }
        Returns: {
          created_at: string
          entity_id: string
          entity_type: string
          evidence_type: Database["public"]["Enums"]["attachment_evidence_type"]
          file_name: string
          id: string
          metadata: Json | null
          mime_type: string
          organization_id: string
          reclaimed_at: string | null
          size_bytes: number
          storage_path: string
          superseded_at: string | null
          uploaded_by: string
        }
        SetofOptions: {
          from: "*"
          to: "attachment_evidence"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attachment_evidence_read_gate: {
        Args: {
          p_evidence_type: Database["public"]["Enums"]["attachment_evidence_type"]
          p_org_id: string
        }
        Returns: boolean
      }
      attachment_evidence_write_gate: {
        Args: {
          p_evidence_type: Database["public"]["Enums"]["attachment_evidence_type"]
          p_org_id: string
        }
        Returns: boolean
      }
      begin_command: {
        Args: {
          p_command_scope: string
          p_fingerprint: string
          p_idempotency_key: string
          p_org_id: string
        }
        Returns: Json
      }
      begin_payment_command: {
        Args: {
          p_fingerprint: string
          p_idempotency_key: string
          p_org_id: string
        }
        Returns: Json
      }
      begin_procurement_command: {
        Args: {
          p_fingerprint: string
          p_idempotency_key: string
          p_org_id: string
        }
        Returns: Json
      }
      begin_staff_command: {
        Args: {
          p_fingerprint: string
          p_idempotency_key: string
          p_org_id: string
        }
        Returns: Json
      }
      can_manage_commercial: { Args: { p_org_id: string }; Returns: boolean }
      can_read_cost: { Args: { p_org_id: string }; Returns: boolean }
      can_read_payroll: { Args: { p_org_id: string }; Returns: boolean }
      can_view_financial_evidence: {
        Args: { p_org_id: string }
        Returns: boolean
      }
      can_view_operational_evidence: {
        Args: { p_org_id: string }
        Returns: boolean
      }
      can_view_sensitive_staff_evidence: {
        Args: { p_org_id: string }
        Returns: boolean
      }
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
      cancel_procurement_order: {
        Args: {
          p_idempotency_key: string
          p_order_id: string
          p_org_id: string
          p_reason: string
        }
        Returns: {
          agreed_total_cost: number
          approved_at: string | null
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string
          event_id: string | null
          expected_delivery_at: string | null
          id: string
          notes: string | null
          order_date: string
          order_number: string
          organization_id: string
          sent_at: string | null
          sent_by: string | null
          status: Database["public"]["Enums"]["procurement_order_status"]
          supplier_contact_name_snapshot: string | null
          supplier_id: string
          supplier_name_snapshot: string | null
          supplier_phone_snapshot: string | null
          updated_at: string
          updated_by: string
        }
        SetofOptions: {
          from: "*"
          to: "procurement_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_quotation_draft: {
        Args: { p_org_id: string; p_quotation_id: string; p_reason?: string }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          cancellation_reason: string | null
          converted_at: string | null
          converted_event_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          discount_amount: number
          discount_type: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value: number
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          event_type_snapshot: string
          expired_at: string | null
          expired_by: string | null
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string | null
          issued_by: string | null
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          pre_vat_total: number
          prospect_company: string | null
          prospect_whatsapp: string | null
          quotation_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          revision: number
          series_id: string | null
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          subtotal: number
          superseded_reason: string | null
          surcharge_amount: number
          surcharge_note: string | null
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          transport_amount: number
          transport_note: string | null
          transport_required: boolean
          transport_zone: string | null
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_org_invitation: {
        Args: { p_code: string }
        Returns: {
          created_at: string
          default_currency: string
          display_name: string | null
          id: string
          is_active: boolean
          name: string
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      clear_member_permission: {
        Args: { p_capability: string; p_org_id: string; p_user_id: string }
        Returns: undefined
      }
      clock_staff_in: {
        Args: {
          p_assignment_id: string
          p_attendance_method?: Database["public"]["Enums"]["attendance_method"]
          p_event_id: string
          p_evidence_file_name: string
          p_evidence_mime_type: string
          p_evidence_path: string
          p_evidence_size_bytes: number
          p_idempotency_key: string
          p_match_attempt_id?: string
          p_notes: string
          p_org_id: string
          p_shift: Database["public"]["Enums"]["staff_shift"]
          p_staff_member_id: string
        }
        Returns: {
          assignment_id: string | null
          attendance_date: string
          break_minutes: number
          check_in: string | null
          check_in_method: Database["public"]["Enums"]["attendance_method"]
          check_out: string | null
          check_out_method: Database["public"]["Enums"]["attendance_method"]
          confirmed_by: string | null
          created_at: string
          earned_amount: number
          event_id: string
          hours_worked: number
          id: string
          idempotency_key: string
          match_attempt_id: string | null
          notes: string | null
          organization_id: string
          recorded_by: string
          request_fingerprint: string
          shift: Database["public"]["Enums"]["staff_shift"]
          staff_member_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          wage_method: Database["public"]["Enums"]["compensation_method"]
          wage_rate: number
        }
        SetofOptions: {
          from: "*"
          to: "staff_attendance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      clock_staff_out: {
        Args: {
          p_attendance_method?: Database["public"]["Enums"]["attendance_method"]
          p_event_id: string
          p_evidence_file_name: string
          p_evidence_mime_type: string
          p_evidence_path: string
          p_evidence_size_bytes: number
          p_idempotency_key: string
          p_match_attempt_id?: string
          p_notes: string
          p_org_id: string
          p_staff_member_id: string
        }
        Returns: {
          assignment_id: string | null
          attendance_date: string
          break_minutes: number
          check_in: string | null
          check_in_method: Database["public"]["Enums"]["attendance_method"]
          check_out: string | null
          check_out_method: Database["public"]["Enums"]["attendance_method"]
          confirmed_by: string | null
          created_at: string
          earned_amount: number
          event_id: string
          hours_worked: number
          id: string
          idempotency_key: string
          match_attempt_id: string | null
          notes: string | null
          organization_id: string
          recorded_by: string
          request_fingerprint: string
          shift: Database["public"]["Enums"]["staff_shift"]
          staff_member_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          wage_method: Database["public"]["Enums"]["compensation_method"]
          wage_rate: number
        }
        SetofOptions: {
          from: "*"
          to: "staff_attendance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_event_financially: {
        Args: {
          p_event_id: string
          p_idempotency_key?: string
          p_note?: string
          p_org_id: string
        }
        Returns: {
          close_note: string | null
          closed_at: string
          closed_by: string
          collected_at_close: number | null
          costs_at_close: number | null
          created_at: string
          event_id: string
          id: string
          margin_at_close: number | null
          organization_id: string
          outstanding_at_close: number | null
          profit_at_close: number | null
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          revenue_at_close: number | null
        }
        SetofOptions: {
          from: "*"
          to: "event_financial_closures"
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
      commit_opening_cutover: {
        Args: {
          p_idempotency_key?: string
          p_org_id: string
          p_vat_payable?: number
        }
        Returns: Json
      }
      complete_evidence_reclaim: {
        Args: {
          p_max_age_days?: number
          p_org_id: string
          p_storage_paths: string[]
        }
        Returns: number
      }
      compute_earned_amount: {
        Args: {
          p_break_minutes: number
          p_check_in: string
          p_check_out: string
          p_wage_method: Database["public"]["Enums"]["compensation_method"]
          p_wage_rate: number
        }
        Returns: number
      }
      confirm_procurement_order: {
        Args: {
          p_idempotency_key: string
          p_order_id: string
          p_org_id: string
        }
        Returns: {
          agreed_total_cost: number
          approved_at: string | null
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string
          event_id: string | null
          expected_delivery_at: string | null
          id: string
          notes: string | null
          order_date: string
          order_number: string
          organization_id: string
          sent_at: string | null
          sent_by: string | null
          status: Database["public"]["Enums"]["procurement_order_status"]
          supplier_contact_name_snapshot: string | null
          supplier_id: string
          supplier_name_snapshot: string | null
          supplier_phone_snapshot: string | null
          updated_at: string
          updated_by: string
        }
        SetofOptions: {
          from: "*"
          to: "procurement_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consumable_stock_on_hand: {
        Args: { p_org_id: string; p_stock_item_id: string }
        Returns: number
      }
      consume_consumable_at_event: {
        Args: {
          p_event_id: string
          p_idempotency_key: string
          p_org_id: string
          p_quantity: number
          p_reference: string
          p_stock_item_id: string
        }
        Returns: {
          actor_id: string
          created_at: string
          event_delta: number
          event_id: string | null
          id: string
          idempotency_key: string
          movement_kind: Database["public"]["Enums"]["consumable_movement_kind"]
          organization_id: string
          quantity: number
          reason: string | null
          reference: string | null
          request_fingerprint: string
          stock_item_id: string
          warehouse_delta: number
        }
        SetofOptions: {
          from: "*"
          to: "consumable_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consume_face_match_attempt: {
        Args: {
          p_action: string
          p_attempt_id: string
          p_event_id: string
          p_org_id: string
          p_staff_member_id: string
        }
        Returns: string
      }
      convert_quotation_to_event: {
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
      create_event_invoice: {
        Args: {
          p_due_at: string
          p_event_id: string
          p_idempotency_key: string
          p_installments: Json
          p_invoice_number: string
          p_note: string
          p_org_id: string
          p_total_amount: number
        }
        Returns: {
          created_at: string
          created_by: string
          currency: string
          due_at: string | null
          event_id: string
          id: string
          invoice_number: string
          issued_at: string
          note: string | null
          organization_id: string
          pre_vat_total: number
          quotation_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          total_amount: number
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_org_invitation: {
        Args: {
          p_email: string
          p_org_id: string
          p_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: {
          claimed_at: string | null
          claimed_by: string | null
          code: string
          created_at: string
          created_by: string | null
          email: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "org_invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_organization: {
        Args: { p_display_name?: string; p_name: string }
        Returns: string
      }
      create_procurement_order: {
        Args: {
          p_event_id: string
          p_expected_delivery_at: string
          p_idempotency_key: string
          p_lines: Json
          p_notes: string
          p_order_date: string
          p_org_id: string
          p_supplier_id: string
        }
        Returns: {
          agreed_total_cost: number
          approved_at: string | null
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string
          event_id: string | null
          expected_delivery_at: string | null
          id: string
          notes: string | null
          order_date: string
          order_number: string
          organization_id: string
          sent_at: string | null
          sent_by: string | null
          status: Database["public"]["Enums"]["procurement_order_status"]
          supplier_contact_name_snapshot: string | null
          supplier_id: string
          supplier_name_snapshot: string | null
          supplier_phone_snapshot: string | null
          updated_at: string
          updated_by: string
        }
        SetofOptions: {
          from: "*"
          to: "procurement_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_quotation_draft: {
        Args: {
          p_customer_id?: string
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
          accepted_at: string | null
          accepted_by: string | null
          cancellation_reason: string | null
          converted_at: string | null
          converted_event_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          discount_amount: number
          discount_type: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value: number
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          event_type_snapshot: string
          expired_at: string | null
          expired_by: string | null
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string | null
          issued_by: string | null
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          pre_vat_total: number
          prospect_company: string | null
          prospect_whatsapp: string | null
          quotation_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          revision: number
          series_id: string | null
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          subtotal: number
          superseded_reason: string | null
          surcharge_amount: number
          surcharge_note: string | null
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          transport_amount: number
          transport_note: string | null
          transport_required: boolean
          transport_zone: string | null
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_supplier: {
        Args: {
          p_category: Database["public"]["Enums"]["supplier_category"]
          p_commercial_registration_number: string
          p_contact_name: string
          p_email: string
          p_idempotency_key: string
          p_name: string
          p_notes: string
          p_org_id: string
          p_phone: string
          p_whatsapp: string
        }
        Returns: {
          category: Database["public"]["Enums"]["supplier_category"]
          commercial_registration_number: string | null
          contact_name: string | null
          created_at: string
          created_by: string
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          status: Database["public"]["Enums"]["supplier_status"]
          updated_at: string
          updated_by: string
          whatsapp: string | null
        }
        SetofOptions: {
          from: "*"
          to: "suppliers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_treasury_account: {
        Args: {
          p_account_tail?: string
          p_bank_name?: string
          p_idempotency_key?: string
          p_name: string
          p_notes?: string
          p_org_id: string
          p_treasury_type: Database["public"]["Enums"]["treasury_account_type"]
        }
        Returns: {
          account_tail: string | null
          bank_name: string | null
          chart_account_id: string
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          organization_id: string
          treasury_type: Database["public"]["Enums"]["treasury_account_type"]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "treasury_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      customer_360: {
        Args: { p_org_id: string }
        Returns: {
          accepted_quotes: number
          completed_events: number
          customer_id: string
          customer_type: Database["public"]["Enums"]["customer_type"]
          days_since_last_event: number
          events_count: number
          first_interaction_at: string
          gross_profit: number
          is_active: boolean
          last_event_at: string
          last_interaction_at: string
          name: string
          notes: string
          outstanding: number
          phone: string
          quotes_count: number
          rejected_quotes: number
          total_collected: number
          total_commercial_value: number
          upcoming_events: number
          whatsapp: string
        }[]
      }
      customer_payment_receipt: {
        Args: { p_org_id: string; p_payment_id: string }
        Returns: {
          amount: number
          customer_name: string
          event_number: string
          event_title: string
          notes: string
          org_name: string
          org_phone: string
          paid_at: string
          payment_id: string
          payment_method: string
          receipt_number: string
          recorded_by_name: string
          reference: string
          status: string
          void_reason: string
          voided_at: string
        }[]
      }
      customer_statement: {
        Args: { p_customer_id: string; p_org_id: string }
        Returns: {
          amount: number
          event_id: string
          event_number: string
          event_title: string
          notes: string
          occurred_at: string
          payment_method: string
          reference: string
          row_kind: string
        }[]
      }
      delete_quotation_line: {
        Args: { p_line_id: string; p_org_id: string; p_quotation_id: string }
        Returns: undefined
      }
      dispatch_event_equipment: {
        Args: {
          p_event_id: string
          p_idempotency_key: string
          p_notes: string
          p_org_id: string
          p_quantity: number
          p_reference: string
          p_reservation_id: string
        }
        Returns: {
          actor_id: string
          condition_notes: string | null
          created_at: string
          damage_loss_valuation_omr: number | null
          damaged_quantity: number
          dispatched_quantity: number
          equipment_capacity_id: string
          event_id: string
          id: string
          idempotency_key: string
          lost_quantity: number
          movement_kind: Database["public"]["Enums"]["warehouse_movement_kind"]
          organization_id: string
          reference: string | null
          request_fingerprint: string
          reservation_id: string
          returned_good_quantity: number
          unit_valuation_omr: number | null
          valuation_basis:
            | Database["public"]["Enums"]["warehouse_valuation_basis"]
            | null
        }
        SetofOptions: {
          from: "*"
          to: "event_equipment_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      document_number_prefix: {
        Args: { p_kind: string; p_org_id: string }
        Returns: string
      }
      enroll_staff_face: {
        Args: {
          p_capture_count: number
          p_model_version: string
          p_org_id: string
          p_provider_code: string
          p_staff_member_id: string
          p_template_ref: string
        }
        Returns: Json
      }
      ensure_system_chart: { Args: { p_org_id: string }; Returns: undefined }
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
      event_attendance_candidates: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: {
          assignment_id: string
          assignment_role: string
          enrollment_active: boolean
          is_open: boolean
          open_check_in: string
          staff_member_id: string
          staff_name: string
        }[]
      }
      event_attendance_status: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: {
          assignment_id: string
          attendance_date: string
          attendance_id: string
          check_in: string
          check_in_method: Database["public"]["Enums"]["attendance_method"]
          check_out: string
          check_out_method: Database["public"]["Enums"]["attendance_method"]
          has_checkin_evidence: boolean
          has_checkout_evidence: boolean
          hours_worked: number
          shift: Database["public"]["Enums"]["staff_shift"]
          staff_member_id: string
          staff_name: string
          status: Database["public"]["Enums"]["attendance_status"]
        }[]
      }
      event_command_center: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: Json
      }
      event_consumable_state: {
        Args: { p_event_id: string; p_org_id: string; p_stock_item_id: string }
        Returns: {
          consumed_quantity: number
          issued_quantity: number
          outstanding_quantity: number
          returned_quantity: number
          wasted_quantity: number
        }[]
      }
      event_consumable_summary: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: Json
      }
      event_financial_readiness: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: {
          check_key: string
          detail: string
          ok: boolean
        }[]
      }
      event_financially_ready: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: boolean
      }
      event_operational_readiness: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: Json
      }
      event_procurement_ops_lines: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: {
          expected_delivery_at: string
          item_name: string
          order_date: string
          order_notes: string
          order_number: string
          order_status: string
          quantity: number
          supplier_name: string
          unit: string
        }[]
      }
      event_readiness: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: Json
      }
      event_readiness_batch: {
        Args: { p_event_ids: string[]; p_org_id: string }
        Returns: {
          consumables_shortage: number
          equipment_shortage: number
          event_id: string
          procurement_pending: number
          reasons: string[]
          staff_assigned: number
          staff_missing: number
          staff_required: number
          status: string
        }[]
      }
      event_team_sheet: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: {
          assignment_notes: string
          assignment_role: string
          check_in: string
          check_out: string
          presence_status: string
          scheduled_end: string
          scheduled_start: string
          staff_member_id: string
          staff_name: string
          staff_phone: string
        }[]
      }
      event_warehouse_sheet_lines: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: {
          damaged_qty: number
          dispatched_qty: number
          item_name: string
          line_kind: string
          lost_qty: number
          outstanding_qty: number
          prepared_qty: number
          required_qty: number
          returned_good_qty: number
          unit: string
        }[]
      }
      event_warehouse_summary: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: Json
      }
      event_work_order_header: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: {
          contact_name: string
          contact_phone: string
          customer_name: string
          end_at: string
          event_number: string
          event_type: string
          guest_count: number
          location_details: string
          notes: string
          responsible_user_name: string
          start_at: string
          status: string
          title: string
          venue_name: string
        }[]
      }
      expire_face_match_attempts: {
        Args: { p_org_id: string }
        Returns: number
      }
      expire_quotation: {
        Args: {
          p_idempotency_key?: string
          p_org_id: string
          p_quotation_id: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          cancellation_reason: string | null
          converted_at: string | null
          converted_event_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          discount_amount: number
          discount_type: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value: number
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          event_type_snapshot: string
          expired_at: string | null
          expired_by: string | null
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string | null
          issued_by: string | null
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          pre_vat_total: number
          prospect_company: string | null
          prospect_whatsapp: string | null
          quotation_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          revision: number
          series_id: string | null
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          subtotal: number
          superseded_reason: string | null
          surcharge_amount: number
          surcharge_note: string | null
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          transport_amount: number
          transport_note: string | null
          transport_required: boolean
          transport_zone: string | null
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finish_command: {
        Args: {
          p_command_name: string
          p_command_scope: string
          p_fingerprint: string
          p_idempotency_key: string
          p_org_id: string
          p_response: Json
          p_result_entity: string
          p_result_id: string
        }
        Returns: undefined
      }
      finish_payment_command: {
        Args: {
          p_command_name: string
          p_fingerprint: string
          p_idempotency_key: string
          p_org_id: string
          p_response: Json
          p_result_entity: string
          p_result_id: string
        }
        Returns: undefined
      }
      finish_procurement_command: {
        Args: {
          p_command_name: string
          p_fingerprint: string
          p_idempotency_key: string
          p_org_id: string
          p_response: Json
          p_result_entity: string
          p_result_id: string
        }
        Returns: undefined
      }
      finish_staff_command: {
        Args: {
          p_command_name: string
          p_fingerprint: string
          p_idempotency_key: string
          p_org_id: string
          p_response: Json
          p_result_entity: string
          p_result_id: string
        }
        Returns: undefined
      }
      get_host_payroll_summary: {
        Args: {
          p_event_id?: string
          p_org_id: string
          p_staff_member_id: string
        }
        Returns: {
          advances_total: number
          attendance_count: number
          due_total: number
          earned_total: number
          event_id: string
          late_total: number
          paid_total: number
          payouts_total: number
          staff_member_id: string
        }[]
      }
      get_staff_face_enrollment: {
        Args: { p_org_id: string; p_staff_member_id: string }
        Returns: Json
      }
      global_search: {
        Args: { p_org_id: string; p_term: string }
        Returns: {
          destination: string
          entity_id: string
          entity_type: string
          subtitle: string
          title: string
        }[]
      }
      has_org_role: {
        Args: {
          p_org_id: string
          p_roles: Database["public"]["Enums"]["app_role"][]
        }
        Returns: boolean
      }
      has_permission: {
        Args: { p_capability: string; p_org_id: string }
        Returns: boolean
      }
      host_statement: {
        Args: { p_org_id: string; p_staff_member_id: string }
        Returns: {
          advances_total: number
          attendance_count: number
          due_total: number
          earned_total: number
          event_id: string
          event_number: string
          event_title: string
          host_name: string
          host_phone: string
          late_total: number
          paid_total: number
          payouts_total: number
          staff_member_id: string
          start_at: string
        }[]
      }
      install_attachments_storage_policies: { Args: never; Returns: undefined }
      integrity_findings: {
        Args: { p_org_id: string }
        Returns: {
          category: string
          destination: string
          entity_id: string
          entity_type: string
          finding_code: string
          problem: string
          severity: string
          why_it_matters: string
        }[]
      }
      internal_post_journal: {
        Args: {
          p_entry_date: string
          p_event_at?: string
          p_event_id?: string
          p_idempotency_key?: string
          p_is_reversal?: boolean
          p_lines: Json
          p_memo?: string
          p_org_id: string
          p_request_fingerprint?: string
          p_reversal_of?: string
          p_source_id: string
          p_source_type: Database["public"]["Enums"]["journal_source_type"]
        }
        Returns: {
          created_at: string
          created_by: string
          entry_date: string
          entry_number: string
          event_at: string | null
          event_id: string | null
          id: string
          idempotency_key: string
          is_reversal: boolean
          memo: string | null
          organization_id: string
          request_fingerprint: string
          reversal_of: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["journal_source_type"]
        }
        SetofOptions: {
          from: "*"
          to: "journal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_known_capability: { Args: { p_capability: string }; Returns: boolean }
      is_org_member: { Args: { p_org_id: string }; Returns: boolean }
      issue_consumable_to_event: {
        Args: {
          p_event_id: string
          p_idempotency_key: string
          p_org_id: string
          p_quantity: number
          p_reference: string
          p_stock_item_id: string
        }
        Returns: {
          actor_id: string
          created_at: string
          event_delta: number
          event_id: string | null
          id: string
          idempotency_key: string
          movement_kind: Database["public"]["Enums"]["consumable_movement_kind"]
          organization_id: string
          quantity: number
          reason: string | null
          reference: string | null
          request_fingerprint: string
          stock_item_id: string
          warehouse_delta: number
        }
        SetofOptions: {
          from: "*"
          to: "consumable_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
          cancellation_reason: string | null
          converted_at: string | null
          converted_event_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          discount_amount: number
          discount_type: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value: number
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          event_type_snapshot: string
          expired_at: string | null
          expired_by: string | null
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string | null
          issued_by: string | null
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          pre_vat_total: number
          prospect_company: string | null
          prospect_whatsapp: string | null
          quotation_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          revision: number
          series_id: string | null
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          subtotal: number
          superseded_reason: string | null
          surcharge_amount: number
          surcharge_note: string | null
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          transport_amount: number
          transport_note: string | null
          transport_required: boolean
          transport_zone: string | null
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      issue_quotation: {
        Args: {
          p_idempotency_key?: string
          p_notes?: string
          p_org_id: string
          p_quotation_id: string
          p_terms?: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          cancellation_reason: string | null
          converted_at: string | null
          converted_event_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          discount_amount: number
          discount_type: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value: number
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          event_type_snapshot: string
          expired_at: string | null
          expired_by: string | null
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string | null
          issued_by: string | null
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          pre_vat_total: number
          prospect_company: string | null
          prospect_whatsapp: string | null
          quotation_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          revision: number
          series_id: string | null
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          subtotal: number
          superseded_reason: string | null
          surcharge_amount: number
          surcharge_note: string | null
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          transport_amount: number
          transport_note: string | null
          transport_required: boolean
          transport_zone: string | null
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      known_capabilities: { Args: never; Returns: string[] }
      link_evidence: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_evidence_type: Database["public"]["Enums"]["attachment_evidence_type"]
          p_file_name: string
          p_metadata?: Json
          p_mime_type: string
          p_org_id: string
          p_size_bytes: number
          p_storage_path: string
        }
        Returns: {
          created_at: string
          entity_id: string
          entity_type: string
          evidence_type: Database["public"]["Enums"]["attachment_evidence_type"]
          file_name: string
          id: string
          metadata: Json | null
          mime_type: string
          organization_id: string
          reclaimed_at: string | null
          size_bytes: number
          storage_path: string
          superseded_at: string | null
          uploaded_by: string
        }
        SetofOptions: {
          from: "*"
          to: "attachment_evidence"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      management_alerts: {
        Args: { p_limit?: number; p_now?: string; p_org_id: string }
        Returns: {
          alert_type: string
          customer_id: string
          destination: string
          detected_at: string
          entity_id: string
          entity_type: string
          event_id: string
          explanation: string
          severity: string
          title: string
        }[]
      }
      management_metrics: {
        Args: { p_from: string; p_now?: string; p_org_id: string; p_to: string }
        Returns: {
          actual_cost: number
          avg_quote_value: number
          close_blocked: number
          collected: number
          confirmed_upcoming: number
          events_in_progress: number
          events_low_readiness: number
          events_preparing: number
          events_today: number
          events_tomorrow: number
          events_waiting_return: number
          events_week: number
          financially_open_completed: number
          gross_profit: number
          margin_percent: number
          outstanding: number
          overdue_balance: number
          quote_conversion_rate: number
          quotes_accepted: number
          quotes_draft: number
          quotes_expired: number
          quotes_rejected: number
          quotes_waiting: number
          ready_to_close: number
          revenue: number
          top_packages: Json
        }[]
      }
      member_capability_list: {
        Args: { p_org_id: string; p_user_id: string }
        Returns: {
          allowed: boolean
          capability: string
          source: string
        }[]
      }
      my_capabilities: { Args: { p_org_id: string }; Returns: Json }
      next_document_number: {
        Args: { p_kind: string; p_org: string; p_prefix?: string }
        Returns: string
      }
      payroll_period_sheet: {
        Args: { p_from: string; p_org_id: string; p_to: string }
        Returns: {
          advances_total: number
          balance_total: number
          earned_total: number
          payouts_total: number
          shift_count: number
          staff_member_id: string
          staff_name: string
        }[]
      }
      persist_quotation_draft: {
        Args: {
          p_customer_id?: string
          p_end_at?: string
          p_event_title?: string
          p_event_type?: string
          p_guest_count?: number
          p_idempotency_key: string
          p_lines?: Json
          p_notes?: string
          p_org_id: string
          p_prospect_company?: string
          p_prospect_name: string
          p_prospect_phone?: string
          p_prospect_whatsapp?: string
          p_quotation_id: string
          p_start_at?: string
          p_venue_name?: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          cancellation_reason: string | null
          converted_at: string | null
          converted_event_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          discount_amount: number
          discount_type: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value: number
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          event_type_snapshot: string
          expired_at: string | null
          expired_by: string | null
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string | null
          issued_by: string | null
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          pre_vat_total: number
          prospect_company: string | null
          prospect_whatsapp: string | null
          quotation_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          revision: number
          series_id: string | null
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          subtotal: number
          superseded_reason: string | null
          surcharge_amount: number
          surcharge_note: string | null
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          transport_amount: number
          transport_note: string | null
          transport_required: boolean
          transport_zone: string | null
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      preview_opening_cutover: {
        Args: { p_org_id: string; p_vat_payable?: number }
        Returns: Json
      }
      procurement_line_total: {
        Args: { p_quantity: number; p_unit_cost: number }
        Returns: number
      }
      quotation_fingerprint: { Args: { p_payload: Json }; Returns: string }
      quotation_pricing: {
        Args: {
          p_discount_type: Database["public"]["Enums"]["quotation_discount_type"]
          p_discount_value: number
          p_subtotal: number
          p_surcharge: number
          p_transport: number
        }
        Returns: Record<string, unknown>
      }
      receive_consumable_stock: {
        Args: {
          p_idempotency_key: string
          p_org_id: string
          p_quantity: number
          p_reference: string
          p_stock_item_id: string
        }
        Returns: {
          actor_id: string
          created_at: string
          event_delta: number
          event_id: string | null
          id: string
          idempotency_key: string
          movement_kind: Database["public"]["Enums"]["consumable_movement_kind"]
          organization_id: string
          quantity: number
          reason: string | null
          reference: string | null
          request_fingerprint: string
          stock_item_id: string
          warehouse_delta: number
        }
        SetofOptions: {
          from: "*"
          to: "consumable_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      receive_procurement_order: {
        Args: {
          p_idempotency_key: string
          p_lines: Json
          p_notes: string
          p_order_id: string
          p_org_id: string
          p_received_at: string
          p_reference: string
        }
        Returns: {
          created_at: string
          id: string
          idempotency_key: string
          notes: string | null
          order_id: string
          organization_id: string
          received_at: string
          received_by: string
          reference: string | null
          request_fingerprint: string
        }
        SetofOptions: {
          from: "*"
          to: "procurement_receipts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reclaim_evidence: {
        Args: { p_max_age_days?: number; p_org_id: string }
        Returns: {
          bucket_id: string
          entity_id: string
          entity_type: string
          evidence_type: Database["public"]["Enums"]["attachment_evidence_type"]
          object_created_at: string
          object_id: string
          reason: string
          storage_path: string
        }[]
      }
      reclaim_evidence_candidates: {
        Args: { p_cutoff: string; p_org_id: string }
        Returns: {
          bucket_id: string
          entity_id: string
          entity_type: string
          evidence_type: Database["public"]["Enums"]["attachment_evidence_type"]
          object_created_at: string
          object_id: string
          reason: string
          storage_path: string
        }[]
      }
      reconcile_event_consumables: {
        Args: {
          p_event_id: string
          p_idempotency_key: string
          p_notes: string
          p_org_id: string
        }
        Returns: {
          actor_id: string
          event_id: string
          id: string
          idempotency_key: string
          notes: string | null
          organization_id: string
          reconciled_at: string
          request_fingerprint: string
          total_consumed_quantity: number
          total_issued_quantity: number
          total_returned_quantity: number
          total_wasted_quantity: number
        }
        SetofOptions: {
          from: "*"
          to: "event_consumable_reconciliations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reconcile_event_warehouse: {
        Args: {
          p_event_id: string
          p_idempotency_key: string
          p_notes: string
          p_org_id: string
        }
        Returns: {
          actor_id: string
          event_id: string
          id: string
          idempotency_key: string
          notes: string | null
          organization_id: string
          reconciled_at: string
          request_fingerprint: string
          total_damage_loss_valuation_omr: number
          total_damaged_quantity: number
          total_dispatched_quantity: number
          total_lost_quantity: number
          total_reserved_quantity: number
          total_returned_good_quantity: number
        }
        SetofOptions: {
          from: "*"
          to: "event_warehouse_reconciliations"
          isOneToOne: true
          isSetofReturn: false
        }
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
      record_consumable_movement: {
        Args: {
          p_audit_action: string
          p_event_id: string
          p_fingerprint: string
          p_idempotency_key: string
          p_kind: Database["public"]["Enums"]["consumable_movement_kind"]
          p_org_id: string
          p_quantity: number
          p_reason: string
          p_reference: string
          p_stock_item_id: string
        }
        Returns: {
          actor_id: string
          created_at: string
          event_delta: number
          event_id: string | null
          id: string
          idempotency_key: string
          movement_kind: Database["public"]["Enums"]["consumable_movement_kind"]
          organization_id: string
          quantity: number
          reason: string | null
          reference: string | null
          request_fingerprint: string
          stock_item_id: string
          warehouse_delta: number
        }
        SetofOptions: {
          from: "*"
          to: "consumable_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_customer_payment: {
        Args: {
          p_amount: number
          p_event_id: string
          p_idempotency_key: string
          p_notes: string
          p_org_id: string
          p_paid_at: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_reference: string
          p_treasury_account_id?: string
        }
        Returns: {
          amount: number
          created_at: string
          event_id: string
          id: string
          idempotency_key: string
          notes: string | null
          organization_id: string
          paid_at: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string
          reference: string | null
          request_fingerprint: string
          status: Database["public"]["Enums"]["customer_payment_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customer_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_event_expense: {
        Args: {
          p_amount: number
          p_category: Database["public"]["Enums"]["expense_category"]
          p_description: string
          p_event_id: string
          p_expense_date: string
          p_idempotency_key?: string
          p_org_id: string
          p_payee?: string
          p_payment_method?: Database["public"]["Enums"]["payment_method"]
          p_reference?: string
          p_treasury_account_id?: string
        }
        Returns: {
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          description: string
          event_id: string
          expense_date: string
          id: string
          idempotency_key: string
          organization_id: string
          payee: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          recorded_by: string
          reference: string | null
          request_fingerprint: string
          status: Database["public"]["Enums"]["customer_payment_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "event_expenses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_face_match_attempt: {
        Args: {
          p_action: string
          p_confidence_label: string
          p_event_id: string
          p_org_id: string
          p_provider_code: string
          p_staff_member_id: string
        }
        Returns: string
      }
      record_host_payout: {
        Args: {
          p_amount: number
          p_event_id: string
          p_idempotency_key: string
          p_org_id: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_payout_date: string
          p_reason: string
          p_reference: string
          p_staff_member_id: string
          p_treasury_account_id?: string
        }
        Returns: {
          amount: number
          created_at: string
          event_id: string | null
          id: string
          idempotency_key: string
          organization_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payout_date: string
          reason: string | null
          recorded_by: string
          reference: string | null
          request_fingerprint: string
          staff_member_id: string
          status: Database["public"]["Enums"]["host_payment_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "host_payouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_host_payout_multi: {
        Args: {
          p_allocations: Json
          p_amount: number
          p_evidence_file_name?: string
          p_evidence_mime_type?: string
          p_evidence_path?: string
          p_evidence_size_bytes?: number
          p_idempotency_key?: string
          p_org_id: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_payout_date: string
          p_reason: string
          p_reference: string
          p_staff_member_id: string
          p_treasury_account_id?: string
        }
        Returns: {
          amount: number
          created_at: string
          event_id: string | null
          id: string
          idempotency_key: string
          organization_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payout_date: string
          reason: string | null
          recorded_by: string
          reference: string | null
          request_fingerprint: string
          staff_member_id: string
          status: Database["public"]["Enums"]["host_payment_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "host_payouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_staff_advance: {
        Args: {
          p_advance_date: string
          p_amount: number
          p_idempotency_key: string
          p_org_id: string
          p_reason: string
          p_staff_member_id: string
          p_treasury_account_id?: string
        }
        Returns: {
          advance_date: string
          amount: number
          created_at: string
          id: string
          idempotency_key: string
          organization_id: string
          reason: string | null
          recorded_by: string
          request_fingerprint: string
          staff_member_id: string
          status: Database["public"]["Enums"]["host_payment_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "staff_advances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_staff_attendance: {
        Args: {
          p_assignment_id: string
          p_attendance_date: string
          p_break_minutes: number
          p_check_in: string
          p_check_out: string
          p_event_id: string
          p_idempotency_key: string
          p_notes: string
          p_org_id: string
          p_shift: Database["public"]["Enums"]["staff_shift"]
          p_staff_member_id: string
          p_status: Database["public"]["Enums"]["attendance_status"]
        }
        Returns: {
          assignment_id: string | null
          attendance_date: string
          break_minutes: number
          check_in: string | null
          check_in_method: Database["public"]["Enums"]["attendance_method"]
          check_out: string | null
          check_out_method: Database["public"]["Enums"]["attendance_method"]
          confirmed_by: string | null
          created_at: string
          earned_amount: number
          event_id: string
          hours_worked: number
          id: string
          idempotency_key: string
          match_attempt_id: string | null
          notes: string | null
          organization_id: string
          recorded_by: string
          request_fingerprint: string
          shift: Database["public"]["Enums"]["staff_shift"]
          staff_member_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          wage_method: Database["public"]["Enums"]["compensation_method"]
          wage_rate: number
        }
        SetofOptions: {
          from: "*"
          to: "staff_attendance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_supplier_invoice: {
        Args: {
          p_due_date: string
          p_event_id: string
          p_idempotency_key?: string
          p_invoice_date: string
          p_invoice_number: string
          p_lines: Json
          p_notes?: string
          p_order_id: string
          p_org_id: string
          p_override_reason?: string
          p_owner_override?: boolean
          p_supplier_id: string
        }
        Returns: {
          amount: number
          created_at: string
          due_date: string | null
          event_id: string | null
          id: string
          idempotency_key: string
          invoice_date: string
          invoice_number: string
          notes: string | null
          order_id: string
          organization_id: string
          override_reason: string | null
          owner_override: boolean
          recorded_by: string
          request_fingerprint: string
          status: Database["public"]["Enums"]["customer_payment_status"]
          supplier_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "supplier_invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_supplier_payment: {
        Args: {
          p_allocations?: Json
          p_amount: number
          p_idempotency_key?: string
          p_org_id: string
          p_payment_date: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_reason: string
          p_reference: string
          p_supplier_id: string
          p_treasury_account_id?: string
        }
        Returns: {
          amount: number
          created_at: string
          id: string
          idempotency_key: string
          organization_id: string
          payment_date: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          reason: string | null
          recorded_by: string
          reference: string | null
          request_fingerprint: string
          status: Database["public"]["Enums"]["customer_payment_status"]
          supplier_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "supplier_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reject_quotation: {
        Args: {
          p_idempotency_key?: string
          p_org_id: string
          p_quotation_id: string
          p_reason?: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          cancellation_reason: string | null
          converted_at: string | null
          converted_event_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          discount_amount: number
          discount_type: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value: number
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          event_type_snapshot: string
          expired_at: string | null
          expired_by: string | null
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string | null
          issued_by: string | null
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          pre_vat_total: number
          prospect_company: string | null
          prospect_whatsapp: string | null
          quotation_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          revision: number
          series_id: string | null
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          subtotal: number
          superseded_reason: string | null
          surcharge_amount: number
          surcharge_note: string | null
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          transport_amount: number
          transport_note: string | null
          transport_required: boolean
          transport_zone: string | null
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_equipment_reservation: {
        Args: { p_org_id: string; p_reservation_id: string }
        Returns: undefined
      }
      release_staff_assignment: {
        Args: { p_assignment_id: string; p_org_id: string }
        Returns: undefined
      }
      reopen_event_financially: {
        Args: {
          p_event_id: string
          p_idempotency_key?: string
          p_org_id: string
          p_reason: string
        }
        Returns: {
          close_note: string | null
          closed_at: string
          closed_by: string
          collected_at_close: number | null
          costs_at_close: number | null
          created_at: string
          event_id: string
          id: string
          margin_at_close: number | null
          organization_id: string
          outstanding_at_close: number | null
          profit_at_close: number | null
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          revenue_at_close: number | null
        }
        SetofOptions: {
          from: "*"
          to: "event_financial_closures"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      replace_procurement_lines_internal: {
        Args: { p_lines: Json; p_order_id: string; p_org_id: string }
        Returns: number
      }
      report_customers: {
        Args: { p_org_id: string }
        Returns: {
          actual_cost: number
          collected: number
          customer_id: string
          events_count: number
          gross_profit: number
          name: string
          outstanding: number
          total_value: number
        }[]
      }
      report_events: {
        Args: { p_from: string; p_org_id: string; p_to: string }
        Returns: {
          actual_cost: number
          collected: number
          event_id: string
          event_number: string
          gross_profit: number
          guest_count: number
          margin_percent: number
          outstanding: number
          revenue: number
          start_at: string
          status: Database["public"]["Enums"]["event_status"]
          title: string
        }[]
      }
      report_packages: {
        Args: { p_org_id: string }
        Returns: {
          actual_cost: number
          commercial_value: number
          gross_profit: number
          margin_percent: number
          package_id: string
          package_name: string
          usage_count: number
        }[]
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
      reset_quotation_lines: {
        Args: { p_org_id: string; p_quotation_id: string }
        Returns: undefined
      }
      return_consumable_from_event: {
        Args: {
          p_event_id: string
          p_idempotency_key: string
          p_org_id: string
          p_quantity: number
          p_reference: string
          p_stock_item_id: string
        }
        Returns: {
          actor_id: string
          created_at: string
          event_delta: number
          event_id: string | null
          id: string
          idempotency_key: string
          movement_kind: Database["public"]["Enums"]["consumable_movement_kind"]
          organization_id: string
          quantity: number
          reason: string | null
          reference: string | null
          request_fingerprint: string
          stock_item_id: string
          warehouse_delta: number
        }
        SetofOptions: {
          from: "*"
          to: "consumable_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      return_event_equipment: {
        Args: {
          p_condition_notes: string
          p_damaged_quantity: number
          p_event_id: string
          p_idempotency_key: string
          p_lost_quantity: number
          p_org_id: string
          p_reference: string
          p_reservation_id: string
          p_returned_good_quantity: number
        }
        Returns: {
          actor_id: string
          condition_notes: string | null
          created_at: string
          damage_loss_valuation_omr: number | null
          damaged_quantity: number
          dispatched_quantity: number
          equipment_capacity_id: string
          event_id: string
          id: string
          idempotency_key: string
          lost_quantity: number
          movement_kind: Database["public"]["Enums"]["warehouse_movement_kind"]
          organization_id: string
          reference: string | null
          request_fingerprint: string
          reservation_id: string
          returned_good_quantity: number
          unit_valuation_omr: number | null
          valuation_basis:
            | Database["public"]["Enums"]["warehouse_valuation_basis"]
            | null
        }
        SetofOptions: {
          from: "*"
          to: "event_equipment_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reverse_journal_entry: {
        Args: {
          p_entry_id: string
          p_idempotency_key?: string
          p_org_id: string
          p_reason: string
        }
        Returns: {
          created_at: string
          created_by: string
          entry_date: string
          entry_number: string
          event_at: string | null
          event_id: string | null
          id: string
          idempotency_key: string
          is_reversal: boolean
          memo: string | null
          organization_id: string
          request_fingerprint: string
          reversal_of: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["journal_source_type"]
        }
        SetofOptions: {
          from: "*"
          to: "journal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revise_quotation: {
        Args: {
          p_idempotency_key?: string
          p_org_id: string
          p_quotation_id: string
          p_reason?: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          cancellation_reason: string | null
          converted_at: string | null
          converted_event_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          discount_amount: number
          discount_type: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value: number
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          event_type_snapshot: string
          expired_at: string | null
          expired_by: string | null
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string | null
          issued_by: string | null
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          pre_vat_total: number
          prospect_company: string | null
          prospect_whatsapp: string | null
          quotation_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          revision: number
          series_id: string | null
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          subtotal: number
          superseded_reason: string | null
          surcharge_amount: number
          surcharge_note: string | null
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          transport_amount: number
          transport_note: string | null
          transport_required: boolean
          transport_zone: string | null
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_org_invitation: {
        Args: { p_invitation_id: string; p_org_id: string }
        Returns: {
          claimed_at: string | null
          claimed_by: string | null
          code: string
          created_at: string
          created_by: string | null
          email: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "org_invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_staff_face: {
        Args: { p_org_id: string; p_reason: string; p_staff_member_id: string }
        Returns: undefined
      }
      role_default_capability: {
        Args: {
          p_capability: string
          p_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      save_consumable_stock_item: {
        Args: {
          p_catalog_item_id: string
          p_is_tracking_active: boolean
          p_minimum_stock_quantity: number
          p_org_id: string
        }
        Returns: {
          catalog_item_id: string
          created_at: string
          created_by: string
          id: string
          is_tracking_active: boolean
          minimum_stock_quantity: number
          organization_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "consumable_stock_items"
          isOneToOne: true
          isSetofReturn: false
        }
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
      save_organization_settings: {
        Args: {
          p_accent_color?: string
          p_address_line1?: string
          p_city?: string
          p_commercial_registration?: string
          p_country?: string
          p_document_footer?: string
          p_document_terms?: string
          p_email?: string
          p_event_number_prefix?: string
          p_invoice_number_prefix?: string
          p_logo_url?: string
          p_manager_name?: string
          p_manager_title?: string
          p_name_en?: string
          p_org_id: string
          p_phone_primary?: string
          p_phone_secondary?: string
          p_po_box?: string
          p_postal_code?: string
          p_primary_color?: string
          p_quotation_number_prefix?: string
          p_region?: string
          p_vat_percent?: number
          p_vat_registered?: boolean
          p_vat_registration_number?: string
          p_whatsapp?: string
        }
        Returns: {
          accent_color: string | null
          accounting_cutover_at: string | null
          accounting_cutover_by: string | null
          accounting_cutover_vat_payable: number | null
          address_line1: string | null
          city: string | null
          commercial_registration: string | null
          country: string | null
          created_at: string
          document_footer: string | null
          document_terms: string | null
          email: string | null
          event_number_prefix: string
          invoice_number_prefix: string
          logo_url: string | null
          manager_name: string | null
          manager_title: string | null
          name_en: string | null
          organization_id: string
          phone_primary: string | null
          phone_secondary: string | null
          po_box: string | null
          postal_code: string | null
          primary_color: string | null
          quotation_number_prefix: string
          region: string | null
          updated_at: string
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          whatsapp: string | null
        }
        SetofOptions: {
          from: "*"
          to: "organization_settings"
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
      save_quotation_draft: {
        Args: {
          p_customer_id?: string
          p_end_at?: string
          p_event_title?: string
          p_event_type?: string
          p_guest_count?: number
          p_lines?: Json
          p_notes?: string
          p_org_id: string
          p_prospect_company?: string
          p_prospect_name: string
          p_prospect_phone?: string
          p_prospect_whatsapp?: string
          p_quotation_id: string
          p_start_at?: string
          p_venue_name?: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          cancellation_reason: string | null
          converted_at: string | null
          converted_event_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          discount_amount: number
          discount_type: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value: number
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          event_type_snapshot: string
          expired_at: string | null
          expired_by: string | null
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string | null
          issued_by: string | null
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          pre_vat_total: number
          prospect_company: string | null
          prospect_whatsapp: string | null
          quotation_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          revision: number
          series_id: string | null
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          subtotal: number
          superseded_reason: string | null
          surcharge_amount: number
          surcharge_note: string | null
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          transport_amount: number
          transport_note: string | null
          transport_required: boolean
          transport_zone: string | null
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_quotation_line: {
        Args: {
          p_description: string
          p_expected_unit_cost?: number
          p_is_custom?: boolean
          p_item_type: Database["public"]["Enums"]["catalog_item_type"]
          p_line_id: string
          p_notes?: string
          p_org_id: string
          p_pricing_method: Database["public"]["Enums"]["pricing_method"]
          p_quantity: number
          p_quotation_id: string
          p_source_catalog_item_id?: string
          p_source_package_id?: string
          p_unit: string
          p_unit_selling_price: number
        }
        Returns: {
          created_at: string
          description: string
          expected_unit_cost: number
          id: string
          is_custom: boolean
          item_type: Database["public"]["Enums"]["catalog_item_type"]
          notes: string | null
          organization_id: string
          pricing_method: Database["public"]["Enums"]["pricing_method"]
          quantity: number
          quotation_id: string
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
          to: "quotation_lines"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      send_procurement_order: {
        Args: {
          p_idempotency_key: string
          p_order_id: string
          p_org_id: string
        }
        Returns: {
          agreed_total_cost: number
          approved_at: string | null
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string
          event_id: string | null
          expected_delivery_at: string | null
          id: string
          notes: string | null
          order_date: string
          order_number: string
          organization_id: string
          sent_at: string | null
          sent_by: string | null
          status: Database["public"]["Enums"]["procurement_order_status"]
          supplier_contact_name_snapshot: string | null
          supplier_id: string
          supplier_name_snapshot: string | null
          supplier_phone_snapshot: string | null
          updated_at: string
          updated_by: string
        }
        SetofOptions: {
          from: "*"
          to: "procurement_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_member_permission: {
        Args: {
          p_allowed: boolean
          p_capability: string
          p_org_id: string
          p_user_id: string
        }
        Returns: {
          allowed: boolean
          capability: string
          created_at: string
          organization_id: string
          set_by: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "org_member_permissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_quotation_pricing: {
        Args: {
          p_discount_type?: Database["public"]["Enums"]["quotation_discount_type"]
          p_discount_value?: number
          p_idempotency_key?: string
          p_org_id: string
          p_quotation_id: string
          p_surcharge_amount?: number
          p_surcharge_note?: string
          p_transport_amount?: number
          p_transport_note?: string
          p_transport_required?: boolean
          p_transport_zone?: string
          p_valid_until?: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          cancellation_reason: string | null
          converted_at: string | null
          converted_event_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          discount_amount: number
          discount_type: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value: number
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          event_type_snapshot: string
          expired_at: string | null
          expired_by: string | null
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string | null
          issued_by: string | null
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          pre_vat_total: number
          prospect_company: string | null
          prospect_whatsapp: string | null
          quotation_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          revision: number
          series_id: string | null
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          subtotal: number
          superseded_reason: string | null
          surcharge_amount: number
          surcharge_note: string | null
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          transport_amount: number
          transport_note: string | null
          transport_required: boolean
          transport_zone: string | null
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_supplier_status: {
        Args: {
          p_idempotency_key: string
          p_org_id: string
          p_status: Database["public"]["Enums"]["supplier_status"]
          p_supplier_id: string
        }
        Returns: {
          category: Database["public"]["Enums"]["supplier_category"]
          commercial_registration_number: string | null
          contact_name: string | null
          created_at: string
          created_by: string
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          status: Database["public"]["Enums"]["supplier_status"]
          updated_at: string
          updated_by: string
          whatsapp: string | null
        }
        SetofOptions: {
          from: "*"
          to: "suppliers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_treasury_opening_balance: {
        Args: {
          p_amount: number
          p_idempotency_key?: string
          p_org_id: string
          p_treasury_id: string
        }
        Returns: {
          created_at: string
          created_by: string
          entry_date: string
          entry_number: string
          event_at: string | null
          event_id: string | null
          id: string
          idempotency_key: string
          is_reversal: boolean
          memo: string | null
          organization_id: string
          request_fingerprint: string
          reversal_of: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["journal_source_type"]
        }
        SetofOptions: {
          from: "*"
          to: "journal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      settle_staff_advance: {
        Args: {
          p_advance_id?: string
          p_amount: number
          p_idempotency_key?: string
          p_org_id: string
          p_reason?: string
          p_settlement_date: string
          p_staff_member_id: string
        }
        Returns: {
          advance_id: string | null
          amount: number
          created_at: string
          id: string
          idempotency_key: string
          organization_id: string
          reason: string | null
          recorded_by: string
          request_fingerprint: string
          settlement_date: string
          staff_member_id: string
          status: Database["public"]["Enums"]["host_payment_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "staff_advance_settlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      staff_ledger_history: {
        Args: { p_org_id: string; p_staff_member_id: string }
        Returns: {
          amount: number
          effect: number
          event_id: string
          event_number: string
          kind: string
          label: string
          occurred_at: string
          status: string
          void_reason: string
        }[]
      }
      t_is_active: {
        Args: { p_id: string; p_org_id: string }
        Returns: boolean
      }
      today_attendance_gaps: {
        Args: { p_now?: string; p_org_id: string }
        Returns: {
          assignment_count: number
          attendance_count: number
          event_id: string
          event_number: string
          event_title: string
        }[]
      }
      today_closure_candidates: {
        Args: { p_now?: string; p_org_id: string }
        Returns: {
          action: string
          blockers: string[]
          event_id: string
          event_number: string
          event_title: string
          outstanding: string
          start_at: string
        }[]
      }
      today_collections: {
        Args: { p_now?: string; p_org_id: string }
        Returns: {
          customer_name: string
          event_id: string
          event_number: string
          event_title: string
          outstanding: string
          overdue: boolean
          start_at: string
        }[]
      }
      transition_event_status: {
        Args: {
          p_event_id: string
          p_org_id: string
          p_override_reason?: string
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
      treasury_account_balance: {
        Args: { p_org_id: string; p_treasury_id: string }
        Returns: {
          balance: number
          credit_total: number
          debit_total: number
          is_active: boolean
          raw_balance: number
        }[]
      }
      treasury_account_balances: {
        Args: { p_org_id: string }
        Returns: {
          balance: number
          chart_account_id: string
          credit_total: number
          debit_total: number
          id: string
          is_active: boolean
          name: string
          raw_balance: number
          treasury_type: Database["public"]["Enums"]["treasury_account_type"]
        }[]
      }
      treasury_parent_code: {
        Args: { p_type: Database["public"]["Enums"]["treasury_account_type"] }
        Returns: string
      }
      treasury_statement: {
        Args: { p_org_id: string; p_treasury_id: string }
        Returns: {
          balance: number
          credit: number
          debit: number
          entry_date: string
          entry_number: string
          memo: string
          source_type: Database["public"]["Enums"]["journal_source_type"]
        }[]
      }
      treasury_transfer: {
        Args: {
          p_amount: number
          p_from_treasury_id: string
          p_idempotency_key?: string
          p_note?: string
          p_org_id: string
          p_to_treasury_id: string
        }
        Returns: {
          created_at: string
          created_by: string
          entry_date: string
          entry_number: string
          event_at: string | null
          event_id: string | null
          id: string
          idempotency_key: string
          is_reversal: boolean
          memo: string | null
          organization_id: string
          request_fingerprint: string
          reversal_of: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["journal_source_type"]
        }
        SetofOptions: {
          from: "*"
          to: "journal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_procurement_order: {
        Args: {
          p_event_id: string
          p_expected_delivery_at: string
          p_idempotency_key: string
          p_lines: Json
          p_notes: string
          p_order_date: string
          p_order_id: string
          p_org_id: string
          p_supplier_id: string
        }
        Returns: {
          agreed_total_cost: number
          approved_at: string | null
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string
          event_id: string | null
          expected_delivery_at: string | null
          id: string
          notes: string | null
          order_date: string
          order_number: string
          organization_id: string
          sent_at: string | null
          sent_by: string | null
          status: Database["public"]["Enums"]["procurement_order_status"]
          supplier_contact_name_snapshot: string | null
          supplier_id: string
          supplier_name_snapshot: string | null
          supplier_phone_snapshot: string | null
          updated_at: string
          updated_by: string
        }
        SetofOptions: {
          from: "*"
          to: "procurement_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_quotation_draft: {
        Args: {
          p_customer_id?: string
          p_end_at?: string
          p_event_title?: string
          p_event_type?: string
          p_guest_count?: number
          p_notes?: string
          p_org_id: string
          p_prospect_company?: string
          p_prospect_name: string
          p_prospect_phone?: string
          p_prospect_whatsapp?: string
          p_quotation_id: string
          p_start_at?: string
          p_venue_name?: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          cancellation_reason: string | null
          converted_at: string | null
          converted_event_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name_snapshot: string
          customer_phone_snapshot: string | null
          discount_amount: number
          discount_type: Database["public"]["Enums"]["quotation_discount_type"]
          discount_value: number
          end_at_snapshot: string | null
          event_id: string | null
          event_number_snapshot: string | null
          event_title_snapshot: string
          event_type_snapshot: string
          expired_at: string | null
          expired_by: string | null
          guest_count_snapshot: number | null
          id: string
          idempotency_key: string
          issued_at: string | null
          issued_by: string | null
          location_snapshot: string | null
          notes: string | null
          organization_id: string
          pre_vat_total: number
          prospect_company: string | null
          prospect_whatsapp: string | null
          quotation_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          revision: number
          series_id: string | null
          start_at_snapshot: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          subtotal: number
          superseded_reason: string | null
          surcharge_amount: number
          surcharge_note: string | null
          terms: string | null
          total_expected_cost: number
          total_expected_profit: number
          total_selling: number
          transport_amount: number
          transport_note: string | null
          transport_required: boolean
          transport_zone: string | null
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          venue_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_supplier: {
        Args: {
          p_category: Database["public"]["Enums"]["supplier_category"]
          p_commercial_registration_number: string
          p_contact_name: string
          p_email: string
          p_idempotency_key: string
          p_name: string
          p_notes: string
          p_org_id: string
          p_phone: string
          p_supplier_id: string
          p_whatsapp: string
        }
        Returns: {
          category: Database["public"]["Enums"]["supplier_category"]
          commercial_registration_number: string | null
          contact_name: string | null
          created_at: string
          created_by: string
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          status: Database["public"]["Enums"]["supplier_status"]
          updated_at: string
          updated_by: string
          whatsapp: string | null
        }
        SetofOptions: {
          from: "*"
          to: "suppliers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_treasury_account: {
        Args: {
          p_account_tail?: string
          p_bank_name?: string
          p_idempotency_key?: string
          p_is_active?: boolean
          p_name?: string
          p_notes?: string
          p_org_id: string
          p_treasury_id: string
        }
        Returns: {
          account_tail: string | null
          bank_name: string | null
          chart_account_id: string
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          organization_id: string
          treasury_type: Database["public"]["Enums"]["treasury_account_type"]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "treasury_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_customer_payment: {
        Args: {
          p_idempotency_key: string
          p_org_id: string
          p_payment_id: string
          p_reason: string
        }
        Returns: {
          amount: number
          created_at: string
          event_id: string
          id: string
          idempotency_key: string
          notes: string | null
          organization_id: string
          paid_at: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string
          reference: string | null
          request_fingerprint: string
          status: Database["public"]["Enums"]["customer_payment_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customer_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_event_expense: {
        Args: {
          p_expense_id: string
          p_idempotency_key?: string
          p_org_id: string
          p_reason: string
        }
        Returns: {
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          description: string
          event_id: string
          expense_date: string
          id: string
          idempotency_key: string
          organization_id: string
          payee: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          recorded_by: string
          reference: string | null
          request_fingerprint: string
          status: Database["public"]["Enums"]["customer_payment_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "event_expenses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_host_payout: {
        Args: {
          p_idempotency_key: string
          p_org_id: string
          p_payout_id: string
          p_reason: string
        }
        Returns: {
          amount: number
          created_at: string
          event_id: string | null
          id: string
          idempotency_key: string
          organization_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payout_date: string
          reason: string | null
          recorded_by: string
          reference: string | null
          request_fingerprint: string
          staff_member_id: string
          status: Database["public"]["Enums"]["host_payment_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "host_payouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_invoice: {
        Args: {
          p_idempotency_key: string
          p_invoice_id: string
          p_org_id: string
          p_reason: string
        }
        Returns: {
          created_at: string
          created_by: string
          currency: string
          due_at: string | null
          event_id: string
          id: string
          invoice_number: string
          issued_at: string
          note: string | null
          organization_id: string
          pre_vat_total: number
          quotation_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          total_amount: number
          vat_amount: number
          vat_percent: number
          vat_registered: boolean
          vat_registration_number: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_staff_advance: {
        Args: {
          p_advance_id: string
          p_idempotency_key: string
          p_org_id: string
          p_reason: string
        }
        Returns: {
          advance_date: string
          amount: number
          created_at: string
          id: string
          idempotency_key: string
          organization_id: string
          reason: string | null
          recorded_by: string
          request_fingerprint: string
          staff_member_id: string
          status: Database["public"]["Enums"]["host_payment_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "staff_advances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_staff_advance_settlement: {
        Args: {
          p_idempotency_key?: string
          p_org_id: string
          p_reason: string
          p_settlement_id: string
        }
        Returns: {
          advance_id: string | null
          amount: number
          created_at: string
          id: string
          idempotency_key: string
          organization_id: string
          reason: string | null
          recorded_by: string
          request_fingerprint: string
          settlement_date: string
          staff_member_id: string
          status: Database["public"]["Enums"]["host_payment_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "staff_advance_settlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_staff_attendance: {
        Args: {
          p_attendance_id: string
          p_idempotency_key: string
          p_org_id: string
          p_reason: string
        }
        Returns: {
          assignment_id: string | null
          attendance_date: string
          break_minutes: number
          check_in: string | null
          check_in_method: Database["public"]["Enums"]["attendance_method"]
          check_out: string | null
          check_out_method: Database["public"]["Enums"]["attendance_method"]
          confirmed_by: string | null
          created_at: string
          earned_amount: number
          event_id: string
          hours_worked: number
          id: string
          idempotency_key: string
          match_attempt_id: string | null
          notes: string | null
          organization_id: string
          recorded_by: string
          request_fingerprint: string
          shift: Database["public"]["Enums"]["staff_shift"]
          staff_member_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          wage_method: Database["public"]["Enums"]["compensation_method"]
          wage_rate: number
        }
        SetofOptions: {
          from: "*"
          to: "staff_attendance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_supplier_invoice: {
        Args: {
          p_idempotency_key?: string
          p_invoice_id: string
          p_org_id: string
          p_reason: string
        }
        Returns: {
          amount: number
          created_at: string
          due_date: string | null
          event_id: string | null
          id: string
          idempotency_key: string
          invoice_date: string
          invoice_number: string
          notes: string | null
          order_id: string
          organization_id: string
          override_reason: string | null
          owner_override: boolean
          recorded_by: string
          request_fingerprint: string
          status: Database["public"]["Enums"]["customer_payment_status"]
          supplier_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "supplier_invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_supplier_payment: {
        Args: {
          p_idempotency_key?: string
          p_org_id: string
          p_payment_id: string
          p_reason: string
        }
        Returns: {
          amount: number
          created_at: string
          id: string
          idempotency_key: string
          organization_id: string
          payment_date: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          reason: string | null
          recorded_by: string
          reference: string | null
          request_fingerprint: string
          status: Database["public"]["Enums"]["customer_payment_status"]
          supplier_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "supplier_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      warehouse_fingerprint: { Args: { p_payload: Json }; Returns: string }
      warehouse_reservation_state: {
        Args: { p_org_id: string; p_reservation_id: string }
        Returns: {
          damaged_quantity: number
          dispatched_quantity: number
          lost_quantity: number
          outstanding_quantity: number
          reserved_quantity: number
          returned_good_quantity: number
        }[]
      }
      waste_consumable_at_event: {
        Args: {
          p_event_id: string
          p_idempotency_key: string
          p_org_id: string
          p_quantity: number
          p_reason: string
          p_stock_item_id: string
        }
        Returns: {
          actor_id: string
          created_at: string
          event_delta: number
          event_id: string | null
          id: string
          idempotency_key: string
          movement_kind: Database["public"]["Enums"]["consumable_movement_kind"]
          organization_id: string
          quantity: number
          reason: string | null
          reference: string | null
          request_fingerprint: string
          stock_item_id: string
          warehouse_delta: number
        }
        SetofOptions: {
          from: "*"
          to: "consumable_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      waste_consumable_stock: {
        Args: {
          p_idempotency_key: string
          p_org_id: string
          p_quantity: number
          p_reason: string
          p_stock_item_id: string
        }
        Returns: {
          actor_id: string
          created_at: string
          event_delta: number
          event_id: string | null
          id: string
          idempotency_key: string
          movement_kind: Database["public"]["Enums"]["consumable_movement_kind"]
          organization_id: string
          quantity: number
          reason: string | null
          reference: string | null
          request_fingerprint: string
          stock_item_id: string
          warehouse_delta: number
        }
        SetofOptions: {
          from: "*"
          to: "consumable_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      account_type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE"
      app_role: "OWNER" | "MANAGER" | "SUPERVISOR" | "WAREHOUSE" | "ACCOUNTANT"
      assignment_status: "ACTIVE" | "RELEASED" | "CANCELLED"
      attachment_evidence_type:
        | "STAFF_ID"
        | "STAFF_CONTRACT"
        | "ATTENDANCE_CHECKIN"
        | "ATTENDANCE_CHECKOUT"
        | "HOST_PAYOUT_RECEIPT"
        | "EXPENSE_RECEIPT"
        | "DELIVERY_PROOF"
        | "RETURN_PROOF"
        | "EQUIPMENT_DAMAGE"
      attendance_method: "MANUAL" | "FACE_ASSISTED"
      attendance_status: "PRESENT" | "LATE" | "PARTIAL" | "ABSENT" | "VOIDED"
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
      consumable_movement_kind:
        | "RECEIVE"
        | "ISSUE_TO_EVENT"
        | "RETURN_FROM_EVENT"
        | "CONSUME_AT_EVENT"
        | "WASTE_AT_EVENT"
        | "WAREHOUSE_WASTE"
        | "ADJUSTMENT"
      customer_payment_status: "RECORDED" | "VOIDED"
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
      expense_category:
        | "TRANSPORT"
        | "FUEL"
        | "RENTAL"
        | "THIRD_PARTY"
        | "CONSUMABLE"
        | "DAMAGE_LOSS"
        | "OTHER"
      face_enrollment_status: "ACTIVE" | "REVOKED"
      face_match_status: "MATCHED" | "CONSUMED" | "REJECTED" | "EXPIRED"
      host_payment_status: "RECORDED" | "VOIDED"
      installment_status: "PENDING" | "PAID" | "CANCELLED"
      invoice_installment_kind: "DEPOSIT" | "INSTALLMENT" | "FINAL"
      invoice_status: "ISSUED" | "CANCELLED"
      journal_source_type:
        | "OPENING_BALANCE"
        | "CUSTOMER_PAYMENT"
        | "CUSTOMER_PAYMENT_VOID"
        | "CUSTOMER_DEPOSIT_APPLIED"
        | "CUSTOMER_DEPOSIT_RELEASED"
        | "INVOICE"
        | "INVOICE_VOID"
        | "REVENUE_RECOGNITION"
        | "UNBILLED_RECOGNITION"
        | "CONTRACT_ASSET_RECLASSIFICATION"
        | "REVENUE_REVERSAL"
        | "EVENT_EXPENSE"
        | "EVENT_EXPENSE_VOID"
        | "HOST_EARNING"
        | "HOST_EARNING_VOID"
        | "HOST_PAYOUT"
        | "HOST_PAYOUT_VOID"
        | "STAFF_ADVANCE"
        | "STAFF_ADVANCE_VOID"
        | "STAFF_ADVANCE_SETTLEMENT"
        | "STAFF_RECEIVABLE_RECOGNITION"
        | "SUPPLIER_INVOICE"
        | "SUPPLIER_INVOICE_VOID"
        | "SUPPLIER_PAYMENT"
        | "SUPPLIER_PAYMENT_VOID"
        | "TREASURY_TRANSFER"
        | "JOURNAL_REVERSAL"
        | "ADJUSTMENT"
      membership_status: "ACTIVE" | "INACTIVE" | "INVITED"
      normal_balance: "DEBIT" | "CREDIT"
      package_status: "ACTIVE" | "INACTIVE"
      payment_method:
        | "CASH"
        | "BANK_TRANSFER"
        | "CARD"
        | "CHEQUE"
        | "MOBILE_WALLET"
        | "OTHER"
      pricing_method:
        | "FIXED"
        | "PER_EVENT"
        | "PER_GUEST"
        | "PER_UNIT"
        | "PER_HOUR"
        | "PER_DAY"
        | "MANUAL"
      procurement_line_kind: "CONSUMABLE" | "CATERING_SERVICE" | "OTHER"
      procurement_order_status:
        | "DRAFT"
        | "APPROVED"
        | "SENT"
        | "CONFIRMED"
        | "PARTIALLY_RECEIVED"
        | "RECEIVED"
        | "CANCELLED"
      quotation_discount_type: "NONE" | "FIXED" | "PERCENT"
      quotation_status:
        | "DRAFT"
        | "ISSUED"
        | "EXPIRED"
        | "ACCEPTED"
        | "REJECTED"
        | "CONVERTED"
        | "CANCELLED"
        | "SUPERSEDED"
      reservation_status: "ACTIVE" | "RELEASED" | "CANCELLED"
      staff_shift: "MORNING" | "EVENING"
      staff_type:
        | "HOST"
        | "HOSTESS"
        | "SUPERVISOR"
        | "DRIVER"
        | "WAREHOUSE"
        | "OTHER"
      supplier_category:
        | "CATERING_RESTAURANT"
        | "CONSUMABLES"
        | "EQUIPMENT_RENTAL"
        | "GENERAL"
      supplier_status: "ACTIVE" | "INACTIVE"
      treasury_account_type: "CASH" | "BANK" | "OTHER"
      warehouse_movement_kind: "DISPATCH" | "RETURN"
      warehouse_valuation_basis: "CATALOG_COST_SNAPSHOT"
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
    Enums: {
      account_type: ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"],
      app_role: ["OWNER", "MANAGER", "SUPERVISOR", "WAREHOUSE", "ACCOUNTANT"],
      assignment_status: ["ACTIVE", "RELEASED", "CANCELLED"],
      attachment_evidence_type: [
        "STAFF_ID",
        "STAFF_CONTRACT",
        "ATTENDANCE_CHECKIN",
        "ATTENDANCE_CHECKOUT",
        "HOST_PAYOUT_RECEIPT",
        "EXPENSE_RECEIPT",
        "DELIVERY_PROOF",
        "RETURN_PROOF",
        "EQUIPMENT_DAMAGE",
      ],
      attendance_method: ["MANUAL", "FACE_ASSISTED"],
      attendance_status: ["PRESENT", "LATE", "PARTIAL", "ABSENT", "VOIDED"],
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
      consumable_movement_kind: [
        "RECEIVE",
        "ISSUE_TO_EVENT",
        "RETURN_FROM_EVENT",
        "CONSUME_AT_EVENT",
        "WASTE_AT_EVENT",
        "WAREHOUSE_WASTE",
        "ADJUSTMENT",
      ],
      customer_payment_status: ["RECORDED", "VOIDED"],
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
      expense_category: [
        "TRANSPORT",
        "FUEL",
        "RENTAL",
        "THIRD_PARTY",
        "CONSUMABLE",
        "DAMAGE_LOSS",
        "OTHER",
      ],
      face_enrollment_status: ["ACTIVE", "REVOKED"],
      face_match_status: ["MATCHED", "CONSUMED", "REJECTED", "EXPIRED"],
      host_payment_status: ["RECORDED", "VOIDED"],
      installment_status: ["PENDING", "PAID", "CANCELLED"],
      invoice_installment_kind: ["DEPOSIT", "INSTALLMENT", "FINAL"],
      invoice_status: ["ISSUED", "CANCELLED"],
      journal_source_type: [
        "OPENING_BALANCE",
        "CUSTOMER_PAYMENT",
        "CUSTOMER_PAYMENT_VOID",
        "CUSTOMER_DEPOSIT_APPLIED",
        "CUSTOMER_DEPOSIT_RELEASED",
        "INVOICE",
        "INVOICE_VOID",
        "REVENUE_RECOGNITION",
        "UNBILLED_RECOGNITION",
        "CONTRACT_ASSET_RECLASSIFICATION",
        "REVENUE_REVERSAL",
        "EVENT_EXPENSE",
        "EVENT_EXPENSE_VOID",
        "HOST_EARNING",
        "HOST_EARNING_VOID",
        "HOST_PAYOUT",
        "HOST_PAYOUT_VOID",
        "STAFF_ADVANCE",
        "STAFF_ADVANCE_VOID",
        "STAFF_ADVANCE_SETTLEMENT",
        "STAFF_RECEIVABLE_RECOGNITION",
        "SUPPLIER_INVOICE",
        "SUPPLIER_INVOICE_VOID",
        "SUPPLIER_PAYMENT",
        "SUPPLIER_PAYMENT_VOID",
        "TREASURY_TRANSFER",
        "JOURNAL_REVERSAL",
        "ADJUSTMENT",
      ],
      membership_status: ["ACTIVE", "INACTIVE", "INVITED"],
      normal_balance: ["DEBIT", "CREDIT"],
      package_status: ["ACTIVE", "INACTIVE"],
      payment_method: [
        "CASH",
        "BANK_TRANSFER",
        "CARD",
        "CHEQUE",
        "MOBILE_WALLET",
        "OTHER",
      ],
      pricing_method: [
        "FIXED",
        "PER_EVENT",
        "PER_GUEST",
        "PER_UNIT",
        "PER_HOUR",
        "PER_DAY",
        "MANUAL",
      ],
      procurement_line_kind: ["CONSUMABLE", "CATERING_SERVICE", "OTHER"],
      procurement_order_status: [
        "DRAFT",
        "APPROVED",
        "SENT",
        "CONFIRMED",
        "PARTIALLY_RECEIVED",
        "RECEIVED",
        "CANCELLED",
      ],
      quotation_discount_type: ["NONE", "FIXED", "PERCENT"],
      quotation_status: [
        "DRAFT",
        "ISSUED",
        "EXPIRED",
        "ACCEPTED",
        "REJECTED",
        "CONVERTED",
        "CANCELLED",
        "SUPERSEDED",
      ],
      reservation_status: ["ACTIVE", "RELEASED", "CANCELLED"],
      staff_shift: ["MORNING", "EVENING"],
      staff_type: [
        "HOST",
        "HOSTESS",
        "SUPERVISOR",
        "DRIVER",
        "WAREHOUSE",
        "OTHER",
      ],
      supplier_category: [
        "CATERING_RESTAURANT",
        "CONSUMABLES",
        "EQUIPMENT_RENTAL",
        "GENERAL",
      ],
      supplier_status: ["ACTIVE", "INACTIVE"],
      treasury_account_type: ["CASH", "BANK", "OTHER"],
      warehouse_movement_kind: ["DISPATCH", "RETURN"],
      warehouse_valuation_basis: ["CATALOG_COST_SNAPSHOT"],
    },
  },
} as const

