import { useState } from 'react';
import { api, auth, client } from '../api';
import { AuthLayout, Checklist, Field, OtpInput, PasswordField, Stepper, Tabs, passwordOk } from '../../shared/ui';
import { Icon } from '../../shared/icons';
import type { Theme } from '../../shared/hooks';

export type AuthStep = 'signin' | 'signup' | 'verify' | 'forgot' | 'otp' | 'newpw' | 'accept';
const LANDING = import.meta.env.VITE_LANDING_URL ?? '/';

export default function Auth({ theme, onTheme, onSignedIn, initial, initialEmail }: { theme: Theme; onTheme: () => void; onSignedIn: () => void; initial?: AuthStep; initialEmail?: string }) {
  const [step, setStep] = useState<AuthStep>(initial ?? 'signin');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [size, setSize] = useState('11 – 50');
  const [code, setCode] = useState('');
  const [invite, setInvite] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const go = (s: AuthStep) => { setErr(''); setStep(s); };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('');
    try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const finish = (r: any) => { auth.set(r.token); onSignedIn(); };

  const signin = () => run(async () => finish(await api('/auth/login', { body: { email, password: pw, ...client } })));
  const signup = () => run(async () => { const r = await api('/auth/signup', { body: { name, email, company, teamSize: size, password: pw } }); setSentTo(r.sentTo); setCode(''); go('verify'); });
  const verify = () => run(async () => finish(await api('/auth/verify-email', { body: { email, code, ...client } })));
  const forgot = (useBackup = false) => run(async () => { const r = await api('/auth/password/forgot', { body: { email, useBackup } }); setSentTo(r.sentTo); setCode(''); go('otp'); });
  const checkCode = () => run(async () => { await api('/auth/password/reset', { body: { email, code } }); setPw(''); setPw2(''); go('newpw'); });
  const reset = () => run(async () => { await api('/auth/password/reset', { body: { email, code, password: pw } }); setPw(''); setNote('Password updated. Sign in with your new password.'); go('signin'); });
  const accept = () => run(async () => finish(await api('/auth/invite/accept', { body: { email, code: invite, password: pw, ...client } })));

  return (
    <AuthLayout sub="Admin console" landing={LANDING} theme={theme} onTheme={onTheme}>
      {(step === 'signin' || step === 'signup') && <Tabs a="Sign in" b="Create workspace" value={step === 'signup' ? 'b' : 'a'} onChange={(v) => go(v === 'a' ? 'signin' : 'signup')} />}
      {(step === 'forgot' || step === 'otp' || step === 'newpw') && <Stepper step={step === 'forgot' ? 0 : step === 'otp' ? 1 : 2} />}
      {note && step === 'signin' && <div className="banner banner-ok" role="status"><Icon name="check" stroke={3} />{note}</div>}
      {err && <div className="banner banner-no" role="alert"><Icon name="alert" />{err}</div>}

      {step === 'signin' && (
        <form className="col" onSubmit={(e) => { e.preventDefault(); signin(); }}>
          <div className="col" style={{ gap: 6 }}><h2>Sign in to the admin console</h2><span className="text2">Use the email and password for your organization.</span></div>
          <Field label="Work email" id="si-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <PasswordField label="Password" id="si-pw" value={pw} onChange={setPw} />
          <div className="between" style={{ marginTop: -6 }}><span /><button type="button" className="link-btn" onClick={() => go('forgot')}>Forgot password?</button></div>
          <button className="btn btn-primary btn-wide" disabled={busy || !email || !pw}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <span className="text2" style={{ fontSize: 13 }}>Invited as an admin? <button type="button" className="link-btn" onClick={() => go('accept')}>Use your invite code</button></span>
        </form>
      )}
      {step === 'signup' && (
        <form className="col" onSubmit={(e) => { e.preventDefault(); signup(); }}>
          <div className="col" style={{ gap: 6 }}><h2>Create your workspace</h2><span className="text2">Free for up to 3 members. You’ll invite your team next.</span></div>
          <div className="grid form-2col">
            <Field label="Full name" id="su-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            <Field label="Work email" id="su-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Field label="Company" id="su-co" autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} />
            <div className="field"><label htmlFor="su-size">Developers</label><select id="su-size" className="input" value={size} onChange={(e) => setSize(e.target.value)}><option>1 – 10</option><option>11 – 50</option><option>51 – 200</option><option>200+</option></select></div>
          </div>
          <PasswordField label="Password" id="su-pw" value={pw} onChange={setPw} autoComplete="new-password" />
          <Checklist pw={pw} email={email} />
          <button className="btn btn-primary btn-wide" disabled={busy || !name || !company || !email || !passwordOk(pw, email)}>{busy ? 'Creating…' : 'Create workspace'}</button>
          <span className="muted" style={{ fontSize: 13, textAlign: 'center' }}>We’ll email a 6-digit code to verify your address. By continuing you agree to the Terms and Privacy Policy.</span>
        </form>
      )}
      {step === 'verify' && (
        <form className="col" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <div className="col" style={{ gap: 6 }}><h2>Verify your email</h2><span className="text2">Enter the 6-digit code we sent to <b>{sentTo}</b>. It expires in 10 minutes.</span></div>
          <OtpInput value={code} onChange={setCode} />
          <button className="btn btn-primary btn-wide" disabled={busy || code.length < 6}>Verify and open my workspace</button>
          <button type="button" className="link-btn" onClick={signup}>Send a new code</button>
        </form>
      )}
      {step === 'forgot' && (
        <form className="col" onSubmit={(e) => { e.preventDefault(); forgot(); }}>
          <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={() => go('signin')}><Icon name="back" size={16} />Back to sign in</button>
          <div className="col" style={{ gap: 6 }}><h2>Reset your password</h2><span className="text2">We’ll email a 6-digit code to your work email.</span></div>
          <Field label="Work email" id="fp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn btn-primary btn-wide" disabled={busy || !email}>Email me a code</button>
        </form>
      )}
      {step === 'otp' && (
        <form className="col" onSubmit={(e) => { e.preventDefault(); checkCode(); }}>
          <div className="col" style={{ gap: 6 }}><h2>Check your email</h2><span className="text2">Enter the 6-digit code we sent to <b>{sentTo}</b>. It expires in 10 minutes.</span></div>
          <OtpInput value={code} onChange={setCode} />
          <button className="btn btn-primary btn-wide" disabled={busy || code.length < 6}>Verify code</button>
          <div className="between" style={{ fontSize: 14 }}><button type="button" className="link-btn" onClick={() => forgot()}>Resend code</button><button type="button" className="link-btn" onClick={() => forgot(true)}>Send to backup email instead</button></div>
        </form>
      )}
      {step === 'newpw' && (
        <form className="col" onSubmit={(e) => { e.preventDefault(); reset(); }}>
          <span className="pill pill-ok" style={{ alignSelf: 'flex-start' }}><Icon name="check" size={13} stroke={3} />Code verified</span>
          <div className="col" style={{ gap: 6 }}><h2>Choose a new password</h2><span className="text2">You’ll be signed out on your other devices.</span></div>
          <PasswordField label="New password" id="np-pw" value={pw} onChange={setPw} autoComplete="new-password" />
          <PasswordField label="Confirm password" id="np-pw2" value={pw2} onChange={setPw2} autoComplete="new-password" />
          <Checklist pw={pw} email={email} />
          {pw2 && pw !== pw2 && <span className="error-text">The passwords don’t match.</span>}
          <button className="btn btn-primary btn-wide" disabled={busy || !passwordOk(pw, email) || pw !== pw2}>Save new password</button>
        </form>
      )}
      {step === 'accept' && (
        <form className="col" onSubmit={(e) => { e.preventDefault(); accept(); }}>
          <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={() => go('signin')}><Icon name="back" size={16} />Back to sign in</button>
          <div className="col" style={{ gap: 6 }}><h2>Set your password</h2><span className="text2">Enter the invite code from your email and choose a password.</span></div>
          <Field label="Work email" id="ac-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field label="Invite code" id="ac-code" placeholder="K7Q2-M9XD" value={invite} onChange={(e) => setInvite(e.target.value)} />
          <PasswordField label="New password" id="ac-pw" value={pw} onChange={setPw} autoComplete="new-password" />
          <Checklist pw={pw} email={email} />
          <button className="btn btn-primary btn-wide" disabled={busy || !email || !invite || !passwordOk(pw, email)}>Create password and sign in</button>
        </form>
      )}
    </AuthLayout>
  );
}
