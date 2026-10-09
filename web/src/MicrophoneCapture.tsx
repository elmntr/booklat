import { useEffect, useRef, useState } from 'react';
import { captureMicrophone, microphoneError } from './audio';

export function MicrophoneCapture() {
  const [state, setState] = useState<'idle' | 'requesting' | 'recording' | 'stopping'>('idle');
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  const [samples, setSamples] = useState(0);
  const [frames, setFrames] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const capture = useRef<Awaited<ReturnType<typeof captureMicrophone>> | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  async function start() {
    const abort = new AbortController();
    controller.current = abort;
    setError(''); setSamples(0); setFrames(0); setLevel(0); setState('requesting');
    try {
      const recording = await captureMicrophone(abort.signal, ({ pcm, rms }) => {
        if (abort.signal.aborted) return;
        setSamples(n => n + pcm.byteLength / 2);
        setFrames(n => n + 1);
        setLevel(Math.min(1, rms * 4));
        // Local mic check: discard PCM. No audio is stored or sent to the demo socket.
      }, message => {
        if (abort.signal.aborted) return;
        setError(message); setState('idle'); setLevel(0); capture.current = null;
      });
      if (abort.signal.aborted) return;
      capture.current = recording;
      setState('recording');
    } catch (e) {
      if (!abort.signal.aborted) { setError(microphoneError(e)); setState('idle'); }
    }
  }
  async function stop() {
    setState('stopping');
    try { await capture.current?.stop(); }
    catch (e) { setError(microphoneError(e)); }
    finally { capture.current = null; setState('idle'); setLevel(0); }
  }
  function cancel() {
    controller.current?.abort(); setState('idle'); setLevel(0);
  }
  return <section aria-labelledby="microphone-title">
    <h2 id="microphone-title">Microphone check</h2>
    <p>Test your microphone before reading. Audio stays on this device and is discarded. Speech recognition is not connected yet.</p>
    <label className="mic-level">Input level <meter min={0} max={1} value={level} aria-label="Microphone input level" /></label>
    <p role="status">{state === 'recording' ? 'Recording' : state === 'requesting' ? 'Waiting for microphone permission…' : state === 'stopping' ? 'Stopping…' : 'Microphone off'} · {(samples / 16000).toFixed(1)} seconds captured · {frames} audio frames</p>
    {error && <p role="alert">{error}</p>}
    {state === 'requesting' ? <button className="primary" onClick={cancel}>Cancel microphone request</button> :
      <button className="primary" disabled={state === 'stopping'} onClick={() => { void (state === 'recording' ? stop() : start()); }}>
        {state === 'recording' ? 'Stop microphone' : state === 'stopping' ? 'Stopping…' : 'Start microphone check'}
      </button>}
  </section>;
}
