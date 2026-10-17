import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api';
import { useAuth } from '../AuthContext';
import { useToast } from '../ToastContext';

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  open: ['in_progress', 'closed'],
  in_progress: ['awaiting_approval', 'open'],
  awaiting_approval: ['resolved', 'in_progress'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  awaiting_approval: 'Awaiting Approval',
  resolved: 'Resolved',
  closed: 'Closed',
};

interface ItemDetailPageProps {
  itemId: string;
  onBack: () => void;
}

export default function ItemDetailPage({ itemId, onBack }: ItemDetailPageProps) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);
  const [submittingComment, setSubmittingComment] = useState(false);

  const { data: itemData, isLoading, refetch } = useQuery({
    queryKey: ['item', itemId],
    queryFn: () => api.getItem(itemId),
  });

  const { data: activityData, refetch: refetchActivity } = useQuery({
    queryKey: ['activity', itemId],
    queryFn: () => api.getActivity(itemId),
  });

  const { data: commentsData, refetch: refetchComments } = useQuery({
    queryKey: ['comments', itemId],
    queryFn: () => api.getComments(itemId),
  });

  const { data: teamsData } = useQuery({
    queryKey: ['teams'],
    queryFn: () => api.getTeams(),
  });

  const { data: membersData } = useQuery({
    queryKey: ['team-members', itemData?.item?.team_id],
    queryFn: () => api.getTeamMembers(itemData?.item?.team_id),
    enabled: !!itemData?.item?.team_id,
  });

  const item = itemData?.item;

  // Get user's role in the item's team
  const userMembership = user?.memberships.find(m => m.team_id === item?.team_id);
  const userRole = userMembership?.role;
  const canEdit = userRole === 'admin' || userRole === 'lead' ||
    (userRole === 'member' && (item?.created_by === user?.id || item?.assignee_id === user?.id));
  const canClaim = (userRole === 'member' || userRole === 'lead' || userRole === 'admin') && !item?.assignee_id;
  const canTransition = userRole === 'member' || userRole === 'lead' || userRole === 'admin';

  const handleClaim = async () => {
    try {
      const data = await api.claimItem(item.id);
      queryClient.setQueryData(['item', itemId], { item: data.item });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      refetchActivity();
      addToast('success', 'Item claimed successfully!');
    } catch (err: any) {
      if (err.status === 409) {
        // Optimistic UI rollback: server rejected, show conflict
        refetch();
        addToast('warning', `Conflict: ${err.data?.error || 'Item already claimed'}. Showing latest state.`);
      } else {
        addToast('error', err.message || 'Failed to claim item');
      }
    }
  };

  const handleTransition = async (toStatus: string) => {
    try {
      const data = await api.transitionItem(item.id, toStatus, item.version);
      queryClient.setQueryData(['item', itemId], { item: data.item });
      refetchActivity();
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      addToast('success', `Status changed to ${STATUS_LABELS[toStatus]}`);
    } catch (err: any) {
      if (err.status === 409) {
        // Stale version: roll back optimistic state, reload from server
        refetch();
        addToast('warning', 'Version conflict — item was modified. Showing latest state.');
      } else {
        addToast('error', err.data?.error || err.message || 'Transition failed');
      }
    }
  };

  const handleEdit = () => {
    setEditForm({
      title: item.title,
      description: item.description || '',
      priority: item.priority,
      type: item.type,
      assignee_id: item.assignee_id || '',
      due_date: item.due_date ? item.due_date.substring(0, 10) : '',
    });
    setEditMode(true);
  };

  const handleSaveEdit = async () => {
    try {
      const data = await api.updateItem(item.id, {
        ...editForm,
        assignee_id: editForm.assignee_id || null,
        due_date: editForm.due_date || null,
        version: item.version,
      });
      queryClient.setQueryData(['item', itemId], { item: data.item });
      refetchActivity();
      setEditMode(false);
      addToast('success', 'Item updated');
    } catch (err: any) {
      if (err.status === 409) {
        refetch();
        setEditMode(false);
        addToast('warning', 'Version conflict — item was modified by someone else. Showing latest state.');
      } else {
        addToast('error', err.data?.error || err.message || 'Update failed');
      }
    }
  };

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentBody.trim()) return;
    setSubmittingComment(true);
    try {
      await api.addComment(item.id, commentBody);
      setCommentBody('');
      refetchComments();
      refetchActivity();
      addToast('success', 'Comment added');
    } catch (err: any) {
      addToast('error', err.message || 'Failed to add comment');
    } finally {
      setSubmittingComment(false);
    }
  };

  if (isLoading) return <div className="loading-spinner"><div className="spinner" /></div>;
  if (!item) return (
    <div className="empty-state">
      <div className="empty-state-icon">❌</div>
      <div className="empty-state-title">Item not found</div>
      <button className="btn btn-secondary" onClick={onBack}>Back</button>
    </div>
  );

  const allowedTransitions = ALLOWED_TRANSITIONS[item.status] || [];

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack} id="item-back-btn">
            ← Back
          </button>
          <span className={`badge badge-status-${item.status}`}>
            {STATUS_LABELS[item.status]}
          </span>
          <span className={`badge badge-priority-${item.priority}`}>{item.priority}</span>
          <span className="badge badge-type">{item.type.replace('_', ' ')}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canClaim && (
            <button id="claim-item-btn" className="btn btn-primary btn-sm" onClick={handleClaim}>
              ⚡ Claim Item
            </button>
          )}
          {canEdit && !editMode && (
            <button id="edit-item-btn" className="btn btn-secondary btn-sm" onClick={handleEdit}>
              ✏️ Edit
            </button>
          )}
          {editMode && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditMode(false)}>Cancel</button>
              <button id="save-item-btn" className="btn btn-primary btn-sm" onClick={handleSaveEdit}>Save Changes</button>
            </>
          )}
        </div>
      </div>

      <div className="item-detail">
        {/* Main Content */}
        <div className="item-detail-main">
          {/* Title & Description */}
          <div className="card">
            {editMode ? (
              <>
                <div className="form-group">
                  <label className="form-label">Title</label>
                  <input
                    className="form-input"
                    value={editForm.title}
                    onChange={e => setEditForm((f: any) => ({ ...f, title: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea
                    className="form-input"
                    value={editForm.description}
                    onChange={e => setEditForm((f: any) => ({ ...f, description: e.target.value }))}
                    rows={4}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Priority</label>
                    <select
                      className="form-input"
                      value={editForm.priority}
                      onChange={e => setEditForm((f: any) => ({ ...f, priority: e.target.value }))}
                    >
                      {['critical', 'high', 'medium', 'low'].map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Assignee</label>
                    <select
                      className="form-input"
                      value={editForm.assignee_id}
                      onChange={e => setEditForm((f: any) => ({ ...f, assignee_id: e.target.value }))}
                    >
                      <option value="">Unassigned</option>
                      {membersData?.members?.map((m: any) => (
                        <option key={m.id} value={m.id}>{m.display_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Due Date</label>
                    <input
                      className="form-input"
                      type="date"
                      value={editForm.due_date}
                      onChange={e => setEditForm((f: any) => ({ ...f, due_date: e.target.value }))}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <h1 className="item-detail-title" id="item-title">{item.title}</h1>
                {item.description && (
                  <p className="item-detail-description" style={{ marginTop: 12 }}>
                    {item.description}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Workflow Transitions */}
          {canTransition && allowedTransitions.length > 0 && !editMode && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Workflow Actions</h2>
              </div>
              <div className="transition-buttons">
                {allowedTransitions.map(status => (
                  <button
                    key={status}
                    className="transition-btn"
                    onClick={() => handleTransition(status)}
                    id={`transition-${status}`}
                  >
                    → {STATUS_LABELS[status]}
                  </button>
                ))}
              </div>
              {item.status === 'awaiting_approval' && userRole !== 'lead' && userRole !== 'admin' && (
                <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 10 }}>
                  ⓘ Approval transitions require Lead or Admin role
                </p>
              )}
            </div>
          )}

          {/* Comments */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Comments</h2>
            </div>
            {commentsData?.comments?.length > 0 ? (
              commentsData.comments.map((c: any) => (
                <div key={c.id} className="comment">
                  <div className="comment-header">
                    <div className="comment-user">{c.user_name}</div>
                    <div className="comment-time">{new Date(c.created_at).toLocaleString()}</div>
                  </div>
                  <div className="comment-body">{c.body}</div>
                </div>
              ))
            ) : (
              <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>No comments yet</p>
            )}
            <form className="comment-form" onSubmit={handleComment} style={{ marginTop: 14 }}>
              <input
                id="comment-input"
                className="form-input"
                placeholder="Add a comment..."
                value={commentBody}
                onChange={e => setCommentBody(e.target.value)}
              />
              <button id="comment-submit" type="submit" className="btn btn-primary btn-sm" disabled={submittingComment}>
                Send
              </button>
            </form>
          </div>
        </div>

        {/* Sidebar */}
        <div className="item-detail-sidebar">
          {/* Meta */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 12 }}>Details</h3>
            <div className="item-meta-row">
              <span className="item-meta-label">Team</span>
              <span className="item-meta-value">{item.team_name}</span>
            </div>
            <div className="item-meta-row">
              <span className="item-meta-label">Assignee</span>
              <span className="item-meta-value">
                {item.assignee_name || <span style={{ color: 'var(--text-tertiary)' }}>Unassigned</span>}
              </span>
            </div>
            <div className="item-meta-row">
              <span className="item-meta-label">Created by</span>
              <span className="item-meta-value">{item.creator_name}</span>
            </div>
            <div className="item-meta-row">
              <span className="item-meta-label">Due date</span>
              <span className="item-meta-value" style={{
                color: item.due_date && new Date(item.due_date) < new Date() ? 'var(--priority-critical)' : undefined
              }}>
                {item.due_date ? new Date(item.due_date).toLocaleDateString() : '—'}
              </span>
            </div>
            <div className="item-meta-row">
              <span className="item-meta-label">Created</span>
              <span className="item-meta-value">{new Date(item.created_at).toLocaleDateString()}</span>
            </div>
            <div className="item-meta-row" style={{ borderBottom: 'none' }}>
              <span className="item-meta-label">Version</span>
              <span className="item-meta-value">v{item.version}</span>
            </div>
          </div>

          {/* Activity Timeline */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>Activity</h3>
            {activityData?.events?.length > 0 ? (
              <div className="activity-timeline">
                {activityData.events.map((event: any) => (
                  <div key={event.id} className="activity-event">
                    <div className="activity-event-header">
                      <span className="activity-event-user">{event.user_name}</span>
                      <span className="activity-event-action">
                        {formatEventDescription(event)}
                      </span>
                      <span className="activity-event-time">
                        {new Date(event.created_at).toLocaleString()}
                      </span>
                    </div>
                    {event.old_value && event.new_value && event.event_type !== 'created' && (
                      <div className="activity-event-detail">
                        {event.old_value} → {event.new_value}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>No activity yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatEventDescription(event: any): string {
  switch (event.event_type) {
    case 'created': return 'created this item';
    case 'status_changed': return 'changed status';
    case 'assignee_changed': return 'changed assignee';
    case 'priority_changed': return 'changed priority';
    case 'field_updated': return 'updated a field';
    case 'comment_added': return 'left a comment';
    case 'claimed': return 'claimed this item';
    case 'transition': return 'transitioned item';
    default: return event.event_type;
  }
}
