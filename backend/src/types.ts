// ==========================================
// Domain types for Operations Under Pressure
// ==========================================

export type TeamRole = 'viewer' | 'member' | 'lead' | 'admin';
export type ItemType = 'incident' | 'customer_issue' | 'payment' | 'compliance' | 'task';
export type ItemPriority = 'critical' | 'high' | 'medium' | 'low';
export type ItemStatus = 'open' | 'in_progress' | 'awaiting_approval' | 'resolved' | 'closed';
export type EventType = 'created' | 'status_changed' | 'assignee_changed' | 'priority_changed' | 'field_updated' | 'comment_added' | 'claimed' | 'transition';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface User {
  id: string;
  username: string;
  email: string;
  display_name: string;
  created_at: Date;
}

export interface Team {
  id: string;
  name: string;
  description: string;
}

export interface Membership {
  id: string;
  user_id: string;
  team_id: string;
  role: TeamRole;
}

export interface WorkItem {
  id: string;
  title: string;
  description: string | null;
  type: ItemType;
  priority: ItemPriority;
  status: ItemStatus;
  team_id: string;
  assignee_id: string | null;
  created_by: string;
  due_date: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface ActivityEvent {
  id: string;
  work_item_id: string;
  user_id: string;
  event_type: EventType;
  old_value: string | null;
  new_value: string | null;
  metadata: Record<string, any> | null;
  created_at: Date;
}

export interface Comment {
  id: string;
  work_item_id: string;
  user_id: string;
  body: string;
  created_at: Date;
  updated_at: Date;
}

// JWT payload
export interface JwtPayload {
  userId: string;
  username: string;
}

// Authenticated request user
export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  memberships: (Membership & { team_name: string })[];
}

// Permission actions
export type PermissionAction =
  | 'view_items'
  | 'create_items'
  | 'edit_own_items'
  | 'edit_any_item'
  | 'claim_items'
  | 'transition_items'
  | 'approve_items'
  | 'manage_team';

// Allowed transitions
export const ALLOWED_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  open: ['in_progress', 'closed'],
  in_progress: ['awaiting_approval', 'open'],
  awaiting_approval: ['resolved', 'in_progress'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

// Transitions that require Lead or Admin role
export const LEAD_ONLY_TRANSITIONS: Array<[ItemStatus, ItemStatus]> = [
  ['awaiting_approval', 'resolved'],
  ['awaiting_approval', 'in_progress'],
];

// Admin-only transitions
export const ADMIN_ONLY_TRANSITIONS: Array<[ItemStatus, ItemStatus]> = [
  ['open', 'closed'],
];

// Permission matrix: role -> allowed actions
export const PERMISSION_MATRIX: Record<TeamRole, Set<PermissionAction>> = {
  viewer: new Set(['view_items']),
  member: new Set(['view_items', 'create_items', 'edit_own_items', 'claim_items', 'transition_items']),
  lead: new Set(['view_items', 'create_items', 'edit_own_items', 'edit_any_item', 'claim_items', 'transition_items', 'approve_items']),
  admin: new Set(['view_items', 'create_items', 'edit_own_items', 'edit_any_item', 'claim_items', 'transition_items', 'approve_items', 'manage_team']),
};
