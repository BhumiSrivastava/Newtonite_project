import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api';
import { useToast } from '../ToastContext';
import { useAuth } from '../AuthContext';

const STATUS_OPTIONS = ['open', 'in_progress', 'awaiting_approval', 'resolved', 'closed'];
const PRIORITY_OPTIONS = ['critical', 'high', 'medium', 'low'];
const TYPE_OPTIONS = ['incident', 'customer_issue', 'payment', 'compliance', 'task'];

interface ItemsListPageProps {
  view?: string;
  onSelectItem: (id: string) => void;
}

export default function ItemsListPage({ view, onSelectItem }: ItemsListPageProps) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    type: '',
    assignee: '',
    team: '',
    q: '',
  });
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Build query params
  const params: Record<string, string> = { limit: '20' };
  if (view && view !== 'all') params.view = view;
  if (filters.status) params.status = filters.status;
  if (filters.priority) params.priority = filters.priority;
  if (filters.type) params.type = filters.type;
  if (filters.assignee) params.assignee = filters.assignee;
  if (filters.team) params.team = filters.team;
  if (filters.q) params.q = filters.q;
  if (cursor) params.cursor = cursor;

  const queryKey = ['items', view || 'all', filters, cursor];

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => api.getItems(params),
  });

  const { data: teamsData } = useQuery({
    queryKey: ['teams'],
    queryFn: () => api.getTeams(),
  });

  const viewTitles: Record<string, string> = {
    assigned_to_me: 'Assigned to Me',
    unassigned_urgent: 'Unassigned & Urgent',
    awaiting_approval: 'Awaiting My Approval',
    all: 'All Work Items',
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilters(f => ({ ...f, [key]: value }));
    setCursor(null);
    setCursorStack([]);
  };

  const handleNextPage = () => {
    if (data?.nextCursor) {
      setCursorStack(s => [...s, cursor || '']);
      setCursor(data.nextCursor);
    }
  };

  const handlePrevPage = () => {
    const stack = [...cursorStack];
    const prev = stack.pop() || null;
    setCursorStack(stack);
    setCursor(prev);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{viewTitles[view || 'all'] || 'Work Items'}</h1>
          <p className="page-subtitle">
            {data?.total !== undefined ? `${data.total.toLocaleString()} items` : ''}
          </p>
        </div>
        <button
          id="create-item-btn"
          className="btn btn-primary"
          onClick={() => setShowCreateModal(true)}
        >
          + New Item
        </button>
      </div>

      {/* Filters */}
      <div className="filters-bar">
        <div className="search-input-wrapper">
          <input
            id="items-search"
            className="form-input"
            placeholder="Search items..."
            value={filters.q}
            onChange={e => handleFilterChange('q', e.target.value)}
          />
        </div>
        <select
          id="filter-status"
          className="form-input"
          value={filters.status}
          onChange={e => handleFilterChange('status', e.target.value)}
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
        <select
          id="filter-priority"
          className="form-input"
          value={filters.priority}
          onChange={e => handleFilterChange('priority', e.target.value)}
        >
          <option value="">All Priorities</option>
          {PRIORITY_OPTIONS.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          id="filter-type"
          className="form-input"
          value={filters.type}
          onChange={e => handleFilterChange('type', e.target.value)}
        >
          <option value="">All Types</option>
          {TYPE_OPTIONS.map(t => (
            <option key={t} value={t}>{t.replace('_', ' ')}</option>
          ))}
        </select>
        <select
          id="filter-team"
          className="form-input"
          value={filters.team}
          onChange={e => handleFilterChange('team', e.target.value)}
        >
          <option value="">All Teams</option>
          {teamsData?.teams?.map((t: any) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="loading-spinner"><div className="spinner" /></div>
      ) : error ? (
        <div className="empty-state">
          <div className="empty-state-icon">⚠️</div>
          <div className="empty-state-title">Failed to load items</div>
          <div className="empty-state-text">{(error as any).message}</div>
        </div>
      ) : data?.items?.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">No items found</div>
          <div className="empty-state-text">Try adjusting your filters or create a new item</div>
        </div>
      ) : (
        <>
          <div className="items-table-wrapper">
            <table className="items-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Team</th>
                  <th>Assignee</th>
                  <th>Due</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {data?.items?.map((item: any) => (
                  <tr key={item.id}>
                    <td>
                      <span
                        className="item-title"
                        onClick={() => onSelectItem(item.id)}
                        id={`item-row-${item.id}`}
                      >
                        {item.title}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-type">{item.type.replace('_', ' ')}</span>
                    </td>
                    <td>
                      <span className={`badge badge-priority-${item.priority}`}>{item.priority}</span>
                    </td>
                    <td>
                      <span className={`badge badge-status-${item.status}`}>
                        {item.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{item.team_name}</td>
                    <td style={{ fontSize: 12 }}>
                      {item.assignee_name ? (
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                          {item.assignee_name}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)' }}>Unassigned</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: item.due_date && new Date(item.due_date) < new Date() ? 'var(--priority-critical)' : 'var(--text-secondary)' }}>
                      {item.due_date ? new Date(item.due_date).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {formatRelativeTime(item.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <div className="pagination-info">
              Page {cursorStack.length + 1} of ~{Math.ceil((data?.total || 0) / 20)} · {data?.total?.toLocaleString()} total
            </div>
            <div className="pagination-buttons">
              <button
                className="btn btn-secondary btn-sm"
                onClick={handlePrevPage}
                disabled={cursorStack.length === 0}
                id="prev-page-btn"
              >
                ← Previous
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleNextPage}
                disabled={!data?.nextCursor}
                id="next-page-btn"
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}

      {showCreateModal && (
        <CreateItemModal
          teams={teamsData?.teams || []}
          onClose={() => setShowCreateModal(false)}
          onCreated={(itemId: string) => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['items'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
            onSelectItem(itemId);
            addToast('success', 'Work item created successfully');
          }}
        />
      )}
    </div>
  );
}

function CreateItemModal({
  teams,
  onClose,
  onCreated,
}: {
  teams: any[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { addToast } = useToast();
  const [form, setForm] = useState({
    title: '',
    description: '',
    type: 'task',
    priority: 'medium',
    team_id: teams[0]?.id || '',
    due_date: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.team_id) {
      addToast('error', 'Title and team are required');
      return;
    }
    setSubmitting(true);
    try {
      // Use idempotency key to prevent double-submit
      const idempotencyKey = crypto.randomUUID();
      const data = await api.createItem(
        {
          ...form,
          due_date: form.due_date || undefined,
        },
        idempotencyKey
      );
      onCreated(data.item.id);
    } catch (err: any) {
      addToast('error', err.message || 'Failed to create item');
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">Create Work Item</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Title *</label>
            <input
              id="new-item-title"
              className="form-input"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Brief, descriptive title"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              id="new-item-desc"
              className="form-input"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What needs to be done and why?"
              rows={3}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select
                id="new-item-type"
                className="form-input"
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              >
                {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Priority</label>
              <select
                id="new-item-priority"
                className="form-input"
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
              >
                {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Team *</label>
              <select
                id="new-item-team"
                className="form-input"
                value={form.team_id}
                onChange={e => setForm(f => ({ ...f, team_id: e.target.value }))}
                required
              >
                {teams.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Due Date</label>
              <input
                id="new-item-due"
                className="form-input"
                type="date"
                value={form.due_date}
                onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
              />
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button id="create-item-submit" type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}
