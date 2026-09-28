import { useCallback, useEffect, useState } from 'react';
import { api, fetchPhotoUrl } from './api.js';

const mapLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

// A record only carries punctuality data once the site has shift timing joined in.
// Auto-marked 'absent' rows have no real check-in time, so they're excluded —
// there's nothing to judge as on-time or late.
function punctuality(r) {
  if (r.status === 'absent') return null;
  if (r.late_minutes === undefined || r.late_minutes === null) return null;
  const over = r.late_minutes - (r.grace_minutes || 0);
  return over > 0 ? { late: true, text: `Late by ${over}m` } : { late: false, text: 'On time' };
}

function PunctualityBadge({ record }) {
  const p = punctuality(record);
  if (!p) return null;
  return <span className={`pill ${p.late ? 'late' : 'ontime'}`}>{p.text}</span>;
}

function Photo({ id, className = 'thumb' }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    let objUrl;
    fetchPhotoUrl(id)
      .then((u) => {
        objUrl = u;
        if (alive) setUrl(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [id]);
  return url ? <img className={className} src={url} alt="Check-in snap" /> : <div className={`${className} ph`} />;
}

function RecordModal({ record, busy, onApprove, onRevoke, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <Photo id={record.id} className="modal-photo" />
        <div className="modal-body">
          <div className="row">
            <h2>{record.employee_name}</h2>
            <span className="badges">
              <span className={`pill ${record.status}`}>{record.status}</span>
              <PunctualityBadge record={record} />
            </span>
          </div>
          <p className="muted small">{record.email}</p>
          <p className="small">
            {new Date(record.work_date).toLocaleDateString()}
            {record.status !== 'absent' && ` · ${new Date(record.submitted_at).toLocaleTimeString()}`}
          </p>
          {record.status === 'absent' ? (
            <p className="small">{record.site_name} · no check-in was received today</p>
          ) : (
            <>
              <p className="small">
                {record.site_name} · {Math.round(record.distance_m)} m from centre (limit {record.radius_meters} m)
              </p>
              <a className="small" href={mapLink(record.latitude, record.longitude)} target="_blank" rel="noreferrer">
                View captured location ↗
              </a>
            </>
          )}
          {record.checkout_at && (
            <p className="muted small">Shift ended {new Date(record.checkout_at).toLocaleTimeString()}</p>
          )}
          {record.note && <p className="muted small">{record.note}</p>}
          {record.revoke_reason && <p className="muted small">Reason: {record.revoke_reason}</p>}
          <div className="actions">
            {record.status !== 'approved' && (
              <button className="btn primary" disabled={busy} onClick={() => onApprove(record)}>
                {record.status === 'absent' ? 'Mark present (override)' : record.status === 'revoked' ? 'Re-approve' : 'Approve'}
              </button>
            )}
            {record.status !== 'revoked' && record.status !== 'absent' && (
              <button className="btn danger" disabled={busy} onClick={() => onRevoke(record)}>
                Revoke
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Attendance() {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [date, setDate] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setRows(await api.attendance({ status: filter === 'all' ? '' : filter, date }));
  }, [filter, date]);

  useEffect(() => {
    load().catch((e) => setMsg({ type: 'error', text: e.message }));
  }, [load]);

  const act = async (fn, okText, { closeModal = true } = {}) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ type: 'ok', text: typeof okText === 'function' ? okText(r) : okText });
      if (closeModal) setSelected(null);
      await load();
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const pendingCount = rows.filter((r) => r.status === 'pending').length;

  const approveAll = () => {
    if (!window.confirm(`Approve all pending attendance${date ? ` for ${date}` : ''}?`)) return;
    act(() => api.approveAll(date || undefined), (r) => `Approved ${r.approved} record(s).`, { closeModal: false });
  };

  const approveOne = (r) => act(() => api.approve(r.id), 'Approved.');

  const revoke = (r) => {
    const reason = window.prompt(`Revoke ${r.employee_name}'s attendance? Optional reason:`, '');
    if (reason === null) return;
    act(() => api.revoke(r.id, reason), 'Attendance revoked.');
  };

  return (
    <section>
      <div className="toolbar">
        <div className="tabs">
          {['pending', 'approved', 'revoked', 'absent', 'all'].map((s) => (
            <button key={s} className={`tab ${filter === s ? 'on' : ''}`} onClick={() => setFilter(s)}>
              {s}
            </button>
          ))}
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn primary" disabled={busy || pendingCount === 0} onClick={approveAll}>
          Approve all{pendingCount ? ` (${pendingCount})` : ''}
        </button>
      </div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      {rows.length === 0 ? (
        <p className="muted">No records.</p>
      ) : (
        <ul className="list card rec-list">
          {rows.map((r) => (
            <li key={r.id} className="rec-row" onClick={() => setSelected(r)}>
              <Photo id={r.id} className="rec-thumb" />
              <div className="rec-row-main">
                <div className="row">
                  <strong>{r.employee_name}</strong>
                  <span className="badges">
                    <span className={`pill ${r.status}`}>{r.status}</span>
                    <PunctualityBadge record={r} />
                  </span>
                </div>
                <div className="muted small">
                  {new Date(r.work_date).toLocaleDateString()}
                  {r.status === 'absent'
                    ? ` · ${r.site_name} · no check-in`
                    : ` · ${new Date(r.submitted_at).toLocaleTimeString()} · ${r.site_name} · ${Math.round(r.distance_m)} m`}
                </div>
              </div>
              <span className="chevron" aria-hidden="true">›</span>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <RecordModal
          record={selected}
          busy={busy}
          onApprove={approveOne}
          onRevoke={revoke}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

function Sites() {
  const empty = { name: '', address: '', latitude: '', longitude: '', radius_meters: 150, shift_start: '09:00', grace_minutes: 10 };
  const [sites, setSites] = useState([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => setSites(await api.sites()), []);
  useEffect(() => {
    load();
  }, [load]);

  const useMyLocation = () =>
    navigator.geolocation.getCurrentPosition(
      (p) => setForm((f) => ({ ...f, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) })),
      () => setMsg({ type: 'error', text: 'Could not read your location.' })
    );

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editing) await api.updateSite(editing, form);
      else await api.createSite(form);
      setForm(empty);
      setEditing(null);
      setMsg({ type: 'ok', text: 'Site saved.' });
      load();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <section>
      <form className="card form" onSubmit={save}>
        <h2>{editing ? 'Edit site' : 'Add site'}</h2>
        <input placeholder="Site name" value={form.name} onChange={set('name')} required />
        <input placeholder="Address (optional)" value={form.address || ''} onChange={set('address')} />
        <div className="row2">
          <input placeholder="Latitude" value={form.latitude} onChange={set('latitude')} required />
          <input placeholder="Longitude" value={form.longitude} onChange={set('longitude')} required />
        </div>
        <button type="button" className="btn ghost" onClick={useMyLocation}>Use my current location</button>
        <label>Allowed radius (metres)</label>
        <input type="number" min="10" value={form.radius_meters} onChange={set('radius_meters')} required />
        <div className="row2">
          <div>
            <label>Shift start time</label>
            <input type="time" value={form.shift_start} onChange={set('shift_start')} required />
          </div>
          <div>
            <label>Grace period (minutes)</label>
            <input type="number" min="0" max="240" value={form.grace_minutes} onChange={set('grace_minutes')} required />
          </div>
        </div>
        <p className="muted small">
          Check-ins after shift start + grace period are marked late for punctuality tracking.
        </p>
        <label>Auto-mark absent after (minutes past shift start)</label>
        <input
          type="number"
          min="0"
          max="720"
          placeholder="Leave blank to disable"
          value={form.auto_absent_minutes ?? ''}
          onChange={set('auto_absent_minutes')}
        />
        <p className="muted small">
          If nobody checks in by shift start + this many minutes, the system automatically marks that
          employee absent for the day. Leave blank to turn this off.
        </p>
        <div className="actions">
          <button className="btn primary">{editing ? 'Update' : 'Add site'}</button>
          {editing && <button type="button" className="btn ghost" onClick={() => { setEditing(null); setForm(empty); }}>Cancel</button>}
        </div>
      </form>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      <ul className="list card">
        {sites.map((s) => (
          <li key={s.id}>
            <span>
              <strong>{s.name}</strong>
              <span className="muted small">
                {' '}
                · {s.radius_meters} m · {s.latitude.toFixed(4)}, {s.longitude.toFixed(4)} · shift {s.shift_start?.slice(0, 5)}
                {s.grace_minutes ? ` (+${s.grace_minutes}m grace)` : ''}
                {s.auto_absent_minutes ? ` · auto-absent after ${s.auto_absent_minutes}m` : ''}
              </span>
            </span>
            <button
              className="btn ghost"
              onClick={() => { setEditing(s.id); setForm({ ...s, shift_start: s.shift_start?.slice(0, 5) || '09:00', auto_absent_minutes: s.auto_absent_minutes ?? '' }); }}
            >
              Edit
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatCard({ label, value, tone }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function EmployeeHistoryModal({ employee, onClose }) {
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(
    () => api.attendance({ employee_id: employee.id }).then(setRows),
    [employee.id]
  );

  useEffect(() => {
    load().catch((e) => setMsg({ type: 'error', text: e.message }));
  }, [load]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !selected && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, selected]);

  const act = async (fn, okText) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ type: 'ok', text: okText });
      setSelected(null);
      await load();
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };
  const approveOne = (r) => act(() => api.approve(r.id), 'Approved.');
  const revoke = (r) => {
    const reason = window.prompt(`Revoke this day's attendance? Optional reason:`, '');
    if (reason === null) return;
    act(() => api.revoke(r.id, reason), 'Attendance revoked.');
  };

  const total = rows?.length || 0;
  const approved = rows?.filter((r) => r.status === 'approved').length || 0;
  const revoked = rows?.filter((r) => r.status === 'revoked').length || 0;
  const pending = rows?.filter((r) => r.status === 'pending').length || 0;
  const absent = rows?.filter((r) => r.status === 'absent').length || 0;
  const withDistance = rows?.filter((r) => r.distance_m !== null && r.distance_m !== undefined) || [];
  const avgDistance = withDistance.length
    ? Math.round(withDistance.reduce((sum, r) => sum + Number(r.distance_m), 0) / withDistance.length)
    : null;
  const approvalRate = total ? Math.round((approved / total) * 100) : null;
  const withPunctuality = rows?.filter((r) => punctuality(r)) || [];
  const lateCount = withPunctuality.filter((r) => punctuality(r).late).length;
  const onTimeRate = withPunctuality.length
    ? Math.round(((withPunctuality.length - lateCount) / withPunctuality.length) * 100)
    : null;

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal wide" onClick={(e) => e.stopPropagation()}>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
          <div className="modal-body">
            <h2>{employee.name}</h2>
            <p className="muted small">{employee.email} · {employee.site_name || 'No site assigned'}</p>

            {rows && (
              <div className="stat-row">
                <StatCard label="Total check-ins" value={total} />
                <StatCard label="Approved" value={approved} tone="ok" />
                <StatCard label="Pending" value={pending} tone="warn" />
                <StatCard label="Revoked" value={revoked} tone="bad" />
                <StatCard label="Absent" value={absent} tone={absent ? 'bad' : undefined} />
                <StatCard label="Approval rate" value={approvalRate !== null ? `${approvalRate}%` : '—'} />
                <StatCard label="Avg. distance" value={avgDistance !== null ? `${avgDistance} m` : '—'} />
                <StatCard label="On-time rate" value={onTimeRate !== null ? `${onTimeRate}%` : '—'} tone={onTimeRate !== null && onTimeRate < 80 ? 'bad' : 'ok'} />
                <StatCard label="Late days" value={lateCount} tone={lateCount ? 'warn' : undefined} />
              </div>
            )}

            {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

            <h2 className="section-title">Day-by-day history</h2>
            {!rows ? (
              <p className="muted">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="muted">No attendance recorded yet.</p>
            ) : (
              <ul className="list rec-list plain">
                {rows.map((r) => (
                  <li key={r.id} className="rec-row" onClick={() => setSelected(r)}>
                    <Photo id={r.id} className="rec-thumb" />
                    <div className="rec-row-main">
                      <div className="row">
                        <strong>{new Date(r.work_date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
                        <span className="badges">
                          <span className={`pill ${r.status}`}>{r.status}</span>
                          <PunctualityBadge record={r} />
                        </span>
                      </div>
                      <div className="muted small">
                        {r.status === 'absent'
                          ? 'No check-in received'
                          : `${new Date(r.submitted_at).toLocaleTimeString()} · ${Math.round(r.distance_m)} m from centre`}
                      </div>
                    </div>
                    <span className="chevron" aria-hidden="true">›</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {selected && (
        <RecordModal
          record={selected}
          busy={busy}
          onApprove={approveOne}
          onRevoke={revoke}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function ShiftOverrideModal({ employee, onClose, onSaved }) {
  const [shiftStart, setShiftStart] = useState(employee.shift_start?.slice(0, 5) || '');
  const [grace, setGrace] = useState(employee.grace_minutes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const siteDefault = employee.site_shift_start
    ? `${employee.site_shift_start.slice(0, 5)} (+${employee.site_grace_minutes ?? 0}m grace)`
    : 'no site assigned';

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.updateEmployee(employee.id, {
        shift_start: shiftStart || '',
        grace_minutes: grace === '' ? '' : Number(grace),
      });
      onSaved();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const useDefault = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.updateEmployee(employee.id, { shift_start: '', grace_minutes: '' });
      onSaved();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="modal-body">
          <h2>Shift timing — {employee.name}</h2>
          <p className="muted small">Site default: {siteDefault}</p>
          {err && <div className="alert error">{err}</div>}
          <label>Custom shift start (leave blank to use site default)</label>
          <input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} />
          <label>Custom grace period, minutes (leave blank to use site default)</label>
          <input type="number" min="0" max="240" value={grace} onChange={(e) => setGrace(e.target.value)} />
          <div className="actions">
            <button className="btn primary" disabled={busy}>Save</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={useDefault}>
              Clear override
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Employees() {
  const empty = { name: '', email: '', password: '', site_id: '' };
  const [emps, setEmps] = useState([]);
  const [sites, setSites] = useState([]);
  const [form, setForm] = useState(empty);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const [e, s] = await Promise.all([api.employees(), api.sites()]);
    setEmps(e);
    setSites(s);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.createEmployee({ ...form, site_id: form.site_id ? Number(form.site_id) : null });
      setForm(empty);
      setMsg({ type: 'ok', text: 'Employee added.' });
      load();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const assign = async (id, siteId) => {
    await api.updateEmployee(id, { site_id: siteId ? Number(siteId) : null });
    load();
  };
  const toggle = async (emp) => {
    await api.updateEmployee(emp.id, { active: !emp.active });
    load();
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const [historyFor, setHistoryFor] = useState(null);
  const [shiftFor, setShiftFor] = useState(null);
  const [showShiftFields, setShowShiftFields] = useState(false);

  return (
    <section>
      <form className="card form" onSubmit={add}>
        <h2>Add employee</h2>
        <input placeholder="Full name" value={form.name} onChange={set('name')} required />
        <input type="email" placeholder="Email" value={form.email} onChange={set('email')} required />
        <input type="password" placeholder="Temporary password (min 6)" value={form.password} onChange={set('password')} minLength={6} required />
        <select value={form.site_id} onChange={set('site_id')}>
          <option value="">No site yet</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {!showShiftFields ? (
          <button type="button" className="btn ghost" onClick={() => setShowShiftFields(true)}>
            + Custom shift timing for this employee (optional)
          </button>
        ) : (
          <div className="row2">
            <div>
              <label>Custom shift start</label>
              <input type="time" value={form.shift_start || ''} onChange={set('shift_start')} />
            </div>
            <div>
              <label>Custom grace (minutes)</label>
              <input type="number" min="0" max="240" value={form.grace_minutes || ''} onChange={set('grace_minutes')} />
            </div>
          </div>
        )}
        <button className="btn primary">Add employee</button>
      </form>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      <ul className="list card">
        {emps.map((e) => (
          <li key={e.id}>
            <span className="emp-name" onClick={() => setHistoryFor(e)}>
              <strong>{e.name}</strong> <span className="muted small">{e.email}</span>
              {!e.active && <span className="pill revoked">inactive</span>}
              <span className="muted small">
                {' '}
                · shift {e.shift_start ? `${e.shift_start.slice(0, 5)} (custom)` : e.site_shift_start ? `${e.site_shift_start.slice(0, 5)} (default)` : '—'}
              </span>
            </span>
            <span className="row">
              <select value={e.site_id || ''} onChange={(ev) => assign(e.id, ev.target.value)}>
                <option value="">No site</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className="btn ghost" onClick={() => setShiftFor(e)}>Shift</button>
              <button className="btn ghost" onClick={() => setHistoryFor(e)}>History</button>
              <button className="btn ghost" onClick={() => toggle(e)}>{e.active ? 'Deactivate' : 'Activate'}</button>
            </span>
          </li>
        ))}
      </ul>

      {historyFor && <EmployeeHistoryModal employee={historyFor} onClose={() => setHistoryFor(null)} />}
      {shiftFor && (
        <ShiftOverrideModal
          employee={shiftFor}
          onClose={() => setShiftFor(null)}
          onSaved={() => { setShiftFor(null); load(); }}
        />
      )}
    </section>
  );
}

export default function Admin() {
  const [tab, setTab] = useState('attendance');
  return (
    <main className="page wide">
      <nav className="tabs main">
        {[['attendance', 'Attendance'], ['sites', 'Sites'], ['employees', 'Employees']].map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </nav>
      {tab === 'attendance' && <Attendance />}
      {tab === 'sites' && <Sites />}
      {tab === 'employees' && <Employees />}
    </main>
  );
}