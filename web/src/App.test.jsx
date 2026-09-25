import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';

vi.mock('./api', () => ({
  login: vi.fn(),
  register: vi.fn(),
  me: vi.fn(),
  setToken: vi.fn(),
  getToken: vi.fn(() => null),
  listBoards: vi.fn(),
  createBoard: vi.fn(),
  getBoard: vi.fn(),
  updateBoard: vi.fn(),
  deleteBoard: vi.fn(),
  listShares: vi.fn(),
  createShare: vi.fn(),
  deleteShare: vi.fn(),
  listCollaborators: vi.fn(),
  addCollaborator: vi.fn(),
  removeCollaborator: vi.fn(),
  getSharedBoard: vi.fn(),
  addShareComment: vi.fn(),
  createUpload: vi.fn(),
}));

import * as api from './api';

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getToken.mockReturnValue(null);
  });

  it('renders sign in form when not authenticated', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('shows sign in button', () => {
    render(<App />);
    const buttons = screen.getAllByRole('button');
    const signInBtn = buttons.find(b => b.textContent === 'Sign in');
    expect(signInBtn).toBeInTheDocument();
  });

  it('calls login API on sign in', async () => {
    api.login.mockResolvedValue({ token: 'fake-token' });
    api.me.mockResolvedValue({ id: '1', email: 'test@example.com' });
    api.listBoards.mockResolvedValue({ boards: [] });

    render(<App />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' },
    });

    const buttons = screen.getAllByRole('button');
    const signInBtn = buttons.find(b => b.textContent === 'Sign in');
    fireEvent.click(signInBtn);

    await waitFor(() => {
      expect(api.login).toHaveBeenCalledWith('test@example.com', 'password123');
    });
  });

  it('shows boards list after successful login', async () => {
    api.getToken.mockReturnValue('fake-token');
    api.me.mockResolvedValue({ id: '1', email: 'test@example.com' });
    api.listBoards.mockResolvedValue({
      boards: [
        { id: 'b1', title: 'My Board', updatedAt: '2026-01-01T00:00:00Z', accessRole: 'owner' },
      ],
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('My Boards')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('My Board')).toBeInTheDocument();
    });
  });

  it('shows create new board button when authenticated', async () => {
    api.getToken.mockReturnValue('fake-token');
    api.me.mockResolvedValue({ id: '1', email: 'test@example.com' });
    api.listBoards.mockResolvedValue({ boards: [] });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Create new board')).toBeInTheDocument();
    });
  });
});
