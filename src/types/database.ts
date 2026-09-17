/**
 * Supabase 데이터베이스 타입.
 *
 * 지금은 `supabase/migrations/*.sql`을 보고 손으로 맞춘 타입이다 — 아직 실제
 * Supabase 프로젝트가 연결되지 않아 `supabase gen types typescript`를 돌릴 수
 * 없기 때문이다 (모든 --local/--linked/--db-url/--project-id 옵션이 살아있는
 * DB 연결을 요구한다). DEV 프로젝트가 연결되면 아래 명령으로 교체한다:
 *
 *   npx supabase gen types typescript --linked > src/types/database.ts
 *
 * 그 전까지는 migration 파일을 수정할 때 이 파일도 함께 업데이트해야 한다.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "ADMIN" | "STORE_MANAGER" | "STAFF";

export type NoticeType =
  | "일반"
  | "중요"
  | "긴급"
  | "필독"
  | "행사"
  | "발주"
  | "판매가변경"
  | "공급가변경"
  | "운영"
  | "시스템"
  | "교육"; // Phase 9 SKIP(2026-09-17) — 교육자료를 Notice로 흡수하며 추가(20260917200000)

export type NoticeTargetType = "all" | "store" | "role" | "user";

export type PromotionType = "permanent" | "event";
export type ChangeImportance = "critical" | "important" | "minor";
export type PromotionChangeType =
  | "new_product"
  | "price"
  | "promotion"
  | "benefit"
  | "gift"
  | "event_period"
  | "store_operation"
  | "configuration"
  | "minor_edit";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string;
          email: string;
          role: UserRole;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          name: string;
          email: string;
          role?: UserRole;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          email?: string;
          role?: UserRole;
          is_active?: boolean;
        };
        Relationships: [];
      };
      stores: {
        Row: {
          id: string;
          name: string;
          code: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          code: string;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          code?: string;
          is_active?: boolean;
        };
        Relationships: [];
      };
      user_store_access: {
        Row: {
          id: string;
          user_id: string;
          store_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          store_id: string;
        };
        Update: {
          user_id?: string;
          store_id?: string;
        };
        Relationships: [];
      };
      notices: {
        Row: {
          id: string;
          title: string;
          body: string;
          notice_type: NoticeType;
          author_id: string | null;
          /** 작성 시점 이름 스냅샷(20260917100200) — STAFF는 profiles RLS상 작성자 프로필을 직접 못 읽는다. */
          author_name: string | null;
          is_pinned: boolean;
          requires_confirmation: boolean;
          published_at: string;
          expires_at: string | null;
          /** Phase 8에서 추가(20260917100000) — 품절 재입고 안내 폼 등 외부 링크. */
          external_link: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          body: string;
          notice_type?: NoticeType;
          author_id?: string | null;
          author_name?: string | null;
          is_pinned?: boolean;
          requires_confirmation?: boolean;
          published_at?: string;
          expires_at?: string | null;
          external_link?: string | null;
        };
        Update: {
          title?: string;
          body?: string;
          notice_type?: NoticeType;
          is_pinned?: boolean;
          requires_confirmation?: boolean;
          published_at?: string;
          expires_at?: string | null;
          external_link?: string | null;
        };
        Relationships: [];
      };
      notice_targets: {
        Row: {
          id: string;
          notice_id: string;
          target_type: NoticeTargetType;
          store_id: string | null;
          role: UserRole | null;
          user_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          notice_id: string;
          target_type: NoticeTargetType;
          store_id?: string | null;
          role?: UserRole | null;
          user_id?: string | null;
        };
        Update: {
          target_type?: NoticeTargetType;
          store_id?: string | null;
          role?: UserRole | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      notice_reads: {
        Row: {
          notice_id: string;
          user_id: string;
          read_at: string;
          confirmed_at: string | null;
        };
        Insert: {
          notice_id: string;
          user_id: string;
          read_at?: string;
          confirmed_at?: string | null;
        };
        Update: {
          confirmed_at?: string | null;
        };
        Relationships: [];
      };
      attachments: {
        Row: {
          id: string;
          owner_type: "notice" | "training" | "profile";
          owner_id: string;
          storage_path: string;
          mime_type: string | null;
          size_bytes: number | null;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_type: "notice" | "training" | "profile";
          owner_id: string;
          storage_path: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          uploaded_by?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      promotions: {
        Row: {
          id: string;
          product_id: string;
          legacy_softr_record_id: string | null;
          promotion_type: PromotionType;
          brand: string;
          product_name: string;
          color: string[];
          period_label: string | null;
          notice_type: string | null;
          consumer_price: number | null;
          base_sale_price: number | null;
          final_price_card: number | null;
          final_price_cash: number | null;
          store_operation_note: string | null;
          default_components: string | null;
          gift: string | null;
          photo_review_benefit: string | null;
          store_promotion_allowed: string | null;
          remarks: string | null;
          extra_fields: Record<string, Json>;
          is_active: boolean;
          is_initial_import: boolean;
          last_important_change_at: string | null;
          source_row_updated_at: string | null;
          /**
           * `color`를 공백으로 join한 값 — trigger(`promotions_set_color_text`)가
           * 자동 계산한다(20260916100000 migration). 통합검색에서 컬러 부분일치(ilike)
           * 검색용으로만 쓰고, Insert/Update로 직접 쓸 수 없다(Sync 엔진도 모르는 컬럼).
           */
          color_text: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          legacy_softr_record_id?: string | null;
          promotion_type: PromotionType;
          brand: string;
          product_name: string;
          color?: string[];
          period_label?: string | null;
          notice_type?: string | null;
          consumer_price?: number | null;
          base_sale_price?: number | null;
          final_price_card?: number | null;
          final_price_cash?: number | null;
          store_operation_note?: string | null;
          default_components?: string | null;
          gift?: string | null;
          photo_review_benefit?: string | null;
          store_promotion_allowed?: string | null;
          remarks?: string | null;
          extra_fields?: Record<string, Json>;
          is_active?: boolean;
          is_initial_import?: boolean;
          last_important_change_at?: string | null;
          source_row_updated_at?: string | null;
        };
        Update: {
          legacy_softr_record_id?: string | null;
          brand?: string;
          product_name?: string;
          color?: string[];
          period_label?: string | null;
          notice_type?: string | null;
          consumer_price?: number | null;
          base_sale_price?: number | null;
          final_price_card?: number | null;
          final_price_cash?: number | null;
          store_operation_note?: string | null;
          default_components?: string | null;
          gift?: string | null;
          photo_review_benefit?: string | null;
          store_promotion_allowed?: string | null;
          remarks?: string | null;
          extra_fields?: Record<string, Json>;
          is_active?: boolean;
          last_important_change_at?: string | null;
          source_row_updated_at?: string | null;
        };
        Relationships: [];
      };
      promotion_field_definitions: {
        Row: {
          id: string;
          field_key: string;
          is_core: boolean;
          source_sheet: PromotionType | null;
          source_column_name: string | null;
          display_label: string;
          display_order: number;
          data_type: string;
          is_visible: boolean;
          is_searchable: boolean;
          is_filterable: boolean;
          change_importance: ChangeImportance;
          push_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          field_key: string;
          is_core?: boolean;
          source_sheet?: PromotionType | null;
          source_column_name?: string | null;
          display_label: string;
          display_order?: number;
          data_type?: string;
          is_visible?: boolean;
          is_searchable?: boolean;
          is_filterable?: boolean;
          change_importance?: ChangeImportance;
          push_enabled?: boolean;
        };
        Update: {
          display_label?: string;
          display_order?: number;
          data_type?: string;
          is_visible?: boolean;
          is_searchable?: boolean;
          is_filterable?: boolean;
          change_importance?: ChangeImportance;
          push_enabled?: boolean;
        };
        Relationships: [];
      };
      promotion_change_logs: {
        Row: {
          id: string;
          promotion_id: string;
          product_id: string;
          changed_field: string;
          before_value: Json | null;
          after_value: Json | null;
          change_type: PromotionChangeType;
          importance: ChangeImportance;
          source_sheet: PromotionType;
          push_eligible: boolean;
          changed_at: string;
        };
        Insert: {
          id?: string;
          promotion_id: string;
          product_id: string;
          changed_field: string;
          before_value?: Json | null;
          after_value?: Json | null;
          change_type: PromotionChangeType;
          importance: ChangeImportance;
          source_sheet: PromotionType;
          push_eligible?: boolean;
          changed_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      event_campaigns: {
        Row: {
          id: string;
          campaign_name: string;
          campaign_key: string;
          start_at: string | null;
          end_at: string | null;
          is_visible: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          campaign_name: string;
          campaign_key: string;
          start_at?: string | null;
          end_at?: string | null;
          is_visible?: boolean;
        };
        Update: {
          campaign_name?: string;
          start_at?: string | null;
          end_at?: string | null;
          is_visible?: boolean;
        };
        Relationships: [];
      };
      event_campaign_products: {
        Row: {
          id: string;
          campaign_id: string;
          promotion_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          promotion_id: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      sync_logs: {
        Row: {
          id: string;
          source_sheet: PromotionType;
          started_at: string;
          finished_at: string | null;
          success: boolean | null;
          inserted_count: number;
          updated_count: number;
          deactivated_count: number;
          failed_count: number;
          error_detail: Json | null;
          // 2026-09-15 이전 Row는 당시 기록되지 않아 NULL이다(추측으로 채우지 않음).
          sync_mode: "full_snapshot" | "partial" | null;
          received_row_count: number | null;
          // 2026-09-16 이전 Row는 당시 기록되지 않아 NULL이다(추측으로 채우지 않음).
          skipped_count: number | null;
          skipped_detail: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          source_sheet: PromotionType;
          started_at?: string;
          finished_at?: string | null;
          success?: boolean | null;
          inserted_count?: number;
          updated_count?: number;
          deactivated_count?: number;
          failed_count?: number;
          error_detail?: Json | null;
          sync_mode?: "full_snapshot" | "partial" | null;
          received_row_count?: number | null;
          skipped_count?: number | null;
          skipped_detail?: Json | null;
        };
        Update: {
          finished_at?: string | null;
          success?: boolean | null;
          inserted_count?: number;
          updated_count?: number;
          deactivated_count?: number;
          failed_count?: number;
          error_detail?: Json | null;
          sync_mode?: "full_snapshot" | "partial" | null;
          received_row_count?: number | null;
          skipped_count?: number | null;
          skipped_detail?: Json | null;
        };
        Relationships: [];
      };
      promotion_sync_state: {
        Row: {
          promotion_type: PromotionType;
          initial_import_completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          promotion_type: PromotionType;
          initial_import_completed_at?: string | null;
        };
        Update: {
          initial_import_completed_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      event_campaigns_visible: {
        Row: Database["public"]["Tables"]["event_campaigns"]["Row"];
        Relationships: [];
      };
    };
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      is_store_manager: { Args: Record<string, never>; Returns: boolean };
      has_store_access: { Args: { target_store_id: string }; Returns: boolean };
      current_role: { Args: Record<string, never>; Returns: UserRole };
      next_product_id: { Args: Record<string, never>; Returns: string };
      mark_initial_import_completed: { Args: { p_promotion_type: PromotionType }; Returns: undefined };
    };
    Enums: {
      user_role: UserRole;
      notice_type: NoticeType;
      notice_target_type: NoticeTargetType;
      promotion_type: PromotionType;
      change_importance: ChangeImportance;
      promotion_change_type: PromotionChangeType;
    };
  };
}
