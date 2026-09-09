export interface User {
  id: string;
  username: string;
  mustChangePassword?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  user_id: string;
  project_id: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta: Record<string, unknown> | null;
  task_id: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  conversation_id: string | null;
  project_id: string | null;
  agent_id: string | null;
  status: string;
  priority: string;
  prompt: string | null;
  result: string | null;
  error: string | null;
  approval_state: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface TaskLog {
  id: string;
  task_id: string;
  level: string;
  message: string;
  source: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface AgentPermission {
  resource: string;
  action: string;
  allowed: boolean;
  paths?: string[];
}

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  model: string | null;
  enabled: boolean;
  approval_policy: string | null;
  timeout_seconds: number | null;
  max_concurrent_tasks: number | null;
  permissions: AgentPermission[];
}

export interface Memory {
  id: string;
  content: string;
  type: string;
  importance: number | null;
  source_conversation_id: string | null;
  source_task_id: string | null;
  project_id: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface Note {
  id: string;
  title: string;
  content: string | null;
  note_type: string;
  project_id: string | null;
  pinned: boolean;
  archived: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  root_dir: string | null;
  instructions: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationRun {
  id: string;
  task_id: string | null;
  triggered_at: string;
  status: string;
  error: string | null;
}

export interface Automation {
  id: string;
  name: string;
  prompt: string;
  agent_id: string | null;
  project_id: string | null;
  schedule_type: string;
  schedule_value: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

export interface Approval {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  type: string;
  description: string;
  payload: Record<string, unknown> | null;
  risk_level: string;
  status: string;
  requested_at: string;
  responded_at: string | null;
  responded_by: string | null;
  reviewer_note: string | null;
}

export interface SessionInfo {
  id: string;
  created_at: string;
  expires_at: string;
  current?: boolean;
}

export interface LogEntry {
  id: string;
  category: string;
  level: string;
  message: string;
  source: string;
  meta: Record<string, unknown> | null;
  created_at: string;
  task_id?: string | null;
}

export interface CommandLog {
  id: string;
  task_id: string | null;
  command: string;
  cwd: string | null;
  exit_code: number | null;
  duration_ms: number | null;
  created_at: string;
}

export interface SystemStatusInfo {
  server: string;
  uptime: number;
  opencode: { available: boolean; version: string | null; error?: string | null };
  database: boolean;
  scheduler: boolean;
  workers: { available: number; busy: number };
  activeTasks: number;
  queuedTasks: number;
  waitingApprovals: number;
  memoryRecords: number;
  currentModel: string | null;
  serverTime: string;
}

export interface SettingsData {
  settings: Record<string, unknown>;
  trustedPaths: string[];
}