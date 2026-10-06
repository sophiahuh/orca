
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "calendar_events": {
                  Row: {
                    "course_id": string | null,"created_at": string,"date": string,"id": string,"kind": string,"material_id": string | null,"owner_id": string,"title": string
                  }
                  Insert: {
                    "course_id"?: string | null,"created_at"?: string,"date": string,"id": string,"kind": string,"material_id"?: string | null,"owner_id"?: string,"title": string
                  }
                  Update: {
                    "course_id"?: string | null,"created_at"?: string,"date"?: string,"id"?: string,"kind"?: string,"material_id"?: string | null,"owner_id"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "calendar_events_course_id_owner_id_fkey"
      columns: ["course_id","owner_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "calendar_events_material_id_owner_id_fkey"
      columns: ["material_id","owner_id"]
isOneToOne: false
      referencedRelation: "materials"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                },"courses": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"owner_id": string,"pos_x": number,"pos_y": number,"review_config": NonNullable<Json>,"short": string,"slug": string,"trail": string | null,"variant": string,"weights": NonNullable<Json>
                  }
                  Insert: {
                    "created_at"?: string,"id": string,"name": string,"owner_id"?: string,"pos_x": number,"pos_y": number,"review_config": NonNullable<Json>,"short": string,"slug": string,"trail"?: string | null,"variant": string,"weights": NonNullable<Json>
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"owner_id"?: string,"pos_x"?: number,"pos_y"?: number,"review_config"?: NonNullable<Json>,"short"?: string,"slug"?: string,"trail"?: string | null,"variant"?: string,"weights"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"evidence_events": {
                  Row: {
                    "at": string,"course_id": string,"grader": string | null,"id": string,"kind": string,"material_id": string | null,"note": string | null,"objective_id": string,"outcome": string | null,"owner_id": string,"question_id": string | null,"session_id": string | null,"source": string | null,"tier": string | null,"topic_id": string
                  }
                  Insert: {
                    "at": string,"course_id": string,"grader"?: string | null,"id": string,"kind": string,"material_id"?: string | null,"note"?: string | null,"objective_id": string,"outcome"?: string | null,"owner_id": string,"question_id"?: string | null,"session_id"?: string | null,"source"?: string | null,"tier"?: string | null,"topic_id": string
                  }
                  Update: {
                    "at"?: string,"course_id"?: string,"grader"?: string | null,"id"?: string,"kind"?: string,"material_id"?: string | null,"note"?: string | null,"objective_id"?: string,"outcome"?: string | null,"owner_id"?: string,"question_id"?: string | null,"session_id"?: string | null,"source"?: string | null,"tier"?: string | null,"topic_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "evidence_events_course_id_owner_id_fkey"
      columns: ["course_id","owner_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "evidence_events_material_id_owner_id_fkey"
      columns: ["material_id","owner_id"]
isOneToOne: false
      referencedRelation: "materials"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "evidence_events_objective_id_course_id_fkey"
      columns: ["objective_id","course_id"]
isOneToOne: false
      referencedRelation: "objectives"
      referencedColumns: ["id","course_id"]
    },{
      foreignKeyName: "evidence_events_question_id_owner_id_fkey"
      columns: ["question_id","owner_id"]
isOneToOne: false
      referencedRelation: "questions"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "evidence_events_topic_id_course_id_fkey"
      columns: ["topic_id","course_id"]
isOneToOne: false
      referencedRelation: "topics"
      referencedColumns: ["id","course_id"]
    }
                  ]
                },"material_pages": {
                  Row: {
                    "material_id": string,"n": number,"owner_id": string,"text": string
                  }
                  Insert: {
                    "material_id": string,"n": number,"owner_id"?: string,"text": string
                  }
                  Update: {
                    "material_id"?: string,"n"?: number,"owner_id"?: string,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "material_pages_material_id_owner_id_fkey"
      columns: ["material_id","owner_id"]
isOneToOne: false
      referencedRelation: "materials"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                },"materials": {
                  Row: {
                    "assigned": string | null,"content_hash": string | null,"course_id": string,"created_at": string,"due": string | null,"error": string | null,"filename": string,"hidden_text": Json | null,"id": string,"mime": string | null,"owner_id": string,"reading_since": string | null,"reflect": boolean,"reflection": Json | null,"size_bytes": number | null,"status": string,"storage_path": string | null,"type": string
                  }
                  Insert: {
                    "assigned"?: string | null,"content_hash"?: string | null,"course_id": string,"created_at"?: string,"due"?: string | null,"error"?: string | null,"filename": string,"hidden_text"?: Json | null,"id": string,"mime"?: string | null,"owner_id"?: string,"reading_since"?: string | null,"reflect"?: boolean,"reflection"?: Json | null,"size_bytes"?: number | null,"status"?: string,"storage_path"?: string | null,"type": string
                  }
                  Update: {
                    "assigned"?: string | null,"content_hash"?: string | null,"course_id"?: string,"created_at"?: string,"due"?: string | null,"error"?: string | null,"filename"?: string,"hidden_text"?: Json | null,"id"?: string,"mime"?: string | null,"owner_id"?: string,"reading_since"?: string | null,"reflect"?: boolean,"reflection"?: Json | null,"size_bytes"?: number | null,"status"?: string,"storage_path"?: string | null,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "materials_course_id_owner_id_fkey"
      columns: ["course_id","owner_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                },"model_usage": {
                  Row: {
                    "at": string,"cache_read_tokens": number,"cache_write_tokens": number,"cost_usd": number,"id": string,"input_tokens": number,"kind": string,"model": string,"output_tokens": number,"owner_id": string,"run_id": string | null
                  }
                  Insert: {
                    "at"?: string,"cache_read_tokens"?: number,"cache_write_tokens"?: number,"cost_usd": number,"id"?: string,"input_tokens": number,"kind": string,"model": string,"output_tokens": number,"owner_id": string,"run_id"?: string | null
                  }
                  Update: {
                    "at"?: string,"cache_read_tokens"?: number,"cache_write_tokens"?: number,"cost_usd"?: number,"id"?: string,"input_tokens"?: number,"kind"?: string,"model"?: string,"output_tokens"?: number,"owner_id"?: string,"run_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"objective_state": {
                  Row: {
                    "accumulator": Json | null,"course_id": string,"last_event_at": string | null,"objective_id": string,"owner_id": string,"rules_version": number | null,"stale": boolean,"updated_at": string,"version": number
                  }
                  Insert: {
                    "accumulator"?: Json | null,"course_id": string,"last_event_at"?: string | null,"objective_id": string,"owner_id": string,"rules_version"?: number | null,"stale"?: boolean,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "accumulator"?: Json | null,"course_id"?: string,"last_event_at"?: string | null,"objective_id"?: string,"owner_id"?: string,"rules_version"?: number | null,"stale"?: boolean,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "objective_state_course_id_owner_id_fkey"
      columns: ["course_id","owner_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "objective_state_objective_id_course_id_fkey"
      columns: ["objective_id","course_id"]
isOneToOne: false
      referencedRelation: "objectives"
      referencedColumns: ["id","course_id"]
    }
                  ]
                },"objectives": {
                  Row: {
                    "aliases": (string)[],"archived_with_topic": boolean,"course_id": string,"created_at": string,"description": string,"id": string,"material_id": string | null,"merged_into": string | null,"name": string,"origin": string,"owner_id": string,"review": string,"run_id": string | null,"signals": NonNullable<Json>,"topic_id": string,"uncertain": Json | null
                  }
                  Insert: {
                    "aliases"?: (string)[],"archived_with_topic"?: boolean,"course_id": string,"created_at"?: string,"description": string,"id": string,"material_id"?: string | null,"merged_into"?: string | null,"name": string,"origin": string,"owner_id"?: string,"review": string,"run_id"?: string | null,"signals"?: NonNullable<Json>,"topic_id": string,"uncertain"?: Json | null
                  }
                  Update: {
                    "aliases"?: (string)[],"archived_with_topic"?: boolean,"course_id"?: string,"created_at"?: string,"description"?: string,"id"?: string,"material_id"?: string | null,"merged_into"?: string | null,"name"?: string,"origin"?: string,"owner_id"?: string,"review"?: string,"run_id"?: string | null,"signals"?: NonNullable<Json>,"topic_id"?: string,"uncertain"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "objectives_course_id_owner_id_fkey"
      columns: ["course_id","owner_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "objectives_material_id_owner_id_fkey"
      columns: ["material_id","owner_id"]
isOneToOne: false
      referencedRelation: "materials"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "objectives_merged_into_course_id_fkey"
      columns: ["merged_into","course_id"]
isOneToOne: false
      referencedRelation: "objectives"
      referencedColumns: ["id","course_id"]
    },{
      foreignKeyName: "objectives_run_id_owner_id_fkey"
      columns: ["run_id","owner_id"]
isOneToOne: false
      referencedRelation: "pipeline_runs"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "objectives_topic_id_course_id_fkey"
      columns: ["topic_id","course_id"]
isOneToOne: false
      referencedRelation: "topics"
      referencedColumns: ["id","course_id"]
    }
                  ]
                },"pipeline_runs": {
                  Row: {
                    "at": string,"course_id": string,"dropped": NonNullable<Json>,"error": string | null,"hidden_text": Json | null,"id": string,"job_id": string | null,"kind": string,"material_id": string | null,"model": string,"objective_ids": (string)[],"objectives_attached": (string)[],"objectives_created": (string)[],"owner_id": string,"progress": Json | null,"questions_added": number,"security": Json | null,"started_at": string | null,"status": string,"topics_created": (string)[]
                  }
                  Insert: {
                    "at": string,"course_id": string,"dropped"?: NonNullable<Json>,"error"?: string | null,"hidden_text"?: Json | null,"id": string,"job_id"?: string | null,"kind": string,"material_id"?: string | null,"model": string,"objective_ids"?: (string)[],"objectives_attached"?: (string)[],"objectives_created"?: (string)[],"owner_id"?: string,"progress"?: Json | null,"questions_added"?: number,"security"?: Json | null,"started_at"?: string | null,"status"?: string,"topics_created"?: (string)[]
                  }
                  Update: {
                    "at"?: string,"course_id"?: string,"dropped"?: NonNullable<Json>,"error"?: string | null,"hidden_text"?: Json | null,"id"?: string,"job_id"?: string | null,"kind"?: string,"material_id"?: string | null,"model"?: string,"objective_ids"?: (string)[],"objectives_attached"?: (string)[],"objectives_created"?: (string)[],"owner_id"?: string,"progress"?: Json | null,"questions_added"?: number,"security"?: Json | null,"started_at"?: string | null,"status"?: string,"topics_created"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "pipeline_runs_course_id_owner_id_fkey"
      columns: ["course_id","owner_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "pipeline_runs_material_id_owner_id_fkey"
      columns: ["material_id","owner_id"]
isOneToOne: false
      referencedRelation: "materials"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar": string,"created_at": string,"default_review_config": Json | null,"default_weights": Json | null,"name": string | null,"onboarded": boolean,"owner_id": string,"timezone": string
                  }
                  Insert: {
                    "avatar"?: string,"created_at"?: string,"default_review_config"?: Json | null,"default_weights"?: Json | null,"name"?: string | null,"onboarded"?: boolean,"owner_id": string,"timezone"?: string
                  }
                  Update: {
                    "avatar"?: string,"created_at"?: string,"default_review_config"?: Json | null,"default_weights"?: Json | null,"name"?: string | null,"onboarded"?: boolean,"owner_id"?: string,"timezone"?: string
                  }
                  Relationships: [
                    
                  ]
                },"questions": {
                  Row: {
                    "anchor": Json | null,"answer": number,"course_id": string,"created_at": string,"deep": boolean,"exact": (string)[] | null,"explanation": string,"figure": Json | null,"id": string,"kind": string,"material_id": string | null,"objective_id": string | null,"options": (string)[],"owner_id": string,"prompt": string,"rubric": Json | null,"sort_order": number,"table": Json | null,"tier": string | null,"topic_id": string,"topic_name": string
                  }
                  Insert: {
                    "anchor"?: Json | null,"answer": number,"course_id": string,"created_at"?: string,"deep"?: boolean,"exact"?: (string)[] | null,"explanation": string,"figure"?: Json | null,"id": string,"kind": string,"material_id"?: string | null,"objective_id"?: string | null,"options"?: (string)[],"owner_id"?: string,"prompt": string,"rubric"?: Json | null,"sort_order": number,"table"?: Json | null,"tier"?: string | null,"topic_id": string,"topic_name": string
                  }
                  Update: {
                    "anchor"?: Json | null,"answer"?: number,"course_id"?: string,"created_at"?: string,"deep"?: boolean,"exact"?: (string)[] | null,"explanation"?: string,"figure"?: Json | null,"id"?: string,"kind"?: string,"material_id"?: string | null,"objective_id"?: string | null,"options"?: (string)[],"owner_id"?: string,"prompt"?: string,"rubric"?: Json | null,"sort_order"?: number,"table"?: Json | null,"tier"?: string | null,"topic_id"?: string,"topic_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "questions_course_id_owner_id_fkey"
      columns: ["course_id","owner_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "questions_material_id_owner_id_fkey"
      columns: ["material_id","owner_id"]
isOneToOne: false
      referencedRelation: "materials"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "questions_objective_id_course_id_fkey"
      columns: ["objective_id","course_id"]
isOneToOne: false
      referencedRelation: "objectives"
      referencedColumns: ["id","course_id"]
    },{
      foreignKeyName: "questions_topic_id_course_id_fkey"
      columns: ["topic_id","course_id"]
isOneToOne: false
      referencedRelation: "topics"
      referencedColumns: ["id","course_id"]
    }
                  ]
                },"rate_limits": {
                  Row: {
                    "action": string,"count": number,"owner_id": string,"window_start": string
                  }
                  Insert: {
                    "action": string,"count"?: number,"owner_id": string,"window_start": string
                  }
                  Update: {
                    "action"?: string,"count"?: number,"owner_id"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"relations": {
                  Row: {
                    "anchor": Json | null,"course_id": string,"created_at": string,"from_topic": string,"id": string,"material_id": string | null,"owner_id": string,"review": string,"to_topic": string,"type": string
                  }
                  Insert: {
                    "anchor"?: Json | null,"course_id": string,"created_at"?: string,"from_topic": string,"id": string,"material_id"?: string | null,"owner_id"?: string,"review": string,"to_topic": string,"type": string
                  }
                  Update: {
                    "anchor"?: Json | null,"course_id"?: string,"created_at"?: string,"from_topic"?: string,"id"?: string,"material_id"?: string | null,"owner_id"?: string,"review"?: string,"to_topic"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "relations_course_id_owner_id_fkey"
      columns: ["course_id","owner_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "relations_from_topic_course_id_fkey"
      columns: ["from_topic","course_id"]
isOneToOne: false
      referencedRelation: "topics"
      referencedColumns: ["id","course_id"]
    },{
      foreignKeyName: "relations_material_id_owner_id_fkey"
      columns: ["material_id","owner_id"]
isOneToOne: false
      referencedRelation: "materials"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "relations_to_topic_course_id_fkey"
      columns: ["to_topic","course_id"]
isOneToOne: false
      referencedRelation: "topics"
      referencedColumns: ["id","course_id"]
    }
                  ]
                },"security_events": {
                  Row: {
                    "at": string,"check": string,"id": string,"kind": string,"material_id": string | null,"owner_id": string,"question_id": string | null,"quote": string,"run_id": string | null,"severity": string
                  }
                  Insert: {
                    "at"?: string,"check": string,"id"?: string,"kind": string,"material_id"?: string | null,"owner_id": string,"question_id"?: string | null,"quote": string,"run_id"?: string | null,"severity"?: string
                  }
                  Update: {
                    "at"?: string,"check"?: string,"id"?: string,"kind"?: string,"material_id"?: string | null,"owner_id"?: string,"question_id"?: string | null,"quote"?: string,"run_id"?: string | null,"severity"?: string
                  }
                  Relationships: [
                    
                  ]
                },"session_results": {
                  Row: {
                    "correct": number,"course_id": string,"finished_at": string,"id": string,"mode": string,"owner_id": string,"seconds": number,"session_id": string,"topic_id": string | null,"total": number
                  }
                  Insert: {
                    "correct": number,"course_id": string,"finished_at"?: string,"id"?: string,"mode": string,"owner_id"?: string,"seconds": number,"session_id": string,"topic_id"?: string | null,"total": number
                  }
                  Update: {
                    "correct"?: number,"course_id"?: string,"finished_at"?: string,"id"?: string,"mode"?: string,"owner_id"?: string,"seconds"?: number,"session_id"?: string,"topic_id"?: string | null,"total"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "session_results_course_id_owner_id_fkey"
      columns: ["course_id","owner_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "session_results_topic_id_course_id_fkey"
      columns: ["topic_id","course_id"]
isOneToOne: false
      referencedRelation: "topics"
      referencedColumns: ["id","course_id"]
    }
                  ]
                },"topics": {
                  Row: {
                    "aliases": (string)[],"course_id": string,"created_at": string,"id": string,"material_id": string | null,"merged_into": string | null,"name": string,"owner_id": string,"pos_x": number,"pos_y": number,"review": string,"sort_order": number,"source": Json | null,"summary": string | null,"uncertain": Json | null
                  }
                  Insert: {
                    "aliases"?: (string)[],"course_id": string,"created_at"?: string,"id": string,"material_id"?: string | null,"merged_into"?: string | null,"name": string,"owner_id"?: string,"pos_x": number,"pos_y": number,"review": string,"sort_order": number,"source"?: Json | null,"summary"?: string | null,"uncertain"?: Json | null
                  }
                  Update: {
                    "aliases"?: (string)[],"course_id"?: string,"created_at"?: string,"id"?: string,"material_id"?: string | null,"merged_into"?: string | null,"name"?: string,"owner_id"?: string,"pos_x"?: number,"pos_y"?: number,"review"?: string,"sort_order"?: number,"source"?: Json | null,"summary"?: string | null,"uncertain"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "topics_course_id_owner_id_fkey"
      columns: ["course_id","owner_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "topics_material_id_owner_id_fkey"
      columns: ["material_id","owner_id"]
isOneToOne: false
      referencedRelation: "materials"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "topics_merged_into_course_id_fkey"
      columns: ["merged_into","course_id"]
isOneToOne: false
      referencedRelation: "topics"
      referencedColumns: ["id","course_id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "course_structure":
{ Args: { "course": string,"owner": string }; Returns: Json
                           },
"hit_rate_limit":
{ Args: { "action": string,"max_hits": number,"owner": string,"window_seconds": number }; Returns: Json
                           },
"my_data":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"record_evidence":
{ Args: { "accumulator": Json,"event": Json,"expected_version": number,"objective": string,"owner": string,"rules_version": number }; Returns: boolean
                           },
"save_snapshot":
{ Args: { "accumulator": Json,"expected_version": number,"objective": string,"owner": string,"rules_version": number }; Returns: boolean
                           },
"save_structure":
{ Args: { "course": string,"rows": Json }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
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
  "public": {
          Enums: {
            
          }
        }
} as const
