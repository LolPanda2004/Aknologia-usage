import { useState } from 'react';
import { agent } from '../api';
import { AuthLayout, Checklist, Field, Modal, OtpInput, PasswordField, Stepper, Tabs, passwordOk } from '../../shared/ui';
import { Icon } from '../../shared/icons';
import type { Theme } from '../../shared/hooks';

type Step = 'signin' | 'invite' | 'forgot' | 'otp' | 'newpw' | 'removed';
const LANDING = import.meta.env.VITE_LANDING_URL ?? 'https://aknologia.com/';

export default function Auth({ theme, onTheme, status, onSignedIn }: { theme: Theme; onTheme: () => void; status: any; onSignedIn: (s: any) => void }) {
  const [step, setStep] = useState<Step>(status?.removed ? 'removed' : 'signin');
  const [email, setEmail] = useState(status?.email ?? '');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [invite, setInvite] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverOpen, setServerOpen] = useState(false);
  const [serverUrl, setServerUrl] = useState(status?.server ?? '');
  const go = (s: Step) => { setErr(''); setStep(s); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };

  const signin = () => run(async () => onSignedIn(await agent('/auth/login', { body: { email, password: pw } })));
  const accept = () => run(async () => onSignedIn(await agent('/auth/accept-invite', { body: { email, code: invite, password: pw } })));
  const forgot = (useBackup = false) => run(async () => { const r = await agent('/auth/forgot', { body: { email, useBackup } }); setSentTo(r.sentTo); setCode(''); go('otp'); });
  const check = () => run(async () => { await agent('/auth/reset', { body: { email, code } }); setPw(''); setPw2(''); go('newpw'); });
  const reset = () => run(async () => { await agent('/auth/reset', { body: { email, code, password: pw } }); setPw(''); setNote('Password updated. Sign in with your new password.'); go('signin'); });

  return (
    <AuthLayout sub="Desktop app" landing={LANDING} theme={theme} onTheme={onTheme}>
      {(step === 'signin' || step === 'invite') && <Tabs a="Sign in" b="I have an invite" value={step === 'invite' ? 'b' : 'a'} onChange={(v) => go(v === 'a' ? 'signin' : 'invite')} />}
      {(step === 'forgot' || step === 'otp' || step === 'newpw') && <Stepper step={step === 'forgot' ? 0 : step === 'otp' ? 1 : 2} />}
      {note && step === 'signin' && <div className="banner banner-ok" role="status"><Icon name="check" stroke={3} />{note}</div>}
      {err && <div className="banner banner-no" role="alert"><Icon name="alert" />{err}</div>}

      {step === 'signin' && (
        <form className="col" onSubmit={(e) => { e.preventDefault(); signin(); }}>
          <div className="col" style={{ gap: 6 }}><h2>Welcome back</h2><span className="text2">Sign in with the email your admin invited.</span></div>
          <Field label="Work email" id="si-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <PasswordField label="Password" id="si-pw" value={pw} onChange={setPw} />
          <div className="between" style={{ marginTop: -6 }}><button type="button" className="link-btn" style={{ fontWeight: 500, textDecoration: 'none', color: 'var(--muted)' }} onClick={() => setServerOpen(true)}>Server: {status?.server}</button><button type="button" className="link-btn" onClick={() => go('forgot')}>Forgot password?</button></div>
          <button className="btn btn-primary btn-wide" disabled={busy || !email || !pw}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="banner" style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: 16, alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--accent-ink)' }}><Icon name="mail" size={20} /></span>
            <span className="text2" style={{ fontSize: 13, flex: 1 }}><b style={{ color: 'var(--text)', fontSize: 14 }}>First time here?</b>Choose “I have an invite” above and enter the invite code from your email.</span>
          </div>
        </form>
      )}
      {step === 'invite' && (
        <form className="col" onSubmit={(e) => { e.preventDefault(); accept(); }}>
          <div className="col" style={{ gap: 6 }}><h2>Set your password</h2><span className="text2">Use the invite code from your email. You’ll sign in with this password from now on.</span></div>
          <Field label="Work email" id="iv-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field label="Invite code" id="iv-code" placeholder="K7Q2-M9XD" autoComplete="one-time-code" value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())} hint="Eight letters and numbers, from your invitation email." />
          <PasswordField label="New password" id="iv-pw" value={pw} onChange={setPw} autoComplete="new-password" />
          <PasswordField label="Confirm password" id="iv-pw2" value={pw2} onChange={setPw2} autoComplete="new-password" />
          <Checklist pw={pw} email={email} />
          {pw2 && pw !== pw2 && <span className="error-text">The passwords don’t match.</span>}
          <button className="btn btn-primary btn-wide" disabled={busy || !email || invite.length < 8 || !passwordOk(pw, email) || pw !== pw2}>{busy ? 'Setting up…' : 'Create password and sign in'}</button>
        </form>
      )}
      {step === 'forgot' && (
        <form className="col" onSubmit={(e) => { e.preventDefault(); forgot(); }}>
          <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={() => go('signin')}><Icon name="back" size={16} />Back to sign in</button>
          <div className="col" style={{ gap: 6 }}><h2>Reset your password</h2><span className="text2">We’ll email a 6-digit code to your work email, or to your backup email if you’ve added one.</span></div>
          <Field label="Work email" id="fp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn btn-primary btn-wide" disabled={busy || !email}>Email me a code</button>
        </form>
      )}
      {step === 'otp' && (
        <form className="col" onSubmit={(e) => { e.preventDefault(); check(); }}>
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
          <button className="btn btn-primary btn-wide" disabled={busy || !passwordOk(pw, email) || pw !== pw2}>Save new password</button>
        </form>
      )}
      {step === 'removed' && (
        <div className="col">
          <span className="avatar" style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--warn-bg)', color: 'var(--warn-text)' }}><Icon name="lock" size={26} /></span>
          <div className="col" style={{ gap: 8 }}><h2>You’ve been removed from {status?.org || 'your organization'}</h2><span className="text2">Tracking stopped on this device and nothing more is sent. We also emailed you about this.</span></div>
          <div className="card" style={{ boxShadow: 'none', gap: 10 }}>
            <span style={{ display: 'flex', gap: 10 }} className="text2"><Icon name="check" color="var(--green)" />Your local history stays on this device until you uninstall.</span>
            <span style={{ display: 'flex', gap: 10 }} className="text2"><Icon name="check" color="var(--green)" />If you’re re-invited, use the new invite code.</span>
          </div>
          <button className="btn btn-secondary btn-wide" onClick={() => go('invite')}>I have a new invite</button>
        </div>
      )}
      {serverOpen && (
        <Modal title="Server address" onClose={() => setServerOpen(false)}>
          <span className="text2">Your admin will tell you this address. It’s usually the address of your company’s Aknologia workspace.</span>
          <Field label="Server URL" id="srv" type="url" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://usage.yourco.com" />
          <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}><button className="btn btn-secondary" onClick={() => setServerOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={() => run(async () => { await agent('/server', { method: 'PUT', body: { server: serverUrl } }); setServerOpen(false); window.location.reload(); })}>Save</button></div>
        </Modal>
      )}
    </AuthLayout>
  );
}
