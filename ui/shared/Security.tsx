import { useState } from 'react';
import { Card, Checklist, Field, Modal, OtpInput, PasswordField, Pill, passwordOk } from './ui';
import { Icon } from './icons';
import { ago, date } from './format';
import { useAsync } from './hooks';

export type Call = (path: string, opts?: { method?: string; body?: unknown }) => Promise<any>;

export default function Security({ call, toast, devicesLabel = 'Signed-in devices' }: { call: Call; toast: (t: string) => void; devicesLabel?: string }) {
  const me = useAsync(() => call('/me'), []);
  const devices = useAsync(() => call('/me/devices'), []);
  const [pwOpen, setPwOpen] = useState(false);
  const [backup, setBackup] = useState('');
  const [backupSent, setBackupSent] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [err, setErr] = useState('');
  if (me.error) return <div className="banner banner-no">{me.error}</div>;
  if (!me.data) return <Card><span className="muted">Loading account…</span></Card>;
  const u = me.data.user;
  const initials = (u.name || u.email).split(/\s+/).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  const run = async (fn: () => Promise<void>) => { setErr(''); try { await fn(); } catch (e: any) { setErr(e.message); } };
  return (
    <Card title="Account and security" sub="Your sign-in details. Password changes need a code from your email.">
      {err && <div className="banner banner-no">{err}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 18, borderBottom: '1px solid var(--border)' }}>
        <span className="avatar avatar-gold" style={{ width: 60, height: 60, fontSize: 20 }}>{initials}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}><span style={{ fontSize: 18, fontWeight: 800, overflowWrap: 'anywhere' }}>{u.name || u.email}</span><span className="text2" style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{u.email} · {u.role === 'admin' ? 'Admin' : 'Member'}, {me.data.org.name}</span></div>
      </div>
      <div className="between" style={{ paddingBottom: 18, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 320px' }}><b>Password</b><span className="text2" style={{ fontSize: 14 }}>Last changed {u.passwordChangedAt ? date(u.passwordChangedAt) : 'never'}. We’ll email a 6-digit code to confirm any change.</span></div>
        <button className="btn btn-secondary" onClick={() => setPwOpen(true)}><Icon name="lock" size={16} />Change password</button>
      </div>
      <div className="col" style={{ gap: 12, paddingBottom: 18, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><b>Backup email</b><span className="text2" style={{ fontSize: 14 }}>Used for reset codes if you can’t reach your work inbox.</span></div>
        {u.backupEmail && u.backupVerified ? (
          <div className="between" style={{ padding: 14, borderRadius: 14, background: 'var(--inset)' }}>
            <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, minWidth: 0 }}><b style={{ overflowWrap: 'anywhere' }}>{u.backupEmail}</b><Pill kind="ok"><Icon name="check" size={13} stroke={3} />Verified</Pill></span>
            <button className="btn btn-danger-outline btn-sm" onClick={() => run(async () => { await call('/me/backup-email', { method: 'DELETE' }); me.reload(); toast('Backup email removed'); })}>Remove</button>
          </div>
        ) : backupSent ? (
          <form className="col" onSubmit={(e) => { e.preventDefault(); run(async () => { await call('/me/backup-email/verify', { body: { code: backupCode } }); setBackupSent(''); setBackupCode(''); me.reload(); toast('Backup email verified'); }); }}>
            <span className="text2" style={{ fontSize: 14 }}>Enter the code we sent to <b>{backupSent}</b>.</span>
            <OtpInput value={backupCode} onChange={setBackupCode} />
            <div className="row" style={{ gap: 10 }}><button className="btn btn-primary" disabled={backupCode.length < 6}>Verify backup email</button><button type="button" className="btn btn-ghost" onClick={() => setBackupSent('')}>Use a different email</button></div>
          </form>
        ) : (
          <form className="row" style={{ alignItems: 'flex-end', gap: 12 }} onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await call('/me/backup-email', { body: { email: backup } }); setBackupSent(r.sentTo); }); }}>
            <div style={{ flex: '1 1 280px' }}><Field label="Backup email address" id="bk-email" type="email" placeholder="you@personal.com" value={backup} onChange={(e) => setBackup(e.target.value)} /></div>
            <button className="btn btn-primary" disabled={!backup.includes('@')}>Send verification code</button>
          </form>
        )}
      </div>
      {/* "Ask for a code on new devices" is hidden until sign-in actually enforces it (QA MEM-02). */}
      <div className="col" style={{ gap: 10 }}>
        <b>{devicesLabel}</b>
        {(devices.data ?? []).map((d: any) => (
          <div key={d.id} className="between" style={{ padding: 14, borderRadius: 14, border: '1px solid var(--border)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}><span className="text2" style={{ display: 'inline-flex', flex: 'none' }}><Icon name="device" size={20} /></span><span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflowWrap: 'anywhere' }}><b style={{ fontSize: 14 }}>{d.name}{d.os ? ' · ' + d.os : ''}</b><span className="muted" style={{ fontSize: 13 }}>{d.kind === 'desktop' ? 'Desktop app' : 'Browser'} · last active {ago(d.lastSeen)}</span></span></span>
            {d.current ? <Pill kind="accent">This device</Pill> : <button className="btn btn-danger-outline btn-sm" onClick={() => run(async () => { await call(`/me/devices/${d.id}`, { method: 'DELETE' }); devices.reload(); toast('Device signed out'); })}>Sign out</button>}
          </div>
        ))}
      </div>
      {pwOpen && <PasswordModal call={call} email={u.email} onClose={() => setPwOpen(false)} onDone={() => { setPwOpen(false); me.reload(); devices.reload(); toast('Password changed. Other devices were signed out.'); }} />}
    </Card>
  );
}

function PasswordModal({ call, email, onClose, onDone }: { call: Call; email: string; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <Modal title={step === 1 ? 'Change your password' : 'Enter the code from your email'} kicker={step === 1 ? 'STEP 1 OF 2' : 'STEP 2 OF 2'} onClose={onClose}>
      {err && <div className="banner banner-no">{err}</div>}
      {step === 1 ? (
        <form className="col" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await call('/me/password/start', { body: { current: cur, new: pw } }); setSent(r.sentTo); setStep(2); }); }}>
          <PasswordField label="Current password" id="pw-cur" value={cur} onChange={setCur} />
          <PasswordField label="New password" id="pw-new" value={pw} onChange={setPw} autoComplete="new-password" />
          <PasswordField label="Confirm new password" id="pw-new2" value={pw2} onChange={setPw2} autoComplete="new-password" />
          <Checklist pw={pw} email={email} />
          {pw2 && pw !== pw2 && <span className="error-text">The passwords don’t match.</span>}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !cur || !passwordOk(pw, email) || pw !== pw2}>Continue</button></div>
        </form>
      ) : (
        <form className="col" onSubmit={(e) => { e.preventDefault(); run(async () => { await call('/me/password/confirm', { body: { code } }); onDone(); }); }}>
          <span className="text2">We sent a 6-digit code to <b>{sent}</b>. Enter it to confirm the change.</span>
          <OtpInput value={code} onChange={setCode} />
          <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}><button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>Back</button><button className="btn btn-primary" disabled={busy || code.length < 6}>Verify and change password</button></div>
        </form>
      )}
    </Modal>
  );
}
