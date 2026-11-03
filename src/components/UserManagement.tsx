import React, { useState, useEffect } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { User } from '../types.js';
import { useAuth } from '../context/AuthContext.js';
import {
  Button, IconButton, Card, Badge, DataTable, Modal, Field, Input, Select, FormError, AvatarChip, cx,
} from './ui.js';
import type { Column } from './ui.js';

const ROLE_LABEL: Record<string, string> = { admin: 'Administrator', accountant: 'Accountant', staff: 'Staff' };
const MODULE_LABEL: Record<string, string> = {
  dashboard: 'Overview', invoices: 'Invoices', customers: 'Customers',
  payments: 'Payments', settings: 'Settings', users: 'Users',
};

const fmtLogin = (v?: string | null) => {
  if (!v) return 'Never';
  const d = new Date(v);
  return isNaN(d.getTime()) ? 'Never'
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const UserManagementView: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // New User Form
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'staff' | 'accountant'>('staff');
  const [modules, setModules] = useState<string[]>(['dashboard', 'invoices', 'customers', 'payments']);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<any>('/users');
      // The API answers with a bare array; older builds wrapped it as { users }
      setUsers(Array.isArray(res) ? res : (res?.users || []));
    } catch (err) {
      console.error('Failed to load users', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest('/users', {
        method: 'POST',
        body: JSON.stringify({
          email,
          full_name: fullName,
          password,
          role,
          modules,
        }),
      });
      setShowAdd(false);
      setEmail('');
      setFullName('');
      setPassword('');
      fetchUsers();
    } catch (err: any) {
      setError(err.message || 'Failed to create user');
    }
  };

  const handleModuleToggle = (mod: string) => {
    if (modules.includes(mod)) {
      setModules(modules.filter(m => m !== mod));
    } else {
      setModules([...modules, mod]);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm('Are you sure you want to deactivate/delete this user?')) return;
    try {
      await apiRequest(`/users/${userId}`, { method: 'DELETE' });
      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const ALL_MODULES = [
    { key: 'dashboard', label: 'Overview', hint: 'Dashboard and summaries' },
    { key: 'invoices', label: 'Invoices', hint: 'Create and edit bills' },
    { key: 'customers', label: 'Customers', hint: 'Party records' },
    { key: 'payments', label: 'Payments', hint: 'Receipts and dues' },
    { key: 'settings', label: 'Settings', hint: 'Company, rates and charges' },
    { key: 'users', label: 'Users', hint: 'Manage logins' },
  ];

  const isAdmin = currentUser?.role === 'admin';
  const closeAdd = () => { setShowAdd(false); setError(null); };

  const moduleList = (u: User) => {
    const mods = u.modules || [];
    if (mods.length === 0) return <span className="text-ink-faint">No access</span>;
    if (mods.length >= ALL_MODULES.length) return <span>All modules</span>;
    return <span>{mods.map(m => MODULE_LABEL[m] || m).join(', ')}</span>;
  };

  const deleteBtn = (u: User) => (isAdmin && u.id !== currentUser?.id ? (
    <IconButton label={`Delete ${u.full_name || u.email}`} onClick={(e) => { e.stopPropagation(); handleDeleteUser(u.id); }}
      className="hover:text-danger-ink hover:bg-danger-soft">
      <Trash2 />
    </IconButton>
  ) : null);

  const columns: Column<User>[] = [
    {
      key: 'user', header: 'User',
      cell: (u) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <AvatarChip name={u.full_name || u.email} className="w-7 h-7" />
          <div className="min-w-0">
            <div className="text-ink truncate">
              {u.full_name || 'Staff member'}
              {u.id === currentUser?.id && <span className="ml-1.5 text-xs text-ink-faint">(you)</span>}
            </div>
            <div className="text-xs text-ink-faint truncate">{u.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'role', header: 'Role',
      cell: (u) => <Badge tone={u.role === 'admin' ? 'accent' : 'neutral'}>{ROLE_LABEL[u.role] || u.role}</Badge>,
    },
    { key: 'modules', header: 'Access', hideBelow: 'md', className: 'text-xs max-w-[320px]', cell: moduleList },
    { key: 'login', header: 'Last sign-in', hideBelow: 'lg', className: 'text-xs whitespace-nowrap tabular-nums', cell: (u) => fmtLogin(u.last_login) },
    { key: 'actions', header: '', align: 'right', className: 'w-12', cell: (u) => deleteBtn(u) },
  ];

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Team</h2>
          <p className="text-xs text-ink-faint">
            {loading ? 'Loading users' : `${users.length} ${users.length === 1 ? 'user' : 'users'}`} · roles decide which modules each person can open
          </p>
        </div>
        {isAdmin && (
          <Button variant="primary" icon={<UserPlus />} onClick={() => setShowAdd(true)} className="shrink-0">
            Add user
          </Button>
        )}
      </div>

      <Card padded={false} className="overflow-hidden">
        <DataTable
          caption="Users"
          columns={columns}
          rows={users}
          loading={loading}
          mobileCard={(u) => (
            <div className="flex items-center gap-2.5">
              <AvatarChip name={u.full_name || u.email} className="w-8 h-8" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-ink truncate">{u.full_name || 'Staff member'}</span>
                  <Badge tone={u.role === 'admin' ? 'accent' : 'neutral'}>{ROLE_LABEL[u.role] || u.role}</Badge>
                </div>
                <div className="text-xs text-ink-faint truncate">{u.email}</div>
                <div className="text-xs text-ink-faint truncate">{moduleList(u)} · {fmtLogin(u.last_login)}</div>
              </div>
              {deleteBtn(u)}
            </div>
          )}
        />
      </Card>

      {showAdd && (
        <Modal
          onClose={closeAdd}
          title="Add user"
          subtitle="Create a login and choose what this person can open"
          footer={
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeAdd}>Cancel</Button>
              <Button type="submit" form="add-user-form" variant="primary">Create user</Button>
            </div>
          }
        >
          <form id="add-user-form" onSubmit={handleCreateUser} className="space-y-4">
            <FormError message={error} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Full name" htmlFor="nu-name" required>
                <Input id="nu-name" type="text" required value={fullName}
                  onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Mukesh Sharma" />
              </Field>
              <Field label="Email (used to sign in)" htmlFor="nu-email" required>
                <Input id="nu-email" type="email" required autoComplete="off" value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
              </Field>
              <Field label="Password" htmlFor="nu-pass" required hint="At least 6 characters.">
                <Input id="nu-pass" type="password" required minLength={6} autoComplete="new-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field label="Role" htmlFor="nu-role">
                <Select
                  id="nu-role"
                  value={role}
                  onChange={(e) => {
                    const r = e.target.value as any;
                    setRole(r);
                    if (r === 'admin') {
                      setModules(['dashboard', 'invoices', 'customers', 'payments', 'settings', 'users']);
                    } else if (r === 'accountant') {
                      setModules(['dashboard', 'invoices', 'customers', 'payments', 'settings']);
                    } else {
                      setModules(['dashboard', 'invoices', 'customers', 'payments']);
                    }
                  }}
                >
                  <option value="staff">Staff (invoices and logistics)</option>
                  <option value="accountant">Accountant (billing and payments)</option>
                  <option value="admin">Administrator (full access)</option>
                </Select>
              </Field>
            </div>

            <fieldset>
              <legend className="text-xs font-medium text-ink-soft mb-1">Module access</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-4 divide-y divide-line sm:divide-y-0 border-y border-line sm:border-0">
                {ALL_MODULES.map((m) => (
                  <label key={m.key} className={cx('flex items-start gap-2.5 py-2 min-h-[44px] cursor-pointer')}>
                    <input
                      type="checkbox"
                      checked={modules.includes(m.key)}
                      onChange={() => handleModuleToggle(m.key)}
                      className="mt-0.5 w-4 h-4 shrink-0 cursor-pointer"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">{m.label}</span>
                      <span className="block text-xs text-ink-faint">{m.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </form>
        </Modal>
      )}
    </div>
  );
};
