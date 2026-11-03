import React, { useState, useEffect } from 'react';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { apiRequest } from '../services/api.js';
import { CompanySettings } from '../types.js';
import { BrandMark } from './Sidebar.js';
import { Button, Card, Field, Input, FormError, Modal, IconButton } from './ui.js';

export const LoginView: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    apiRequest<CompanySettings>('/settings/company')
      .then(res => {
        if (res) setCompanySettings(res);
      })
      .catch(() => {});
  }, []);

  // Forgot password modal
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Unable to sign in. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotMsg(null);
    try {
      const res = await apiRequest<{ message: string; token: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail }),
      });
      setResetToken(res.token);
      setForgotMsg(res.message);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetToken) return;
    try {
      await apiRequest('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, password: newPassword }),
      });
      setResetSuccess(true);
      setTimeout(() => {
        setShowForgot(false);
        setResetSuccess(false);
        setResetToken(null);
        setPassword(newPassword);
      }, 1500);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const brandName = companySettings?.name || 'SHREE SANWARIYA LOGISTICS';

  return (
    <div className="min-h-dvh flex flex-col px-4 py-8 sm:py-12">
      <div className="flex-1 flex flex-col justify-center mx-auto w-full max-w-[360px]">
        <div className="flex items-center gap-2.5 mb-6">
          <BrandMark className="w-8 h-8 text-base" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink leading-tight">SSL Billing</div>
            <div className="text-xs text-ink-faint leading-tight truncate">{brandName}</div>
          </div>
        </div>

        <Card className="p-4 sm:p-5">
          <h1 className="text-base font-semibold text-ink">Sign in</h1>
          <p className="text-xs text-ink-faint mt-0.5 mb-4">Use your work email and password.</p>

          <form className="space-y-3.5" onSubmit={handleSubmit}>
            <FormError message={error} />

            <Field label="Email" htmlFor="login-email">
              <Input
                id="login-email"
                type="email"
                required
                autoComplete="username"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </Field>

            <Field
              label="Password"
              htmlFor="login-password"
              action={
                <button
                  type="button"
                  onClick={() => { setForgotEmail(email); setShowForgot(true); }}
                  className="text-xs text-accent-ink hover:underline cursor-pointer"
                >
                  Forgot password?
                </button>
              }
            >
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                />
                <IconButton
                  label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </IconButton>
              </div>
            </Field>

            <Button
              id="login-submit-btn"
              type="submit"
              variant="primary"
              fullWidth
              loading={loading}
              className="mt-1"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-xs text-ink-faint">
          GST invoicing and freight billing
          {companySettings?.gstin ? <> · GSTIN <span className="font-mono">{companySettings.gstin}</span></> : null}
        </p>
      </div>

      {showForgot && (
        <Modal
          onClose={() => setShowForgot(false)}
          title="Reset password"
          subtitle="Generate a recovery token for your account"
          size="sm"
        >
          {resetSuccess ? (
            <div role="status" className="flex items-center gap-2 text-sm text-positive-ink">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Password updated. Redirecting…</span>
            </div>
          ) : !resetToken ? (
            <form onSubmit={handleForgot} className="space-y-3.5">
              <Field label="Registered email" htmlFor="forgot-email" required>
                <Input
                  id="forgot-email"
                  type="email"
                  required
                  autoComplete="username"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setShowForgot(false)}>Cancel</Button>
                <Button type="submit" variant="primary">Generate token</Button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleReset} className="space-y-3.5">
              {forgotMsg && <p className="text-sm text-ink-soft">{forgotMsg}</p>}
              <Field label="Reset token" htmlFor="reset-token" hint="Copied automatically. Keep this private.">
                <Input id="reset-token" type="text" readOnly value={resetToken} className="font-mono text-[13px]" />
              </Field>
              <Field label="New password" htmlFor="reset-pass" required hint="At least 6 characters.">
                <Input
                  id="reset-pass"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setShowForgot(false)}>Cancel</Button>
                <Button type="submit" variant="primary">Save password</Button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
};
