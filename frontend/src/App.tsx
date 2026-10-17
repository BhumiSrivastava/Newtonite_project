import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ItemsListPage from './pages/ItemsListPage';
import ItemDetailPage from './pages/ItemDetailPage';
import api from './api';

type View =
  | 'dashboard'
  | 'all'
  | 'assigned_to_me'
  | 'unassigned_urgent'
  | 'awaiting_approval'
  | `item:${string}`;

export default function App() {
  const { user, logout, isLoading } = useAuth();
  const [currentView, setCurrentView] = useState<View>('dashboard');

  const { data: statsData } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.getDashboardStats(),
    enabled: !!user,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="loading-spinner" style={{ height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const navigateTo = (view: string) => {
    setCurrentView(view as View);
  };

  // Get initials for avatar
  const initials = user.display_name
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  // Get the highest role across all teams
  const highestRole = user.memberships.reduce((best: string, m) => {
    const hierarchy = ['viewer', 'member', 'lead', 'admin'];
    return hierarchy.indexOf(m.role) > hierarchy.indexOf(best) ? m.role : best;
  }, 'viewer');

  const isActive = (view: string) => {
    if (view === 'dashboard') return currentView === 'dashboard';
    if (view === 'all') return currentView === 'all';
    if (view === 'assigned_to_me') return currentView === 'assigned_to_me';
    if (view === 'unassigned_urgent') return currentView === 'unassigned_urgent';
    if (view === 'awaiting_approval') return currentView === 'awaiting_approval';
    return false;
  };

  const renderContent = () => {
    if (currentView === 'dashboard') {
      return <DashboardPage onNavigate={navigateTo} />;
    }
    if (typeof currentView === 'string' && currentView.startsWith('item:')) {
      const itemId = currentView.replace('item:', '');
      return (
        <ItemDetailPage
          itemId={itemId}
          onBack={() => setCurrentView('all')}
        />
      );
    }
    return (
      <ItemsListPage
        view={currentView}
        onSelectItem={(id) => setCurrentView(`item:${id}` as View)}
      />
    );
  };

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <nav className="sidebar" role="navigation" aria-label="Main navigation">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="sidebar-brand-icon">⚡</div>
            <div>
              <div className="sidebar-brand-text">Ops Under Pressure</div>
              <div className="sidebar-brand-sub">Newtonite Challenge</div>
            </div>
          </div>
        </div>

        <div className="sidebar-nav">
          <div className="sidebar-section-title">Overview</div>
          <button
            id="nav-dashboard"
            className={`sidebar-link ${isActive('dashboard') ? 'active' : ''}`}
            onClick={() => setCurrentView('dashboard')}
          >
            <span className="sidebar-link-icon">🏠</span>
            Dashboard
          </button>

          <div className="sidebar-section-title">My Work</div>
          <button
            id="nav-assigned"
            className={`sidebar-link ${isActive('assigned_to_me') ? 'active' : ''}`}
            onClick={() => setCurrentView('assigned_to_me')}
          >
            <span className="sidebar-link-icon">👤</span>
            Assigned to Me
            {statsData?.assigned > 0 && (
              <span className="sidebar-link-badge">{statsData.assigned}</span>
            )}
          </button>
          <button
            id="nav-urgent"
            className={`sidebar-link ${isActive('unassigned_urgent') ? 'active' : ''}`}
            onClick={() => setCurrentView('unassigned_urgent')}
          >
            <span className="sidebar-link-icon">🚨</span>
            Unassigned Urgent
            {statsData?.unassigned_urgent > 0 && (
              <span className="sidebar-link-badge" style={{ background: 'var(--priority-critical)' }}>
                {statsData.unassigned_urgent}
              </span>
            )}
          </button>
          <button
            id="nav-approval"
            className={`sidebar-link ${isActive('awaiting_approval') ? 'active' : ''}`}
            onClick={() => setCurrentView('awaiting_approval')}
          >
            <span className="sidebar-link-icon">✅</span>
            Awaiting Approval
            {statsData?.awaiting_approval > 0 && (
              <span className="sidebar-link-badge" style={{ background: 'var(--status-awaiting)' }}>
                {statsData.awaiting_approval}
              </span>
            )}
          </button>

          <div className="sidebar-section-title">Browse</div>
          <button
            id="nav-all"
            className={`sidebar-link ${isActive('all') ? 'active' : ''}`}
            onClick={() => setCurrentView('all')}
          >
            <span className="sidebar-link-icon">📋</span>
            All Items
          </button>

          {/* Team chips */}
          <div className="sidebar-section-title">My Teams</div>
          {user.memberships.map(m => (
            <div
              key={m.team_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                fontSize: 12,
                color: 'var(--text-secondary)',
              }}
            >
              <span style={{ fontSize: 14 }}>👥</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.team_name}
              </span>
              <span className="badge badge-role" style={{ fontSize: 9, padding: '2px 6px' }}>
                {m.role}
              </span>
            </div>
          ))}
        </div>

        {/* User Footer */}
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">{initials}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user.display_name}</div>
            <div className="sidebar-user-role">{highestRole}</div>
          </div>
          <button
            id="logout-btn"
            className="btn btn-ghost btn-sm"
            onClick={logout}
            title="Sign out"
            style={{ padding: '4px 8px', fontSize: 16 }}
          >
            ↩
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="main-content" role="main">
        {renderContent()}
      </main>
    </div>
  );
}
