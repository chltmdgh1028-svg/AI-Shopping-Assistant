import type { AnalysisResult, UserPreference, UserProfile } from "@/types/shopping";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          user_id: string;
          profile: UserProfile;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          profile: UserProfile;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          profile?: UserProfile;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      preferences: {
        Row: {
          user_id: string;
          preferences: UserPreference[];
          schema_version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          preferences: UserPreference[];
          schema_version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          preferences?: UserPreference[];
          schema_version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      analysis_history: {
        Row: {
          id: string;
          user_id: string;
          result: AnalysisResult;
          analyzed_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          user_id?: string;
          result: AnalysisResult;
          analyzed_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          result?: AnalysisResult;
          analyzed_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
