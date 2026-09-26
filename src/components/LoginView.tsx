import React, { useState, useEffect } from 'react';
import { Lock, Mail, ArrowRight, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { apiRequest } from '../services/api.js';
import { CompanySettings } from '../types.js';
import { SslLogo } from './SslLogo.js';
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
    <div className="min-h-dvh flex flex-col justify-center px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-6">
          <span className="bg-surface border border-line rounded-card p-3 shadow-card mb-4">
            <SslLogo className="h-12 w-auto" customLogoUrl={companySettings?.logo_url} />
          </span>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-ink">{brandName}</h1>
          <p className="mt-1 text-sm text-ink-faint">GST Invoicing &amp; Transportation Billing</p>
        </div>

        <Card className="sm:p-7">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <FormError message={error} />

            <Field label="Email address" htmlFor="login-email" required>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none z-10" aria-hidden="true" />
                <Input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="username"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  placeholder="you@company.com"
                />
              </div>
            </Field>

            <Field
              label="Password"
              htmlFor="login-password"
              required
              action={
                <button
                  type="button"
                  onClick={() => { setForgotEmail(email); setShowForgot(true); }}
                  className="text-xs font-semibold text-accent-ink hover:underline cursor-pointer"
                >
                  Forgot password?
                </button>
              }
            >
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none z-10" aria-hidden="true" />
                <Input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 pr-11"
                  placeholder="Enter your password"
                />
                <IconButton
                  label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </IconButton>
              </div>
            </Field>

            <Button
              id="login-submit-btn"
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              icon={!loading ? <ArrowRight className="w-4 h-4" /> : undefined}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>

        <p className="mt-5 text-center text-xs text-ink-faint">
          {companySettings?.gstin ? `GSTIN ${companySettings.gstin} · ` : ''}SAC 996511
        </p>
      </div>

      {showForgot && (
        <Modal
          onClose={() => setShowForgot(false)}
          title="Reset password"
          subtitle="We will generate a secure recovery token"
          size="sm"
        >
          {resetSuccess ? (
            <div className="p-4 bg-positive-soft border border-positive-line rounded-card flex items-center gap-3 text-positive-ink text-sm font-medium">
              <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>Password updated. Redirecting…</span>
            </div>
          ) : !resetToken ? (
            <form onSubmit={handleForgot} className="space-y-4">
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
                <Button type="button" variant="secondary" onClick={() => setShowForgot(false)}>Cancel</Button>
                <Button type="submit" variant="primary">Generate token</Button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              {forgotMsg && <p className="text-sm text-positive-ink">{forgotMsg}</p>}
              <Field label="Reset token" htmlFor="reset-token" hint="Copied automatically. Keep this private.">
                <Input id="reset-token" type="text" readOnly value={resetToken} className="font-mono" />
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
                <Button type="button" variant="secondary" onClick={() => setShowForgot(false)}>Cancel</Button>
                <Button type="submit" variant="primary">Save password</Button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
};
