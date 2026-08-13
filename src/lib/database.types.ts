/**
 * Supabase database types.
 *
 * NOTE: The authoritative source is the database schema (supabase/migrations).
 * Regenerate with `npm run db:types` when the schema changes:
 *
 *   supabase gen types typescript --local > src/lib/database.types.ts
 *
 * This checked-in copy is hand-maintained to match supabase/migrations so the
 * project typechecks without a running Supabase CLI. Keep it in sync.
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
      organizations: {
        Row: {
          id: string;
          name: string;
          display_name: string | null;
          default_currency: string;
          timezone: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          display_name?: string | null;
          default_currency?: string;
          timezone?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          display_name?: string | null;
          default_currency?: string;
          timezone?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      organization_memberships: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: AppRole;
          status: MembershipStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          role?: AppRole;
          status?: MembershipStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          user_id?: string;
          role?: AppRole;
          status?: MembershipStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          phone: string | null;
          whatsapp: string | null;
          customer_type: CustomerType;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          phone?: string | null;
          whatsapp?: string | null;
          customer_type?: CustomerType;
          notes?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          phone?: string | null;
          whatsapp?: string | null;
          customer_type?: CustomerType;
          notes?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      catalog_categories: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          name_en: string | null;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          name_en?: string | null;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          name_en?: string | null;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      catalog_items: {
        Row: {
          id: string;
          organization_id: string;
          category_id: string | null;
          code: string | null;
          name: string;
          name_en: string | null;
          description: string | null;
          item_type: CatalogItemType;
          unit: string;
          pricing_method: PricingMethod;
          cost_price: string;
          selling_price: string;
          status: CatalogItemStatus;
          sort_order: number;
          internal_notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          category_id?: string | null;
          code?: string | null;
          name: string;
          name_en?: string | null;
          description?: string | null;
          item_type?: CatalogItemType;
          unit?: string;
          pricing_method?: PricingMethod;
          cost_price?: string;
          selling_price?: string;
          status?: CatalogItemStatus;
          sort_order?: number;
          internal_notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          category_id?: string | null;
          code?: string | null;
          name?: string;
          name_en?: string | null;
          description?: string | null;
          item_type?: CatalogItemType;
          unit?: string;
          pricing_method?: PricingMethod;
          cost_price?: string;
          selling_price?: string;
          status?: CatalogItemStatus;
          sort_order?: number;
          internal_notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "catalog_items_category_id_fkey";
            columns: ["category_id"];
            referencedRelation: "catalog_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      packages: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          name_en: string | null;
          description: string | null;
          status: PackageStatus;
          base_guest_count: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          name_en?: string | null;
          description?: string | null;
          status?: PackageStatus;
          base_guest_count?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          name_en?: string | null;
          description?: string | null;
          status?: PackageStatus;
          base_guest_count?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      package_items: {
        Row: {
          id: string;
          organization_id: string;
          package_id: string;
          catalog_item_id: string;
          quantity: string;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          package_id: string;
          catalog_item_id: string;
          quantity?: string;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          package_id?: string;
          catalog_item_id?: string;
          quantity?: string;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "package_items_package_id_fkey";
            columns: ["package_id"];
            referencedRelation: "packages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "package_items_catalog_item_id_fkey";
            columns: ["catalog_item_id"];
            referencedRelation: "catalog_items";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_events: {
        Row: {
          id: number;
          organization_id: string;
          user_id: string | null;
          action: string;
          entity: string;
          entity_id: string | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: never;
          organization_id: string;
          user_id?: string | null;
          action: string;
          entity: string;
          entity_id?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: never;
          organization_id?: string;
          user_id?: string | null;
          action?: string;
          entity?: string;
          entity_id?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      is_org_member: {
        Args: { p_org_id: string };
        Returns: boolean;
      };
      has_org_role: {
        Args: { p_org_id: string; p_roles: AppRole[] };
        Returns: boolean;
      };
      can_manage_commercial: {
        Args: { p_org_id: string };
        Returns: boolean;
      };
      create_organization: {
        Args: { p_name: string; p_display_name?: string };
        Returns: string;
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
      membership_status: MembershipStatus;
      catalog_item_type: CatalogItemType;
      pricing_method: PricingMethod;
      catalog_item_status: CatalogItemStatus;
      package_status: PackageStatus;
      customer_type: CustomerType;
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

export type MembershipStatus = "ACTIVE" | "INACTIVE" | "INVITED";

export type CatalogItemType =
  | "SERVICE"
  | "REUSABLE_EQUIPMENT"
  | "CONSUMABLE"
  | "STAFF"
  | "CATERING"
  | "TRANSPORT"
  | "ADDON"
  | "OTHER";

export type PricingMethod =
  | "FIXED"
  | "PER_EVENT"
  | "PER_GUEST"
  | "PER_UNIT"
  | "PER_HOUR"
  | "PER_DAY"
  | "MANUAL";

export type CatalogItemStatus = "ACTIVE" | "INACTIVE";

export type PackageStatus = "ACTIVE" | "INACTIVE";

export type CustomerType = "INDIVIDUAL" | "COMPANY" | "GOVERNMENT";

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
