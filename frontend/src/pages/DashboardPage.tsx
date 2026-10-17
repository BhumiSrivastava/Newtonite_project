import React from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api';
import { useAuth } from '../AuthContext';

interface DashboardProps {
  onNavigate: (view: string) => void;
}

export default function DashboardPage({ onNavigate }: DashboardProps) {
  const { user } = useAuth();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.getDashboardStats(),
    refetchInterval: 30000, // Poll every 30 seconds
  });

  const { data: recentItems } = useQuery({
    queryKey: ['items', 'recent'],
    queryFn: () => api.getItems({ limit: '8', sort: 'updated_at', order: 'desc' }),
  });

  const { data: myItems } = useQuery({
    queryKey: ['items', 'assigned-to-me'],
    queryFn: () => api.getItems({ view: 'assigned_to_me', limit: '5' }),
  });

  if (isLoading) {
    return <div className="loading-spinner"><div className="spinner" /></div>;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Welcome back, {user?.display_name}</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="stats-grid">
        <div
          className="stat-card stat-assigned"
          onClick={() => onNavigate('assigned_to_me')}
          id="stat-assigned"
        >
          <div className="stat-card-label">Assigned to Me</div>
          <div className="stat-card-value">{stats?.assigned || 0}</div>
        </div>
        <div
          className="stat-card stat-urgent"
          onClick={() => onNavigate('unassigned_urgent')}
          id="stat-urgent"
        >
          <div className="stat-card-label">Unassigned Urgent</div>
          <div className="stat-card-value">{stats?.unassigned_urgent || 0}</div>
        </div>
        <div
          className="stat-card stat-approval"
          onClick={() => onNavigate('awaiting_approval')}
          id="stat-approval"
        >
          <div className="stat-card-label">Awaiting Approval</div>
          <div className="stat-card-value">{stats?.awaiting_approval || 0}</div>
        </div>
        <div className="stat-card stat-total" id="stat-total">
          <div className="stat-card-label">Total Items</div>
          <div className="stat-card-value">{stats?.total || 0}</div>
        </div>
      </div>

      {/* Recent Activity & My Items */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* My Active Items */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">My Active Items</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('assigned_to_me')}>
              View all →
            </button>
          </div>
          {myItems?.items?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {myItems.items.map((item: any) => (
                <div
                  key={item.id}
                  onClick={() => onNavigate(`item:${item.id}`)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    transition: 'background var(--transition-fast)',
                  }}
                  className="items-table"
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span className={`badge badge-priority-${item.priority}`} style={{ flexShrink: 0 }}>
                    {item.priority}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </span>
                  <span className={`badge badge-status-${item.status}`} style={{ flexShrink: 0 }}>
                    {item.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <div className="empty-state-title">No items assigned</div>
              <div className="empty-state-text">Claim an unassigned item to get started</div>
            </div>
          )}
        </div>

        {/* Recently Updated */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Recently Updated</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('all')}>
              View all →
            </button>
          </div>
          {recentItems?.items?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentItems.items.map((item: any) => (
                <div
                  key={item.id}
                  onClick={() => onNavigate(`item:${item.id}`)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    transition: 'background var(--transition-fast)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span className={`badge badge-priority-${item.priority}`} style={{ flexShrink: 0 }}>
                    {item.priority}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                    {item.team_name}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📊</div>
              <div className="empty-state-title">No recent activity</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
