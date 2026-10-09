import { useEffect, useRef, useState } from 'react';
import { transcribeAudio, type Transcription } from './api';
import { recordMicrophone } from './recording';

type Props = { language: 'en' | 'fil'; available: boolean; onBusy: (busy: boolean) => void };

export function SpeechCapture({ language, available, onBusy }: Props) {
  const [phase, setPhase] = useState<'idle' | 'requesting' | 'recording' | 'transcribing'>('idle');
  const [result, setResult] = useState<Transcription>();
  const [error, setError] = useState('');
  const recording = useRef<Awaited<ReturnType<typeof recordMicrophone>> | undefined>(undefined);
  const request = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recording.current?.cancel();
      request.current?.abort();
    };
  }, []);
  async function transcribe(audio: Blob, selectedLanguage: 'en' | 'fil') {
    setPhase('transcribing');
    request.current = new AbortController();
    const data = await transcribeAudio(audio, selectedLanguage, request.current.signal);
    if (mounted.current) setResult(data);
  }
  async function run(file?: File) {
    onBusy(true); setError(''); setResult(undefined); setPhase('requesting');
    try {
      if (file) {
        await transcribe(file, language);
      } else {
        const capture = await recordMicrophone();
        recording.current = capture;
        // Permission dialogs can outlive the component.
        if (!mounted.current) {
          capture.cancel();
          await capture.audio.catch(() => {});
          return;
        }
        setPhase('recording');
        await transcribe(await capture.audio, language);
      }
    } catch (error) {
      if (mounted.current) {
        setError(error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow it in browser settings or choose an audio file.'
          : error instanceof Error ? error.message : 'Speech recognition failed.');
      }
    } finally {
      recording.current = undefined;
      if (mounted.current) { setPhase('idle'); onBusy(false); }
    }
  }
  return <section aria-busy={phase === 'transcribing'}>
    <h2>Speech recognition</h2>
    <p>Read aloud in {language === 'fil' ? 'Filipino' : 'English'}, then stop to see the transcript.
      Audio stays on this computer and is not saved. Maximum recording: 2 minutes.</p>
    {!available && <p>Speech model is not ready. Complete speech setup and reload this page.</p>}
    {error && <p role="alert">{error}</p>}
    <button className="primary" disabled={!available || phase === 'requesting' || phase === 'transcribing'}
      onClick={() => phase === 'recording' ? recording.current?.stop() : void run()}>
      {phase === 'recording' ? 'Stop and transcribe' : phase === 'transcribing' ? 'Transcribing…'
        : phase === 'requesting' ? 'Waiting for microphone…' : 'Record reading'}
    </button>
    <label className="audio-file">Or choose an audio file
      <input type="file" accept="audio/*,.wav,.webm,.mp4,.ogg" disabled={!available || phase !== 'idle'}
        onChange={event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (file) void run(file);
        }}/>
    </label>
    <div aria-live="polite">
      {phase === 'recording' && <p>Recording… Stops automatically within 2 minutes.</p>}
      {phase === 'transcribing' && <p>Recognizing speech locally. This can take a while.</p>}
      {result && <>
        <h3>Transcript</h3><p>{result.text || 'No speech detected.'}</p>
        <p>{result.duration_s.toFixed(1)} seconds · {result.words.length} recognized words</p>
        {result.words.length > 0 && <details><summary>Word timestamps</summary>
          <ol>{result.words.map((word, index) => <li key={index}>
            {word.word} ({word.start.toFixed(2)}–{word.end.toFixed(2)} s)
          </li>)}</ol>
        </details>}
        <p>Transcript only. Passage alignment and reading scores are not connected yet.</p>
      </>}
    </div>
  </section>;
}
