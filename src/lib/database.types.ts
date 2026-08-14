/**
 * Supabase database types.
 *
 * The AUTHORITATIVE source is the database schema (supabase/migrations).
 * CI regenerates this file with:
 *
 *   supabase gen types typescript --local --schema public
 *
 * and fails if it drifts from this committed copy (see .github/workflows/ci.yml).
 *
 * Monetary columns (cost_price, selling_price, quantity) are `string` because
 * PostgREST serializes PostgreSQL `numeric` as a string to preserve precision.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string;
          created_at: string;
          entity: string;
          entity_id: string | null;
          id: number;
          metadata: Json | null;
          organization_id: string;
          user_id: string | null;
        };
        Insert: {
          action: string;
          created_at?: string;
          entity: string;
          entity_id?: string | null;
          id?: never;
          metadata?: Json | null;
          organization_id: string;
          user_id?: string | null;
        };
        Update: {
          action?: string;
          created_at?: string;
          entity?: string;
          entity_id?: string | null;
          id?: never;
          metadata?: Json | null;
          organization_id?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      catalog_categories: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          name_en: string | null;
          organization_id: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          name_en?: string | null;
          organization_id: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          name_en?: string | null;
          organization_id?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      catalog_items: {
        Row: {
          category_id: string | null;
          code: string | null;
          cost_price: string;
          created_at: string;
          description: string | null;
          id: string;
          internal_notes: string | null;
          item_type: CatalogItemType;
          name: string;
          name_en: string | null;
          organization_id: string;
          pricing_method: PricingMethod;
          selling_price: string;
          sort_order: number;
          status: CatalogItemStatus;
          unit: string;
          updated_at: string;
        };
        Insert: {
          category_id?: string | null;
          code?: string | null;
          cost_price?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          internal_notes?: string | null;
          item_type?: CatalogItemType;
          name: string;
          name_en?: string | null;
          organization_id: string;
          pricing_method?: PricingMethod;
          selling_price?: string;
          sort_order?: number;
          status?: CatalogItemStatus;
          unit?: string;
          updated_at?: string;
        };
        Update: {
          category_id?: string | null;
          code?: string | null;
          cost_price?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          internal_notes?: string | null;
          item_type?: CatalogItemType;
          name?: string;
          name_en?: string | null;
          organization_id?: string;
          pricing_method?: PricingMethod;
          selling_price?: string;
          sort_order?: number;
          status?: CatalogItemStatus;
          unit?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "catalog_items_org_category_fk";
            columns: ["organization_id", "category_id"];
            isOneToOne: false;
            referencedRelation: "catalog_categories";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      customers: {
        Row: {
          created_at: string;
          customer_type: CustomerType;
          id: string;
          is_active: boolean;
          name: string;
          notes: string | null;
          organization_id: string;
          phone: string | null;
          updated_at: string;
          whatsapp: string | null;
        };
        Insert: {
          created_at?: string;
          customer_type?: CustomerType;
          id?: string;
          is_active?: boolean;
          name: string;
          notes?: string | null;
          organization_id: string;
          phone?: string | null;
          updated_at?: string;
          whatsapp?: string | null;
        };
        Update: {
          created_at?: string;
          customer_type?: CustomerType;
          id?: string;
          is_active?: boolean;
          name?: string;
          notes?: string | null;
          organization_id?: string;
          phone?: string | null;
          updated_at?: string;
          whatsapp?: string | null;
        };
        Relationships: [];
      };
      organization_memberships: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string;
          role: AppRole;
          status: MembershipStatus;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          organization_id: string;
          role?: AppRole;
          status?: MembershipStatus;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          role?: AppRole;
          status?: MembershipStatus;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      organizations: {
        Row: {
          created_at: string;
          default_currency: string;
          display_name: string | null;
          id: string;
          is_active: boolean;
          name: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          default_currency?: string;
          display_name?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          default_currency?: string;
          display_name?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      package_items: {
        Row: {
          catalog_item_id: string;
          created_at: string;
          id: string;
          organization_id: string;
          package_id: string;
          quantity: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          catalog_item_id: string;
          created_at?: string;
          id?: string;
          organization_id: string;
          package_id: string;
          quantity?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          catalog_item_id?: string;
          created_at?: string;
          id?: string;
          organization_id?: string;
          package_id?: string;
          quantity?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      packages: {
        Row: {
          base_guest_count: number | null;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          name_en: string | null;
          organization_id: string;
          status: PackageStatus;
          updated_at: string;
        };
        Insert: {
          base_guest_count?: number | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          name_en?: string | null;
          organization_id: string;
          status?: PackageStatus;
          updated_at?: string;
        };
        Update: {
          base_guest_count?: number | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          name_en?: string | null;
          organization_id?: string;
          status?: PackageStatus;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          full_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          full_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          full_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      catalog_items_operational: {
        Row: {
          category_id: string | null;
          code: string | null;
          created_at: string;
          description: string | null;
          id: string;
          item_type: CatalogItemType;
          name: string;
          name_en: string | null;
          organization_id: string;
          pricing_method: PricingMethod;
          selling_price: string;
          sort_order: number;
          status: CatalogItemStatus;
          unit: string;
          updated_at: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      can_manage_commercial: {
        Args: { p_org_id: string };
        Returns: boolean;
      };
      can_read_cost: {
        Args: { p_org_id: string };
        Returns: boolean;
      };
      create_organization: {
        Args: { p_name: string; p_display_name?: string };
        Returns: string;
      };
      has_org_role: {
        Args: { p_org_id: string; p_roles: AppRole[] };
        Returns: boolean;
      };
      is_org_member: {
        Args: { p_org_id: string };
        Returns: boolean;
      };
      record_audit: {
        Args: {
          p_org_id: string;
          p_action: string;
          p_entity: string;
          p_entity_id?: string;
          p_metadata?: Json;
        };
        Returns: undefined;
      };
      save_package: {
        Args: {
          p_org_id: string;
          p_package_id: string | null;
          p_name: string;
          p_name_en?: string | null;
          p_description?: string | null;
          p_status?: PackageStatus;
          p_base_guest_count?: number | null;
          p_items?: Json;
        };
        Returns: string;
      };
    };
    Enums: {
      app_role: AppRole;
      catalog_item_status: CatalogItemStatus;
      catalog_item_type: CatalogItemType;
      customer_type: CustomerType;
      membership_status: MembershipStatus;
      package_status: PackageStatus;
      pricing_method: PricingMethod;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type AppRole =
  | "OWNER"
  | "MANAGER"
  | "SUPERVISOR"
  | "WAREHOUSE"
  | "ACCOUNTANT";

export type CatalogItemStatus = "ACTIVE" | "INACTIVE";

export type CatalogItemType =
  | "SERVICE"
  | "REUSABLE_EQUIPMENT"
  | "CONSUMABLE"
  | "STAFF"
  | "CATERING"
  | "TRANSPORT"
  | "ADDON"
  | "OTHER";

export type CustomerType = "INDIVIDUAL" | "COMPANY" | "GOVERNMENT";

export type MembershipStatus = "ACTIVE" | "INACTIVE" | "INVITED";

export type PackageStatus = "ACTIVE" | "INACTIVE";

export type PricingMethod =
  | "FIXED"
  | "PER_EVENT"
  | "PER_GUEST"
  | "PER_UNIT"
  | "PER_HOUR"
  | "PER_DAY"
  | "MANUAL";

export type OrganizationRow = Database["public"]["Tables"]["organizations"]["Row"];
export type MembershipRow =
  Database["public"]["Tables"]["organization_memberships"]["Row"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];
export type CatalogCategoryRow =
  Database["public"]["Tables"]["catalog_categories"]["Row"];
export type CatalogItemRow = Database["public"]["Tables"]["catalog_items"]["Row"];
export type CatalogItemInsert = Database["public"]["Tables"]["catalog_items"]["Insert"];
export type CatalogItemUpdate = Database["public"]["Tables"]["catalog_items"]["Update"];
export type PackageRow = Database["public"]["Tables"]["packages"]["Row"];
export type PackageInsert = Database["public"]["Tables"]["packages"]["Insert"];
export type PackageItemRow = Database["public"]["Tables"]["package_items"]["Row"];
