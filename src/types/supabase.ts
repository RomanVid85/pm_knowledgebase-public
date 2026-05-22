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
    PostgrestVersion: "14.5"
  }
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
      api_endpoints: {
        Row: {
          api_version: string | null
          created_at: string
          deprecated: boolean
          description: string | null
          http_method: string
          id: string
          metadata: Json
          operation_id: string | null
          parameters: Json
          path: string
          request_body: Json | null
          responses: Json
          security: Json
          source_artifact_id: string
          status: Database["public"]["Enums"]["api_endpoint_status"]
          summary: string | null
          tags: string[]
          topic_id: string | null
          updated_at: string
          vendor: string | null
        }
        Insert: {
          api_version?: string | null
          created_at?: string
          deprecated?: boolean
          description?: string | null
          http_method: string
          id?: string
          metadata?: Json
          operation_id?: string | null
          parameters?: Json
          path: string
          request_body?: Json | null
          responses?: Json
          security?: Json
          source_artifact_id: string
          status?: Database["public"]["Enums"]["api_endpoint_status"]
          summary?: string | null
          tags?: string[]
          topic_id?: string | null
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          api_version?: string | null
          created_at?: string
          deprecated?: boolean
          description?: string | null
          http_method?: string
          id?: string
          metadata?: Json
          operation_id?: string | null
          parameters?: Json
          path?: string
          request_body?: Json | null
          responses?: Json
          security?: Json
          source_artifact_id?: string
          status?: Database["public"]["Enums"]["api_endpoint_status"]
          summary?: string | null
          tags?: string[]
          topic_id?: string | null
          updated_at?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_endpoints_source_artifact_id_fkey"
            columns: ["source_artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_endpoints_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      artifact_relationships: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          metadata: Json
          notes: string | null
          relationship_type: Database["public"]["Enums"]["artifact_relationship_type"]
          source_artifact_id: string
          status: Database["public"]["Enums"]["relationship_status"]
          target_artifact_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          relationship_type: Database["public"]["Enums"]["artifact_relationship_type"]
          source_artifact_id: string
          status?: Database["public"]["Enums"]["relationship_status"]
          target_artifact_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          relationship_type?: Database["public"]["Enums"]["artifact_relationship_type"]
          source_artifact_id?: string
          status?: Database["public"]["Enums"]["relationship_status"]
          target_artifact_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifact_relationships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifact_relationships_source_artifact_id_fkey"
            columns: ["source_artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifact_relationships_target_artifact_id_fkey"
            columns: ["target_artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
        ]
      }
      artifact_topics: {
        Row: {
          artifact_id: string
          authority_override:
            | Database["public"]["Enums"]["source_authority"]
            | null
          created_at: string
          notes: string | null
          relevance_score: number
          topic_id: string
          updated_at: string
        }
        Insert: {
          artifact_id: string
          authority_override?:
            | Database["public"]["Enums"]["source_authority"]
            | null
          created_at?: string
          notes?: string | null
          relevance_score?: number
          topic_id: string
          updated_at?: string
        }
        Update: {
          artifact_id?: string
          authority_override?:
            | Database["public"]["Enums"]["source_authority"]
            | null
          created_at?: string
          notes?: string | null
          relevance_score?: number
          topic_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifact_topics_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifact_topics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      artifacts: {
        Row: {
          artifact_type: Database["public"]["Enums"]["artifact_type"]
          attachments: Json
          confidence: number
          content_hash: string | null
          created_at: string
          effective_date: string | null
          extracted_content: string | null
          id: string
          is_vendor_specific: boolean | null
          metadata: Json
          source_authority: Database["public"]["Enums"]["source_authority"]
          source_url: string | null
          status: Database["public"]["Enums"]["artifact_status"]
          storage_path: string | null
          superseded_by: string | null
          supersedes: string | null
          title: string
          topic_suggestions: Json | null
          updated_at: string
          uploaded_by: string | null
          vendor: string | null
          vendor_version: string | null
        }
        Insert: {
          artifact_type?: Database["public"]["Enums"]["artifact_type"]
          attachments?: Json
          confidence?: number
          content_hash?: string | null
          created_at?: string
          effective_date?: string | null
          extracted_content?: string | null
          id?: string
          is_vendor_specific?: boolean | null
          metadata?: Json
          source_authority?: Database["public"]["Enums"]["source_authority"]
          source_url?: string | null
          status?: Database["public"]["Enums"]["artifact_status"]
          storage_path?: string | null
          superseded_by?: string | null
          supersedes?: string | null
          title: string
          topic_suggestions?: Json | null
          updated_at?: string
          uploaded_by?: string | null
          vendor?: string | null
          vendor_version?: string | null
        }
        Update: {
          artifact_type?: Database["public"]["Enums"]["artifact_type"]
          attachments?: Json
          confidence?: number
          content_hash?: string | null
          created_at?: string
          effective_date?: string | null
          extracted_content?: string | null
          id?: string
          is_vendor_specific?: boolean | null
          metadata?: Json
          source_authority?: Database["public"]["Enums"]["source_authority"]
          source_url?: string | null
          status?: Database["public"]["Enums"]["artifact_status"]
          storage_path?: string | null
          superseded_by?: string | null
          supersedes?: string | null
          title?: string
          topic_suggestions?: Json | null
          updated_at?: string
          uploaded_by?: string | null
          vendor?: string | null
          vendor_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_drafts: {
        Row: {
          author_user_id: string | null
          body: string | null
          citations: Json
          created_at: string
          id: string
          metadata: Json
          sections: Json
          status: Database["public"]["Enums"]["brief_draft_status"]
          title: string
          topic_ids: string[]
          updated_at: string
        }
        Insert: {
          author_user_id?: string | null
          body?: string | null
          citations?: Json
          created_at?: string
          id?: string
          metadata?: Json
          sections?: Json
          status?: Database["public"]["Enums"]["brief_draft_status"]
          title: string
          topic_ids?: string[]
          updated_at?: string
        }
        Update: {
          author_user_id?: string | null
          body?: string | null
          citations?: Json
          created_at?: string
          id?: string
          metadata?: Json
          sections?: Json
          status?: Database["public"]["Enums"]["brief_draft_status"]
          title?: string
          topic_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_drafts_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      chunks: {
        Row: {
          artifact_id: string
          chunk_index: number
          content: string
          content_hash: string | null
          created_at: string
          embedding: string | null
          id: string
          metadata: Json
          page_number: number | null
          section: string | null
          status: string
          token_count: number | null
          updated_at: string
        }
        Insert: {
          artifact_id: string
          chunk_index: number
          content: string
          content_hash?: string | null
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json
          page_number?: number | null
          section?: string | null
          status?: string
          token_count?: number | null
          updated_at?: string
        }
        Update: {
          artifact_id?: string
          chunk_index?: number
          content?: string
          content_hash?: string | null
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json
          page_number?: number | null
          section?: string | null
          status?: string
          token_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chunks_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contradictions: {
        Row: {
          artifact_a_id: string | null
          artifact_b_id: string | null
          created_at: string
          description: string | null
          detected_at: string
          detected_by: string | null
          detected_by_ai_job_id: string | null
          evidence: Json
          id: string
          metadata: Json
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolving_decision_id: string | null
          rule_a_id: string | null
          rule_b_id: string | null
          severity: Database["public"]["Enums"]["contradiction_severity"]
          status: Database["public"]["Enums"]["contradiction_status"]
          summary: string
          topic_id: string | null
          updated_at: string
        }
        Insert: {
          artifact_a_id?: string | null
          artifact_b_id?: string | null
          created_at?: string
          description?: string | null
          detected_at?: string
          detected_by?: string | null
          detected_by_ai_job_id?: string | null
          evidence?: Json
          id?: string
          metadata?: Json
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolving_decision_id?: string | null
          rule_a_id?: string | null
          rule_b_id?: string | null
          severity?: Database["public"]["Enums"]["contradiction_severity"]
          status?: Database["public"]["Enums"]["contradiction_status"]
          summary: string
          topic_id?: string | null
          updated_at?: string
        }
        Update: {
          artifact_a_id?: string | null
          artifact_b_id?: string | null
          created_at?: string
          description?: string | null
          detected_at?: string
          detected_by?: string | null
          detected_by_ai_job_id?: string | null
          evidence?: Json
          id?: string
          metadata?: Json
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolving_decision_id?: string | null
          rule_a_id?: string | null
          rule_b_id?: string | null
          severity?: Database["public"]["Enums"]["contradiction_severity"]
          status?: Database["public"]["Enums"]["contradiction_status"]
          summary?: string
          topic_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contradictions_artifact_a_id_fkey"
            columns: ["artifact_a_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contradictions_artifact_b_id_fkey"
            columns: ["artifact_b_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contradictions_detected_by_fkey"
            columns: ["detected_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contradictions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contradictions_resolving_decision_id_fkey"
            columns: ["resolving_decision_id"]
            isOneToOne: false
            referencedRelation: "decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contradictions_rule_a_id_fkey"
            columns: ["rule_a_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contradictions_rule_b_id_fkey"
            columns: ["rule_b_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contradictions_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      decisions: {
        Row: {
          alternatives_considered: Json
          context: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string
          evidence_artifact_ids: string[]
          id: string
          metadata: Json
          rationale: string | null
          status: Database["public"]["Enums"]["decision_status"]
          summary: string | null
          superseded_by: string | null
          supersedes: string | null
          title: string
          topic_ids: string[]
          updated_at: string
        }
        Insert: {
          alternatives_considered?: Json
          context?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision: string
          evidence_artifact_ids?: string[]
          id?: string
          metadata?: Json
          rationale?: string | null
          status?: Database["public"]["Enums"]["decision_status"]
          summary?: string | null
          superseded_by?: string | null
          supersedes?: string | null
          title: string
          topic_ids?: string[]
          updated_at?: string
        }
        Update: {
          alternatives_considered?: Json
          context?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          evidence_artifact_ids?: string[]
          id?: string
          metadata?: Json
          rationale?: string | null
          status?: Database["public"]["Enums"]["decision_status"]
          summary?: string | null
          superseded_by?: string | null
          supersedes?: string | null
          title?: string
          topic_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error: Json | null
          id: string
          inngest_run_id: string | null
          invoker_user_id: string | null
          kind: string
          metadata: Json
          source_artifact_id: string | null
          started_at: string
          status: Database["public"]["Enums"]["ingest_job_status"]
          steps_completed: Json
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: Json | null
          id?: string
          inngest_run_id?: string | null
          invoker_user_id?: string | null
          kind: string
          metadata?: Json
          source_artifact_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["ingest_job_status"]
          steps_completed?: Json
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: Json | null
          id?: string
          inngest_run_id?: string | null
          invoker_user_id?: string | null
          kind?: string
          metadata?: Json
          source_artifact_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["ingest_job_status"]
          steps_completed?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingest_jobs_invoker_user_id_fkey"
            columns: ["invoker_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingest_jobs_source_artifact_id_fkey"
            columns: ["source_artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
        ]
      }
      rules: {
        Row: {
          conditions: Json | null
          confidence: number
          created_at: string
          extracted_at: string
          extracted_by: string | null
          extracted_by_ai_job_id: string | null
          extracted_by_ai_job_invoker: string | null
          extraction_notes: string | null
          human_verified: boolean
          id: string
          metadata: Json
          rule_key: string
          rule_type: Database["public"]["Enums"]["rule_type"]
          source_artifact_id: string | null
          source_chunk_id: string | null
          source_location: Json | null
          source_quote: string | null
          status: Database["public"]["Enums"]["rule_status"]
          superseded_by: string | null
          supersedes: string | null
          topic_id: string
          updated_at: string
          value: Json
          verification_notes: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          conditions?: Json | null
          confidence?: number
          created_at?: string
          extracted_at?: string
          extracted_by?: string | null
          extracted_by_ai_job_id?: string | null
          extracted_by_ai_job_invoker?: string | null
          extraction_notes?: string | null
          human_verified?: boolean
          id?: string
          metadata?: Json
          rule_key: string
          rule_type: Database["public"]["Enums"]["rule_type"]
          source_artifact_id?: string | null
          source_chunk_id?: string | null
          source_location?: Json | null
          source_quote?: string | null
          status?: Database["public"]["Enums"]["rule_status"]
          superseded_by?: string | null
          supersedes?: string | null
          topic_id: string
          updated_at?: string
          value?: Json
          verification_notes?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          conditions?: Json | null
          confidence?: number
          created_at?: string
          extracted_at?: string
          extracted_by?: string | null
          extracted_by_ai_job_id?: string | null
          extracted_by_ai_job_invoker?: string | null
          extraction_notes?: string | null
          human_verified?: boolean
          id?: string
          metadata?: Json
          rule_key?: string
          rule_type?: Database["public"]["Enums"]["rule_type"]
          source_artifact_id?: string | null
          source_chunk_id?: string | null
          source_location?: Json | null
          source_quote?: string | null
          status?: Database["public"]["Enums"]["rule_status"]
          superseded_by?: string | null
          supersedes?: string | null
          topic_id?: string
          updated_at?: string
          value?: Json
          verification_notes?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rules_extracted_by_ai_job_invoker_fkey"
            columns: ["extracted_by_ai_job_invoker"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rules_extracted_by_fkey"
            columns: ["extracted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rules_source_artifact_id_fkey"
            columns: ["source_artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rules_source_chunk_id_fkey"
            columns: ["source_chunk_id"]
            isOneToOne: false
            referencedRelation: "chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rules_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rules_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rules_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rules_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      system_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "system_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_pages: {
        Row: {
          compile_inputs: Json
          compiled_at: string
          compiled_by: string | null
          compiled_by_ai_job_id: string | null
          compiled_by_ai_job_invoker: string | null
          created_at: string
          id: string
          metadata: Json
          sections: Json
          source_artifact_ids: string[]
          status: Database["public"]["Enums"]["topic_page_status"]
          summary: string | null
          superseded_by: string | null
          supersedes: string | null
          title: string
          topic_id: string
          updated_at: string
          version: number
        }
        Insert: {
          compile_inputs?: Json
          compiled_at?: string
          compiled_by?: string | null
          compiled_by_ai_job_id?: string | null
          compiled_by_ai_job_invoker?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          sections?: Json
          source_artifact_ids?: string[]
          status?: Database["public"]["Enums"]["topic_page_status"]
          summary?: string | null
          superseded_by?: string | null
          supersedes?: string | null
          title: string
          topic_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          compile_inputs?: Json
          compiled_at?: string
          compiled_by?: string | null
          compiled_by_ai_job_id?: string | null
          compiled_by_ai_job_invoker?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          sections?: Json
          source_artifact_ids?: string[]
          status?: Database["public"]["Enums"]["topic_page_status"]
          summary?: string | null
          superseded_by?: string | null
          supersedes?: string | null
          title?: string
          topic_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "topic_pages_compiled_by_ai_job_invoker_fkey"
            columns: ["compiled_by_ai_job_invoker"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_pages_compiled_by_fkey"
            columns: ["compiled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_pages_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "topic_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_pages_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "topic_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_pages_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_relationships: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          metadata: Json
          notes: string | null
          relationship_type: Database["public"]["Enums"]["topic_relationship_type"]
          source_topic_id: string
          status: Database["public"]["Enums"]["relationship_status"]
          strength: number
          target_topic_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          relationship_type: Database["public"]["Enums"]["topic_relationship_type"]
          source_topic_id: string
          status?: Database["public"]["Enums"]["relationship_status"]
          strength?: number
          target_topic_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          relationship_type?: Database["public"]["Enums"]["topic_relationship_type"]
          source_topic_id?: string
          status?: Database["public"]["Enums"]["relationship_status"]
          strength?: number
          target_topic_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_relationships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_relationships_source_topic_id_fkey"
            columns: ["source_topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_relationships_target_topic_id_fkey"
            columns: ["target_topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: {
          created_at: string
          description: string | null
          description_embedding: string | null
          id: string
          metadata: Json
          name: string
          owner_user_id: string | null
          slug: string
          status: Database["public"]["Enums"]["topic_status"]
          updated_at: string
          vendor: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          description_embedding?: string | null
          id?: string
          metadata?: Json
          name: string
          owner_user_id?: string | null
          slug: string
          status?: Database["public"]["Enums"]["topic_status"]
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          description_embedding?: string | null
          id?: string
          metadata?: Json
          name?: string
          owner_user_id?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["topic_status"]
          updated_at?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "topics_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
          metadata: Json
          role: Database["public"]["Enums"]["user_role"]
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          metadata?: Json
          role?: Database["public"]["Enums"]["user_role"]
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          metadata?: Json
          role?: Database["public"]["Enums"]["user_role"]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      authority_weight: {
        Args: { authority: Database["public"]["Enums"]["source_authority"] }
        Returns: number
      }
      recency_decay: { Args: { effective_date: string }; Returns: number }
      search_chunks: {
        Args: {
          anchor_topic_id?: string
          query_embedding: string
          result_limit?: number
        }
        Returns: {
          artifact_id: string
          artifact_title: string
          authority: number
          chunk_id: string
          confidence: number
          content: string
          recency: number
          score: number
          section: string
          similarity: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      api_endpoint_status: "draft" | "active" | "deprecated" | "archived"
      artifact_relationship_type:
        | "cites"
        | "supersedes"
        | "contradicts"
        | "supplements"
        | "implements"
        | "illustrates"
        | "derived_from"
        | "reviewed_by"
      artifact_status: "draft" | "active" | "superseded" | "archived"
      artifact_type:
        | "openapi_spec"
        | "pdf_guide"
        | "sample_payload"
        | "meeting_note"
        | "prd"
        | "strategy_doc"
        | "adr"
        | "slack_thread"
        | "webinar"
        | "blog_post"
        | "other"
        | "api_documentation"
        | "training_guide"
        | "field_note"
      brief_draft_status: "draft" | "in_review" | "final" | "archived"
      contradiction_severity: "low" | "medium" | "high" | "critical"
      contradiction_status: "open" | "resolved" | "dismissed" | "deferred"
      decision_status:
        | "proposed"
        | "active"
        | "superseded"
        | "rejected"
        | "archived"
      ingest_job_status:
        | "queued"
        | "running"
        | "succeeded"
        | "failed"
        | "cancelled"
      relationship_status: "active" | "archived"
      rule_status:
        | "draft"
        | "pending_verification"
        | "active"
        | "superseded"
        | "disputed"
      rule_type:
        | "validation"
        | "capability"
        | "constraint"
        | "workflow"
        | "data_requirement"
      source_authority:
        | "vendor_canonical"
        | "vendor_reference"
        | "external_authoritative"
        | "internal_canonical"
        | "internal_interpretive"
        | "speculative"
      topic_page_status: "draft" | "active" | "superseded" | "archived"
      topic_relationship_type:
        | "depends_on"
        | "integrates_with"
        | "governed_by"
        | "shares_data_with"
        | "blocks"
        | "supersedes"
        | "alternative_to"
        | "upstream_of"
        | "downstream_of"
      topic_status: "draft" | "active" | "archived"
      user_role: "admin" | "pm" | "sme" | "engineer" | "viewer"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      api_endpoint_status: ["draft", "active", "deprecated", "archived"],
      artifact_relationship_type: [
        "cites",
        "supersedes",
        "contradicts",
        "supplements",
        "implements",
        "illustrates",
        "derived_from",
        "reviewed_by",
      ],
      artifact_status: ["draft", "active", "superseded", "archived"],
      artifact_type: [
        "openapi_spec",
        "pdf_guide",
        "sample_payload",
        "meeting_note",
        "prd",
        "strategy_doc",
        "adr",
        "slack_thread",
        "webinar",
        "blog_post",
        "other",
        "api_documentation",
        "training_guide",
        "field_note",
      ],
      brief_draft_status: ["draft", "in_review", "final", "archived"],
      contradiction_severity: ["low", "medium", "high", "critical"],
      contradiction_status: ["open", "resolved", "dismissed", "deferred"],
      decision_status: [
        "proposed",
        "active",
        "superseded",
        "rejected",
        "archived",
      ],
      ingest_job_status: [
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
      ],
      relationship_status: ["active", "archived"],
      rule_status: [
        "draft",
        "pending_verification",
        "active",
        "superseded",
        "disputed",
      ],
      rule_type: [
        "validation",
        "capability",
        "constraint",
        "workflow",
        "data_requirement",
      ],
      source_authority: [
        "vendor_canonical",
        "vendor_reference",
        "external_authoritative",
        "internal_canonical",
        "internal_interpretive",
        "speculative",
      ],
      topic_page_status: ["draft", "active", "superseded", "archived"],
      topic_relationship_type: [
        "depends_on",
        "integrates_with",
        "governed_by",
        "shares_data_with",
        "blocks",
        "supersedes",
        "alternative_to",
        "upstream_of",
        "downstream_of",
      ],
      topic_status: ["draft", "active", "archived"],
      user_role: ["admin", "pm", "sme", "engineer", "viewer"],
    },
  },
} as const
