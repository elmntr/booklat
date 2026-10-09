import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, parseWordEvent, statuses, streamUrl, type Learner, type Passage, type Session } from './api';
import './style.css';
import { SpeechCapture } from './SpeechCapture';

function App() {
  const [passages, setPassages] = useState<Passage[]>([]);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [passageId, setPassageId] = useState('');
  const [learnerId, setLearnerId] = useState('');
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [speechBusy, setSpeechBusy] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  useEffect(() => {
    let mounted = true;
    Promise.all([api.GET('/api/passages'), api.GET('/api/learners'), api.GET('/api/health')])
      .then(([p, l, h]) => {
        if (!p.data || !l.data || !h.data) throw new Error('API unavailable');
        if (!mounted) return;
        setPassages(p.data); setLearners(l.data); setOnline(true);
        setSpeechAvailable(h.data.speech_available);
        setPassageId(p.data[0]?.id ?? ''); setLearnerId(l.data[0]?.id ?? '');
      }).catch(() => { if (mounted) setError('Cannot reach the local API. Start both services and reload.'); });
    return () => { mounted = false; socket.current?.close(); };
  }, []);
  const passage = passages.find(p => p.id === passageId);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); }
    finally { setBusy(false); }
  }
  async function start() {
    const { data } = await api.POST('/api/sessions', { body: { learner_id: learnerId, passage_id: passageId } });
    if (!data) throw new Error('Could not start session');
    setSession(data);
    socket.current?.close();
    const ws = new WebSocket(streamUrl(data.id)); socket.current = ws;
    ws.onmessage = message => {
      try {
        const event = parseWordEvent(message.data);
        setSession(s => s?.id === event.session_id && s.state === 'active' ? {
          ...s, marks: [...s.marks.filter(m => m.passage_index !== event.passage_index), event],
        } : s);
      } catch { setError('The server sent an invalid word event.'); }
    };
    ws.onerror = () => setError('Reading stream failed. Stop the session and try again.');
    ws.onclose = e => { if (e.code !== 1000) setError('Reading stream disconnected. Stop and retry.'); };
  }
  async function stop() {
    if (!session) return;
    const { data } = await api.POST('/api/sessions/{session_id}/stop', { params: { path: { session_id: session.id } } });
    if (!data) throw new Error('Could not stop session');
    socket.current?.close(1000); setSession(data);
  }
  async function override(idx: number) {
    if (!session) return;
    const mark = session.marks.find(m => m.passage_index === idx);
    if (!mark) return;
    const status = statuses[(statuses.indexOf(mark.status) + 1) % statuses.length];
    const { data } = await api.PATCH('/api/sessions/{session_id}/words/{idx}', {
      params: { path: { session_id: session.id, idx } }, body: { status },
    });
    if (!data) throw new Error('Could not update word');
    setSession(data);
  }
  return <main>
    <header><span className="brand">Booklat</span><span>{online ? 'Local API connected' : 'Connecting…'}</span></header>
    <h1>Open a book.<br/>Make room for every reader.</h1>
    <p className="notice">Local speech transcription · Passage marking below remains a separate simulated demo.</p>
    {error && <p role="alert">{error}</p>}
    <section className="controls">
      <label>Learner<select disabled={session?.state === 'active' || busy || speechBusy} value={learnerId} onChange={e => { setLearnerId(e.target.value); setSession(undefined); }}>
        {learners.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select></label>
      <label>Passage<select disabled={session?.state === 'active' || busy || speechBusy} value={passageId} onChange={e => { setPassageId(e.target.value); setSession(undefined); }}>
        {passages.map(p => <option key={p.id} value={p.id}>{p.title} ({p.language})</option>)}
      </select></label>
    </section>
    {passage && session?.state !== 'active' && <SpeechCapture
      key={passage.id} language={passage.language} available={speechAvailable} onBusy={setSpeechBusy}/>}
    <section><h2>{passage?.title ?? 'Loading passages…'}</h2><p>{passage?.source}</p>
      <div className="passage">{passage?.words.map((word, idx) => {
        const mark = session?.marks.find(m => m.passage_index === idx);
        return <button key={idx} className={`word ${mark?.status ?? ''}`}
          disabled={session?.state !== 'stopped' || !mark || busy}
          aria-label={`${word}: ${mark?.status ?? 'not reached'}. Change mark`}
          onClick={() => run(() => override(idx))}>{word}</button>;
      })}</div>
      <p>After stopping, tap a marked word to change its status.</p>
      <div className="legend">{statuses.map(s => <span key={s} className={s}>{s}</span>)}</div>
    </section>
    <button className="primary" disabled={busy || speechBusy || !passage || !learnerId || !online}
      onClick={() => run(session?.state === 'active' ? stop : start)}>
      {busy ? 'Working…' : session?.state === 'active' ? 'Stop demo' : 'Start simulated reading'}
    </button>
    {session?.state === 'stopped' && <section aria-live="polite"><h2>Demo session complete</h2>
      <p>{session.marks.length} words marked · {session.duration_s.toFixed(1)} seconds · {session.teacher_edited ? 'Teacher edited' : 'Original marks'}</p>
      <p>Scores and reading level await validated Phil-IRI rules. Sessions are held in memory and reset when the API restarts.</p>
    </section>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
