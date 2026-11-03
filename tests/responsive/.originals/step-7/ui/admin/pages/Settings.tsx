import { useEffect, useState } from 'react';
import { api, auth, download } from '../api';
import { useAsync } from '../../shared/hooks';
import { Card, Field, Modal, OtpInput, Pill, TableScroll } from '../../shared/ui';
import Security from '../../shared/Security';
import { Icon } from '../../shared/icons';
import { ago, date, usd } from '../../shared/format';
import type { Ctx } from '../main';

const TZS = ['UTC', 'Asia/Kolkata', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney'];
const PLANS = [{ id: 'starter', name: 'Starter', note: 'Free, up to 3 members' }, { id: 'team', name: 'Team', note: '$9 per member / month, annual' }, { id: 'business', name: 'Business', note: '$18 per member / month, annual' }, { id: 'enterprise', name: 'Enterprise', note: 'Custom contract' }];

export default function Settings({ ctx, onSignedOut }: { ctx: Ctx; onSignedOut: () => void }) {
  const org = useAsync(() => api('/admin/org'), []);
  const bill = useAsync(() => api('/admin/billing'), []);
  const [name, setName] = useState('');
  const [tz, setTz] = useState('UTC');
  const [seats, setSeats] = useState<null | { seats: string; plan: string }>(null);
  const [del, setDel] = useState<null | { sent: string; code: string }>(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { if (org.data) { setName(org.data.name); setTz(org.data.timezone); } }, [org.data]);
  const call = (p: string, o?: any) => api(p, o);

  return (
    <>
      <nav aria-label="Settings sections" className="row" style={{ gap: 8 }}>
        {[['security', 'Account and security', 'lock'], ['org', 'Organization', 'users'], ['billing', 'Plan and billing', 'card'], ['data', 'Data', 'db']].map(([id, l, i], k) => (
          <a key={id} href={`#/settings`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); }} className={'btn ' + (k === 0 ? 'btn-primary' : 'btn-secondary')} style={{ borderRadius: 999 }}><Icon name={i} size={16} />{l}</a>
        ))}
      </nav>
      <div id="security"><Security call={call} toast={ctx.toast} /></div>

      <div id="org"><Card title="Organization" sub="Shown in invitations and emails">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          <Field label="Organization name" id="org-name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="field"><label htmlFor="org-tz">Time zone for reports</label><select id="org-tz" className="input" value={tz} onChange={(e) => setTz(e.target.value)}>{[...new Set([tz, ...TZS])].map((z) => <option key={z}>{z}</option>)}</select></div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={async () => { try { org.setData(await api('/admin/org', { method: 'PUT', body: { name, timezone: tz } })); ctx.toast('Organization saved'); } catch (e: any) { ctx.toast(e.message); } }}>Save organization</button></div>
        <div className="col" style={{ gap: 10 }}><b>Admins</b>
          {(org.data?.admins ?? []).map((a: any) => (
            <div key={a.id} className="between" style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid var(--border)' }}>
              <span style={{ display: 'flex', flexDirection: 'column' }}><b style={{ fontSize: 14 }}>{a.name}{a.self ? ' (you)' : ''}</b><span className="muted" style={{ fontSize: 13 }}>{a.email}</span></span>
              <Pill kind={a.self ? 'gold' : 'neutral'}>{a.status === 'invited' ? 'Invite pending' : 'Admin'}</Pill>
            </div>
          ))}
          <span className="muted" style={{ fontSize: 13 }}>To add an admin, invite them from Members with the Admin role, or change an existing member’s role.</span>
        </div>
      </Card></div>

      <div id="billing"><Card title="Plan and billing" sub="Your subscription, seats, and invoices">
        {bill.data && (
          <div className="row">
            <div className="card gold-card" style={{ flex: '2 1 420px', boxShadow: 'none' }}>
              <div className="between" style={{ alignItems: 'flex-start' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.08em', color: 'var(--gold)' }}>CURRENT PLAN</span><span className="display" style={{ fontSize: 34, fontWeight: 600 }}>{PLANS.find((p) => p.id === bill.data.plan)?.name}</span></span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}><span className="mono" style={{ fontSize: 28 }}>{usd(bill.data.monthly, 0)}<span className="muted" style={{ fontSize: 15 }}> / month</span></span><span className="text2" style={{ fontSize: 13 }}>{usd(bill.data.pricePerSeat, 0)} × {bill.data.seats} seats, billed {bill.data.period}</span></span>
              </div>
              <div className="col" style={{ gap: 8 }}><div className="between" style={{ fontSize: 14 }}><b>Seats</b><span className="mono">{bill.data.used} of {bill.data.seats} used</span></div><div className="meter" style={{ height: 10, background: 'var(--bg)' }}><div style={{ width: Math.min(100, (bill.data.used / bill.data.seats) * 100) + '%', background: 'var(--gold)' }} /></div></div>
              <span className="text2" style={{ fontSize: 14 }}>{bill.data.renewsOn ? `Renews ${date(bill.data.renewsOn)}.` : 'No renewal date set.'} Seats added mid-term are prorated.</span>
              <div className="row" style={{ gap: 10 }}><button className="btn btn-primary" onClick={() => setSeats({ seats: String(bill.data.seats), plan: bill.data.plan })}><Icon name="users" size={16} />Change plan or seats</button><a className="btn btn-ghost" href={(import.meta.env.VITE_LANDING_URL ?? '/') + '#pricing'} target="_blank" rel="noreferrer">Compare plans <Icon name="ext" size={14} /></a></div>
            </div>
            <div className="col" style={{ flex: '1 1 280px' }}>
              <div className="card" style={{ boxShadow: 'none', gap: 10 }}><b>Payment method</b>
                <span className="text2" style={{ fontSize: 14 }}>{bill.data.paymentsConfigured ? 'Card on file.' : 'Online card payments aren’t connected yet. Invoices are issued manually; contact billing@aknologia.com.'}</span></div>
              <div className="card" style={{ boxShadow: 'none', gap: 6 }}><b>Billing details</b><span className="text2" style={{ fontSize: 14 }}>{bill.data.billingDetails || 'Add your legal name, address, and GSTIN by emailing billing@aknologia.com.'}</span><span className="muted" style={{ fontSize: 13 }}>{bill.data.billingEmail}</span></div>
            </div>
          </div>
        )}
        <div className="col" style={{ gap: 8 }}><b>Invoices</b>
          {(bill.data?.invoices ?? []).length === 0 ? <span className="muted" style={{ fontSize: 14 }}>No invoices yet.</span> : (
            <TableScroll label="Invoices" sticky><table className="t" style={{ '--min': '560px' } as React.CSSProperties}><thead><tr><th>Date</th><th>Invoice</th><th>Description</th><th className="r">Amount</th><th>Status</th></tr></thead>
              <tbody>{bill.data.invoices.map((i: any) => <tr key={i.number}><td className="text2">{date(i.date)}</td><td className="mono">{i.number}</td><td>{i.description}</td><td className="r mono">{usd(i.amount)}</td><td><Pill kind="ok">{i.status}</Pill></td></tr>)}</tbody></table></TableScroll>
          )}
        </div>
      </Card></div>

      <div id="data"><Card title="Data" sub="Your usage database and exports">
        <div className="banner" style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-line)' }}>
          <span className="logo" style={{ width: 52, height: 52, borderRadius: 14, fontSize: 0 }}><Icon name="db" size={24} color="#fff" /></span>
          <span style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 3 }}><b style={{ color: 'var(--text)' }}>Refresh from database</b><span className="text2" style={{ fontSize: 14 }}>Reloads the latest synced usage from Postgres and recomputes daily totals and budget status.</span></span>
          <button className="btn btn-primary" disabled={refreshing} onClick={async () => { setRefreshing(true); try { const r = await api('/admin/refresh', { body: {} }); ctx.toast(`Refreshed ${r.events.toLocaleString()} events in ${r.tookMs} ms (${ago(r.refreshedAt)})`); } catch (e: any) { ctx.toast(e.message); } finally { setRefreshing(false); } }}><Icon name="sync" size={16} />{refreshing ? 'Refreshing…' : 'Refresh now'}</button>
        </div>
        <div className="between" style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}><span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><b>Export usage</b><span className="text2" style={{ fontSize: 14 }}>Daily totals per member as CSV, for the last month.</span></span><button className="btn btn-secondary" onClick={() => download('/admin/export.csv', 'aknologia-usage.csv').catch((e) => ctx.toast(e.message))}><Icon name="ext" size={16} />Export CSV</button></div>
        <div className="between" style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}><span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><b>Retention</b><span className="text2" style={{ fontSize: 14 }}>Raw events are kept 90 days; daily totals for 24 months on paid plans.</span></span><span className="mono text2">90 d / 24 mo</span></div>
        <div className="banner banner-no">
          <span style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 3 }}><b>Delete all organization usage data</b><span style={{ fontSize: 14 }}>Permanently removes every member’s usage. Needs a code from your email.</span></span>
          <button className="btn btn-danger" onClick={async () => { try { const r = await api('/admin/data/delete/start', { body: {} }); setDel({ sent: r.sentTo, code: '' }); } catch (e: any) { ctx.toast(e.message); } }}>Delete data</button>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-danger-outline" onClick={async () => { try { await api('/auth/logout', { body: {} }); } catch { /* ignore */ } auth.set(null); onSignedOut(); }}><Icon name="logout" size={16} />Sign out</button></div>
      </Card></div>

      {seats && (
        <Modal title="Change plan or seats" onClose={() => setSeats(null)}>
          <div className="field"><label htmlFor="pl">Plan</label><select id="pl" className="input" value={seats.plan} onChange={(e) => setSeats({ ...seats, plan: e.target.value })}>{PLANS.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.note}</option>)}</select></div>
          <Field label="Seats" id="st" inputMode="numeric" value={seats.seats} onChange={(e) => setSeats({ ...seats, seats: e.target.value.replace(/\D/g, '') })} hint="At least the number of members plus pending invites." />
          <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}><button className="btn btn-secondary" onClick={() => setSeats(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={async () => { try { bill.setData(await api('/admin/billing/seats', { body: { seats: parseInt(seats.seats, 10), plan: seats.plan } })); setSeats(null); ctx.toast('Plan updated'); } catch (e: any) { ctx.toast(e.message); } }}>Save</button></div>
        </Modal>
      )}
      {del && (
        <Modal title="Confirm deleting all usage data" onClose={() => setDel(null)} alert>
          <span className="text2">Enter the code we sent to <b>{del.sent}</b>. This can’t be undone.</span>
          <OtpInput value={del.code} onChange={(c) => setDel({ ...del, code: c })} />
          <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}><button className="btn btn-secondary" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn btn-danger" disabled={del.code.length < 6} onClick={async () => { try { await api('/admin/data/delete/confirm', { body: { code: del.code } }); setDel(null); ctx.toast('All usage data deleted'); } catch (e: any) { ctx.toast(e.message); } }}>Delete permanently</button></div>
        </Modal>
      )}
    </>
  );
}
