import { AuthUser, PermissionAction, PERMISSION_MATRIX, TeamRole } from '../types';

/**
 * Central permission check function.
 * Every endpoint uses this single function to verify authorization.
 * 
 * @param user - The authenticated user with their team memberships
 * @param action - The action being performed
 * @param teamId - The team the resource belongs to
 * @param resourceOwnerId - Optional: the user who owns the resource (for edit_own checks)
 * @returns { allowed: boolean, role: TeamRole | null, reason: string }
 */
export function checkPermission(
  user: AuthUser,
  action: PermissionAction,
  teamId: string,
  resourceOwnerId?: string
): { allowed: boolean; role: TeamRole | null; reason: string } {
  // Find user's membership in the target team
  const membership = user.memberships.find(m => m.team_id === teamId);

  if (!membership) {
    return {
      allowed: false,
      role: null,
      reason: `User is not a member of this team`,
    };
  }

  const rolePermissions = PERMISSION_MATRIX[membership.role];

  // Direct permission check
  if (rolePermissions.has(action)) {
    return {
      allowed: true,
      role: membership.role,
      reason: `User has ${action} permission as ${membership.role}`,
    };
  }

  // Special case: edit_own_items allows editing if the user created/owns the resource
  if (action === 'edit_any_item' && resourceOwnerId === user.id && rolePermissions.has('edit_own_items')) {
    return {
      allowed: true,
      role: membership.role,
      reason: `User can edit their own items as ${membership.role}`,
    };
  }

  return {
    allowed: false,
    role: membership.role,
    reason: `${membership.role} role does not have ${action} permission`,
  };
}

/**
 * Get all team IDs that a user has access to.
 */
export function getUserTeamIds(user: AuthUser): string[] {
  return user.memberships.map(m => m.team_id);
}

/**
 * Check if user has at least the given role in the given team.
 */
export function hasMinimumRole(user: AuthUser, teamId: string, minRole: TeamRole): boolean {
  const roleHierarchy: Record<TeamRole, number> = {
    viewer: 0,
    member: 1,
    lead: 2,
    admin: 3,
  };

  const membership = user.memberships.find(m => m.team_id === teamId);
  if (!membership) return false;

  return roleHierarchy[membership.role] >= roleHierarchy[minRole];
}
