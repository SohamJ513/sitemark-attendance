import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const toRad = (d) => (d * Math.PI) / 180;
function distance(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

const STATUS_LABEL = {
  pending: 'Submitted, waiting for admin approval',
  approved: 'Approved. Your attendance is marked.',
  revoked: 'Revoked by admin',
  absent: 'No check-in was received today — you were automatically marked absent.',
};

// A record only carries punctuality data once the site's shift timing is joined in.
// Auto-marked 'absent' days have no real check-in time, so nothing to judge.
function punctuality(r) {
  if (r.status === 'absent') return null;
  if (r.late_minutes === undefined || r.late_minutes === null) return null;
  const over = r.late_minutes - (r.grace_minutes || 0);
  return over > 0 ? { late: true, text: `Late by ${over}m` } : { late: false, text: 'On time' };
}

export default function Employee() {
  const [info, setInfo] = useState(null);
  const [history, setHistory] = useState([]);
  const [pos, setPos] = useState(null);
  const [geoError, setGeoError] = useState('');
  const [camOn, setCamOn] = useState(false);
  const [photo, setPhoto] = useState(null); // { blob, url }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const load = useCallback(async () => {
    const [today, hist] = await Promise.all([api.myToday(), api.myHistory()]);
    setInfo(today);
    setHistory(hist);
  }, []);

  useEffect(() => {
    load().catch((e) => setMsg({ type: 'error', text: e.message }));
  }, [load]);

  // Live GPS while the page is open
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError('This device does not support location.');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGeoError('');
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      (e) => setGeoError(e.code === 1 ? 'Location permission denied. Enable it in browser settings.' : 'Could not get your location.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = async () => {
    setMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1024 } },
        audio: false,
      });
      streamRef.current = stream;
      setCamOn(true);
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
    } catch {
      setMsg({ type: 'error', text: 'Camera access is required to mark attendance. Allow it and try again.' });
    }
  };

  const snap = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(
      (blob) => {
        setPhoto({ blob, url: URL.createObjectURL(blob) });
        stopCamera();
      },
      'image/jpeg',
      0.85
    );
  };

  const endShift = async () => {
    if (!window.confirm('End your shift for today? You will not be able to check in again.')) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.checkout();
      setMsg({ type: 'ok', text: 'Shift ended. Have a good day!' });
      await load();
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!photo || !pos) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append('photo', photo.blob, 'snap.jpg');
      form.append('latitude', pos.lat);
      form.append('longitude', pos.lng);
      form.append('accuracy', pos.accuracy);
      await api.checkIn(form);
      setPhoto(null);
      setMsg({ type: 'ok', text: 'Submitted. Waiting for admin approval.' });
      await load();
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  if (!info) return <main className="page"><p className="muted">Loading…</p></main>;

  const { site, attendance } = info;
  const dist = site && pos ? distance(pos.lat, pos.lng, site.latitude, site.longitude) : null;
  const inRange = dist !== null && dist <= site.radius_meters;
  const canSubmit = !attendance && inRange && photo && !busy;

  return (
    <main className="page">
      {!site ? (
        <div className="alert error">No site is assigned to you yet. Please contact your admin.</div>
      ) : (
        <section className="card">
          <h2>{site.name}</h2>
          {site.address && <p className="muted">{site.address}</p>}
          {site.shift_start && (
            <p className="muted small">
              Shift starts {site.shift_start.slice(0, 5)}
              {site.grace_minutes ? ` (grace period ${site.grace_minutes}m)` : ''}
            </p>
          )}
          <div className={`range ${dist === null ? '' : inRange ? 'in' : 'out'}`}>
            {geoError
              ? geoError
              : dist === null
              ? 'Getting your location…'
              : inRange
              ? `You are on site (${Math.round(dist)} m away, limit ${site.radius_meters} m)`
              : `You are ${Math.round(dist)} m away. Get within ${site.radius_meters} m to check in.`}
          </div>
          {pos && <p className="muted small">GPS accuracy ±{Math.round(pos.accuracy)} m</p>}
        </section>
      )}

      {attendance ? (
        <section className={`card status ${attendance.status}`}>
          <div className="row">
            <h2>Today</h2>
            {punctuality(attendance) && (
              <span className={`pill ${punctuality(attendance).late ? 'late' : 'ontime'}`}>
                {punctuality(attendance).text}
              </span>
            )}
          </div>
          <p>{STATUS_LABEL[attendance.status]}</p>
          {attendance.revoke_reason && <p className="muted">Reason: {attendance.revoke_reason}</p>}
          {attendance.note && <p className="muted small">{attendance.note}</p>}
          {(attendance.status === 'pending' || attendance.status === 'approved') && (
            attendance.checkout_at ? (
              <p className="muted small">Shift ended at {new Date(attendance.checkout_at).toLocaleTimeString()}</p>
            ) : (
              <button className="btn" disabled={busy} onClick={endShift}>
                {busy ? 'Ending shift…' : 'End shift'}
              </button>
            )
          )}
        </section>
      ) : (
        site && (
          <section className="card">
            <h2>Mark attendance</h2>
            {camOn && (
              <div className="cam">
                <video ref={videoRef} autoPlay playsInline muted />
                <div className="cam-actions">
                  <button className="btn ghost" onClick={stopCamera}>Cancel</button>
                  <button className="btn primary" onClick={snap}>Take photo</button>
                </div>
              </div>
            )}
            {photo && (
              <div className="cam">
                <img src={photo.url} alt="Your snap" />
                <div className="cam-actions">
                  <button className="btn ghost" onClick={() => setPhoto(null)}>Discard</button>
                  <button className="btn" onClick={() => { setPhoto(null); startCamera(); }}>Retake</button>
                </div>
              </div>
            )}
            {!camOn && !photo && (
              <button className="btn" onClick={startCamera}>Open camera</button>
            )}
            <button className="btn primary big" disabled={!canSubmit} onClick={submit}>
              {busy ? 'Submitting…' : 'Submit attendance'}
            </button>
            {!inRange && dist !== null && <p className="muted small">Submit unlocks once you are inside the site radius.</p>}
          </section>
        )
      )}

      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      <section className="card">
        <h2>Recent days</h2>
        {history.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <ul className="list">
            {history.map((h) => (
              <li key={h.id}>
                <span>
                  {new Date(h.work_date).toLocaleDateString()}
                  {h.checkout_at && (
                    <span className="muted small"> · ended {new Date(h.checkout_at).toLocaleTimeString()}</span>
                  )}
                </span>
                <span className="badges">
                  <span className={`pill ${h.status}`}>{h.status}</span>
                  {punctuality(h) && (
                    <span className={`pill ${punctuality(h).late ? 'late' : 'ontime'}`}>
                      {punctuality(h).text}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}