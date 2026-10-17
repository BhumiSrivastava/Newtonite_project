const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface RequestOptions {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('ops_token', token);
    } else {
      localStorage.removeItem('ops_token');
    }
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('ops_token');
    }
    return this.token;
  }

  async request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_URL}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      const error: any = new Error(data.error || 'Request failed');
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  // Auth
  login(username: string, password: string) {
    return this.request('/auth/login', {
      method: 'POST',
      body: { username, password },
    });
  }

  // Items
  getItems(params: Record<string, string> = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/items${query ? `?${query}` : ''}`);
  }

  getItem(id: string) {
    return this.request(`/items/${id}`);
  }

  createItem(data: any, idempotencyKey?: string) {
    const headers: Record<string, string> = {};
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    return this.request('/items', {
      method: 'POST',
      body: data,
      headers,
    });
  }

  updateItem(id: string, data: any) {
    return this.request(`/items/${id}`, {
      method: 'PATCH',
      body: data,
    });
  }

  claimItem(id: string) {
    return this.request(`/items/${id}/claim`, { method: 'POST' });
  }

  transitionItem(id: string, toStatus: string, version: number) {
    return this.request(`/items/${id}/transition`, {
      method: 'POST',
      body: { to_status: toStatus, version },
    });
  }

  getActivity(id: string, cursor?: string) {
    const params = cursor ? `?cursor=${cursor}` : '';
    return this.request(`/items/${id}/activity${params}`);
  }

  getComments(id: string, cursor?: string) {
    const params = cursor ? `?cursor=${cursor}` : '';
    return this.request(`/items/${id}/comments${params}`);
  }

  addComment(id: string, body: string) {
    return this.request(`/items/${id}/comments`, {
      method: 'POST',
      body: { body },
    });
  }

  // Teams
  getTeams() {
    return this.request('/teams');
  }

  getTeamMembers(teamId: string) {
    return this.request(`/teams/${teamId}/members`);
  }

  // Dashboard
  getDashboardStats() {
    return this.request('/dashboard/stats');
  }
}

export const api = new ApiClient();
export default api;
