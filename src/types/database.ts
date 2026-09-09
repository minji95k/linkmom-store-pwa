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
  | "시스템";

export type NoticeTargetType = "all" | "store" | "role" | "user";

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
          is_pinned: boolean;
          requires_confirmation: boolean;
          published_at: string;
          expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          body: string;
          notice_type?: NoticeType;
          author_id?: string | null;
          is_pinned?: boolean;
          requires_confirmation?: boolean;
          published_at?: string;
          expires_at?: string | null;
        };
        Update: {
          title?: string;
          body?: string;
          notice_type?: NoticeType;
          is_pinned?: boolean;
          requires_confirmation?: boolean;
          published_at?: string;
          expires_at?: string | null;
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
    };
    Views: Record<string, never>;
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      is_store_manager: { Args: Record<string, never>; Returns: boolean };
      has_store_access: { Args: { target_store_id: string }; Returns: boolean };
      current_role: { Args: Record<string, never>; Returns: UserRole };
    };
    Enums: {
      user_role: UserRole;
      notice_type: NoticeType;
      notice_target_type: NoticeTargetType;
    };
  };
}
