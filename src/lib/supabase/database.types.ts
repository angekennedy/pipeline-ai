
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "asset_versions": {
                  Row: {
                    "asset_id": string,"content": NonNullable<Json>,"created_at": string,"created_by": string | null,"generation_id": string | null,"id": string,"restored_from": string | null,"schema_version": string,"source": Database["public"]['Enums']["version_source"],"source_versions": NonNullable<Json>,"version": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_id": string,"content": NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"generation_id"?: string | null,"id"?: string,"restored_from"?: string | null,"schema_version": string,"source": Database["public"]['Enums']["version_source"],"source_versions"?: NonNullable<Json>,"version": number,"workspace_id": string
                  }
                  Update: {
                    "asset_id"?: string,"content"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"generation_id"?: string | null,"id"?: string,"restored_from"?: string | null,"schema_version"?: string,"source"?: Database["public"]['Enums']["version_source"],"source_versions"?: NonNullable<Json>,"version"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "asset_versions_asset_id_fkey"
      columns: ["asset_id"]
isOneToOne: false
      referencedRelation: "pipeline_assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "asset_versions_restored_from_fkey"
      columns: ["restored_from"]
isOneToOne: false
      referencedRelation: "asset_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "asset_versions_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"channels": {
                  Row: {
                    "audience": string | null,"brand_rules": NonNullable<Json>,"created_at": string,"default_language": string,"id": string,"name": string,"niche": string,"style": string | null,"tone": string | null,"updated_at": string,"voice_profile": NonNullable<Json>,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audience"?: string | null,"brand_rules"?: NonNullable<Json>,"created_at"?: string,"default_language"?: string,"id"?: string,"name": string,"niche": string,"style"?: string | null,"tone"?: string | null,"updated_at"?: string,"voice_profile"?: NonNullable<Json>,"workspace_id": string
                  }
                  Update: {
                    "audience"?: string | null,"brand_rules"?: NonNullable<Json>,"created_at"?: string,"default_language"?: string,"id"?: string,"name"?: string,"niche"?: string,"style"?: string | null,"tone"?: string | null,"updated_at"?: string,"voice_profile"?: NonNullable<Json>,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "channels_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"credit_accounts": {
                  Row: {
                    "balance": number,"reserved": number,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "balance"?: number,"reserved"?: number,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "balance"?: number,"reserved"?: number,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "credit_accounts_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: true
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"credit_ledger": {
                  Row: {
                    "amount": number,"balance_after": number,"created_at": string,"generation_id": string | null,"id": number,"idempotency_key": string,"kind": Database["public"]['Enums']["ledger_kind"],"metadata": NonNullable<Json>,"pipeline_id": string | null,"reserved_after": number,"stripe_ref": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"balance_after": number,"created_at"?: string,"generation_id"?: string | null,"id"?: never,"idempotency_key": string,"kind": Database["public"]['Enums']["ledger_kind"],"metadata"?: NonNullable<Json>,"pipeline_id"?: string | null,"reserved_after": number,"stripe_ref"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "amount"?: number,"balance_after"?: number,"created_at"?: string,"generation_id"?: string | null,"id"?: never,"idempotency_key"?: string,"kind"?: Database["public"]['Enums']["ledger_kind"],"metadata"?: NonNullable<Json>,"pipeline_id"?: string | null,"reserved_after"?: number,"stripe_ref"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "credit_ledger_generation_id_fkey"
      columns: ["generation_id"]
isOneToOne: false
      referencedRelation: "generations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_ledger_pipeline_id_fkey"
      columns: ["pipeline_id"]
isOneToOne: false
      referencedRelation: "pipelines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_ledger_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"generations": {
                  Row: {
                    "api_calls": number | null,"asset_type": Database["public"]['Enums']["asset_type"],"attempt": number,"cache_creation_tokens": number | null,"cache_read_tokens": number | null,"cost_usd_micros": number | null,"created_at": string,"credits": number,"error_code": string | null,"error_message": string | null,"finished_at": string | null,"id": string,"idempotency_key": string,"inngest_run_id": string | null,"input_tokens": number | null,"latency_ms": number | null,"model": string | null,"output_tokens": number | null,"pipeline_id": string,"prompt_version": string | null,"started_at": string | null,"status": Database["public"]['Enums']["gen_status"],"user_feedback": string | null,"validation_repairs": number,"version_id": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "api_calls"?: number | null,"asset_type": Database["public"]['Enums']["asset_type"],"attempt"?: number,"cache_creation_tokens"?: number | null,"cache_read_tokens"?: number | null,"cost_usd_micros"?: number | null,"created_at"?: string,"credits": number,"error_code"?: string | null,"error_message"?: string | null,"finished_at"?: string | null,"id"?: string,"idempotency_key": string,"inngest_run_id"?: string | null,"input_tokens"?: number | null,"latency_ms"?: number | null,"model"?: string | null,"output_tokens"?: number | null,"pipeline_id": string,"prompt_version"?: string | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["gen_status"],"user_feedback"?: string | null,"validation_repairs"?: number,"version_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "api_calls"?: number | null,"asset_type"?: Database["public"]['Enums']["asset_type"],"attempt"?: number,"cache_creation_tokens"?: number | null,"cache_read_tokens"?: number | null,"cost_usd_micros"?: number | null,"created_at"?: string,"credits"?: number,"error_code"?: string | null,"error_message"?: string | null,"finished_at"?: string | null,"id"?: string,"idempotency_key"?: string,"inngest_run_id"?: string | null,"input_tokens"?: number | null,"latency_ms"?: number | null,"model"?: string | null,"output_tokens"?: number | null,"pipeline_id"?: string,"prompt_version"?: string | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["gen_status"],"user_feedback"?: string | null,"validation_repairs"?: number,"version_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "generations_pipeline_id_fkey"
      columns: ["pipeline_id"]
isOneToOne: false
      referencedRelation: "pipelines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "generations_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "asset_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "generations_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"nps_responses": {
                  Row: {
                    "comment": string | null,"created_at": string,"score": number,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "comment"?: string | null,"created_at"?: string,"score": number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "comment"?: string | null,"created_at"?: string,"score"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"pipeline_assets": {
                  Row: {
                    "current_version_id": string | null,"id": string,"pipeline_id": string,"status": Database["public"]['Enums']["asset_status"],"type": Database["public"]['Enums']["asset_type"],"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "current_version_id"?: string | null,"id"?: string,"pipeline_id": string,"status"?: Database["public"]['Enums']["asset_status"],"type": Database["public"]['Enums']["asset_type"],"workspace_id": string
                  }
                  Update: {
                    "current_version_id"?: string | null,"id"?: string,"pipeline_id"?: string,"status"?: Database["public"]['Enums']["asset_status"],"type"?: Database["public"]['Enums']["asset_type"],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_current"
      columns: ["current_version_id"]
isOneToOne: false
      referencedRelation: "asset_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pipeline_assets_pipeline_id_fkey"
      columns: ["pipeline_id"]
isOneToOne: false
      referencedRelation: "pipelines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pipeline_assets_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"pipelines": {
                  Row: {
                    "brief": NonNullable<Json>,"channel_id": string | null,"channel_snapshot": Json | null,"completed_at": string | null,"created_at": string,"created_by": string | null,"credits_reserved": number,"id": string,"idempotency_key": string,"model_tier": string,"status": Database["public"]['Enums']["pipeline_status"],"title": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "brief": NonNullable<Json>,"channel_id"?: string | null,"channel_snapshot"?: Json | null,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"credits_reserved"?: number,"id"?: string,"idempotency_key": string,"model_tier"?: string,"status"?: Database["public"]['Enums']["pipeline_status"],"title"?: never,"workspace_id": string
                  }
                  Update: {
                    "brief"?: NonNullable<Json>,"channel_id"?: string | null,"channel_snapshot"?: Json | null,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"credits_reserved"?: number,"id"?: string,"idempotency_key"?: string,"model_tier"?: string,"status"?: Database["public"]['Enums']["pipeline_status"],"title"?: never,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pipelines_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pipelines_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string | null,"id": string,"locale": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"id": string,"locale"?: string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"id"?: string,"locale"?: string
                  }
                  Relationships: [
                    
                  ]
                },"stripe_events": {
                  Row: {
                    "id": string,"processed_at": string | null,"received_at": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id": string,"processed_at"?: string | null,"received_at"?: string,"type": string
                  }
                  Update: {
                    "id"?: string,"processed_at"?: string | null,"received_at"?: string,"type"?: string
                  }
                  Relationships: [
                    
                  ]
                },"subscriptions": {
                  Row: {
                    "cancel_at_period_end": boolean,"current_period_end": string | null,"id": string,"plan_key": string,"price_id": string,"status": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancel_at_period_end"?: boolean,"current_period_end"?: string | null,"id": string,"plan_key": string,"price_id": string,"status": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "cancel_at_period_end"?: boolean,"current_period_end"?: string | null,"id"?: string,"plan_key"?: string,"price_id"?: string,"status"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscriptions_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspace_members": {
                  Row: {
                    "role": Database["public"]['Enums']["member_role"],"user_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "role"?: Database["public"]['Enums']["member_role"],"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "role"?: Database["public"]['Enums']["member_role"],"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_members_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspaces": {
                  Row: {
                    "created_at": string,"id": string,"is_internal": boolean,"name": string,"plan_key": string,"slug": string,"stripe_customer_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_internal"?: boolean,"name": string,"plan_key"?: string,"slug": string,"stripe_customer_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_internal"?: boolean,"name"?: string,"plan_key"?: string,"slug"?: string,"stripe_customer_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "add_beta_invite":
{ Args: { "p_email": string,"p_note"?: string }; Returns: undefined
                           },
"beta_can_sign_in":
{ Args: { "p_email": string }; Returns: boolean
                           },
"beta_settings":
{ Args: Record<PropertyKey, never>; Returns: {
              "invite_only": boolean,"invites": Json
            }[]
                           },
"claim_generation":
{ Args: { "p_attempt": number,"p_generation": string }; Returns: boolean
                           },
"commit_asset_version":
{ Args: { "p_content": Json,"p_created_by"?: string,"p_generation"?: string,"p_pipeline": string,"p_restored_from"?: string,"p_schema_version": string,"p_source": Database["public"]['Enums']["version_source"],"p_source_versions": Json,"p_telemetry"?: Json,"p_type": Database["public"]['Enums']["asset_type"] }; Returns: string
                           },
"cost_outliers":
{ Args: { "p_baseline_since": string,"p_factor"?: number,"p_min_sample"?: number,"p_since": string }; Returns: {
              "cost_per_minute": number,"cost_usd_micros": number,"median_per_minute": number,"model_tier": string,"pipeline_id": string,"workspace_id": string
            }[]
                           },
"create_pipeline_with_reservation":
{ Args: { "p_brief": Json,"p_channel"?: string,"p_channel_snapshot"?: Json,"p_credits": number,"p_key": string,"p_tier": string,"p_user": string,"p_workspace": string }; Returns: {
              "created": boolean,"pipeline_id": string
            }[]
                           },
"delete_account":
{ Args: { "p_user": string }; Returns: number
                           },
"finalize_pipeline":
{ Args: { "p_pipeline": string,"p_status": Database["public"]['Enums']["pipeline_status"] }; Returns: number
                           },
"generation_failures":
{ Args: { "p_since": string }; Returns: {
              "failed": number,"finished": number
            }[]
                           },
"mark_generation_failed":
{ Args: { "p_code": string,"p_cost_usd_micros"?: number,"p_generation": string,"p_message": string }; Returns: undefined
                           },
"nps_summary":
{ Args: Record<PropertyKey, never>; Returns: {
              "detractors": number,"passives": number,"promoters": number,"responses": number
            }[]
                           },
"pipeline_economics":
{ Args: { "p_limit"?: number,"p_since": string }; Returns: {
              "cache_hit_ratio": number,"cost_usd_micros": number,"created_at": string,"credits_captured": number,"failed_generations": number,"generations": number,"minutes": number,"model_tier": string,"pipeline_id": string,"plan_key": string,"status": Database["public"]['Enums']["pipeline_status"],"total_latency_ms": number,"validation_repairs": number,"workspace_id": string
            }[]
                           },
"purge_rate_limits":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"rate_limit_hit":
{ Args: { "p_buckets": (string)[],"p_limits": (number)[],"p_windows": (number)[] }; Returns: number
                           },
"release_regeneration":
{ Args: { "p_key": string }; Returns: number
                           },
"remove_beta_invite":
{ Args: { "p_email": string }; Returns: undefined
                           },
"reserve_regeneration":
{ Args: { "p_credits": number,"p_key": string,"p_pipeline": string,"p_tier": string,"p_user": string,"p_workspace": string }; Returns: boolean
                           },
"set_beta_invite_only":
{ Args: { "p_enabled": boolean }; Returns: undefined
                           },
"set_workspace_internal":
{ Args: { "p_internal": boolean,"p_workspace": string }; Returns: boolean
                           },
"spend_since":
{ Args: { "p_since": string,"p_workspace"?: string }; Returns: number
                           },
"stale_reservations":
{ Args: { "p_idle"?: string }; Returns: number
                           },
"stripe_apply_subscription":
{ Args: { "p_cancel_at_period_end": boolean,"p_period_end": string,"p_plan": string,"p_price": string,"p_status": string,"p_subscription": string,"p_workspace": string }; Returns: string
                           },
"stripe_credit":
{ Args: { "p_amount": number,"p_key": string,"p_kind": Database["public"]['Enums']["ledger_kind"],"p_meta"?: Json,"p_ref": string,"p_workspace": string }; Returns: {
              "amount": number,
"balance_after": number,
"created_at": string,
"generation_id": string | null,
"id": number,
"idempotency_key": string,
"kind": Database["public"]['Enums']["ledger_kind"],
"metadata": NonNullable<Json>,
"pipeline_id": string | null,
"reserved_after": number,
"stripe_ref": string | null,
"workspace_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "credit_ledger"
        isOneToOne: true
        isSetofReturn: false
      } },
"stripe_link_customer":
{ Args: { "p_customer": string,"p_workspace": string }; Returns: undefined
                           },
"stripe_renew":
{ Args: { "p_allocation": number,"p_invoice": string,"p_meta"?: Json,"p_workspace": string }; Returns: {
              "amount": number,
"balance_after": number,
"created_at": string,
"generation_id": string | null,
"id": number,
"idempotency_key": string,
"kind": Database["public"]['Enums']["ledger_kind"],
"metadata": NonNullable<Json>,
"pipeline_id": string | null,
"reserved_after": number,
"stripe_ref": string | null,
"workspace_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "credit_ledger"
        isOneToOne: true
        isSetofReturn: false
      } },
"sweep_stale_reservations":
{ Args: { "p_idle"?: string }; Returns: number
                           },
"touch_generation":
{ Args: { "p_generation": string }; Returns: boolean
                           },
"upsert_generation":
{ Args: { "p_credits": number,"p_feedback"?: string,"p_key": string,"p_pipeline": string,"p_type": Database["public"]['Enums']["asset_type"] }; Returns: {
              "api_calls": number | null,
"asset_type": Database["public"]['Enums']["asset_type"],
"attempt": number,
"cache_creation_tokens": number | null,
"cache_read_tokens": number | null,
"cost_usd_micros": number | null,
"created_at": string,
"credits": number,
"error_code": string | null,
"error_message": string | null,
"finished_at": string | null,
"id": string,
"idempotency_key": string,
"inngest_run_id": string | null,
"input_tokens": number | null,
"latency_ms": number | null,
"model": string | null,
"output_tokens": number | null,
"pipeline_id": string,
"prompt_version": string | null,
"started_at": string | null,
"status": Database["public"]['Enums']["gen_status"],
"user_feedback": string | null,
"validation_repairs": number,
"version_id": string | null,
"workspace_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "generations"
        isOneToOne: true
        isSetofReturn: false
      } }
          }
          Enums: {
            "asset_status": "pending"|"running"|"ready"|"failed"|"stale","asset_type": "script"|"titles"|"seo"|"voiceover"|"thumbnails"|"video","gen_status": "queued"|"running"|"succeeded"|"failed","ledger_kind": "grant"|"purchase"|"reserve"|"capture"|"release"|"refund"|"adjust"|"expire","member_role": "viewer"|"editor"|"admin"|"owner","pipeline_status": "queued"|"running"|"partial"|"completed"|"failed"|"canceled","version_source": "ai"|"ai_regen"|"user_edit"|"restore"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "asset_status": ["pending", "running", "ready", "failed", "stale"],"asset_type": ["script", "titles", "seo", "voiceover", "thumbnails", "video"],"gen_status": ["queued", "running", "succeeded", "failed"],"ledger_kind": ["grant", "purchase", "reserve", "capture", "release", "refund", "adjust", "expire"],"member_role": ["viewer", "editor", "admin", "owner"],"pipeline_status": ["queued", "running", "partial", "completed", "failed", "canceled"],"version_source": ["ai", "ai_regen", "user_edit", "restore"]
          }
        }
} as const
