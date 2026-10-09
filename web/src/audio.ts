export type AudioFrame = { pcm: ArrayBuffer; rms: number };

export function microphoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') return 'Microphone permission denied. Allow microphone access in your browser and retry.';
  if (name === 'NotFoundError') return 'No microphone found. Connect a microphone and retry.';
  if (name === 'NotReadableError') return 'Microphone unavailable. Close other apps using it and retry.';
  return error instanceof Error ? error.message : 'Microphone capture failed. Please retry.';
}

// onFrame receives raw PCM, ready for the backend transport once its handshake is agreed.
export async function captureMicrophone(
  signal: AbortSignal,
  onFrame: (frame: AudioFrame) => void,
  onError: (message: string) => void,
): Promise<{ stop: () => Promise<void> }> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone capture requires localhost or HTTPS and a supported browser.');
  }
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let closed = false;
  const cleanup = () => {
    closed = true;
    stream?.getTracks().forEach(track => track.stop());
    source?.disconnect();
    node?.disconnect();
    node?.port.close();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
    signal.removeEventListener('abort', cleanup);
  };
  const fail = (message: string) => { if (!closed) { cleanup(); onError(message); } };
  signal.addEventListener('abort', cleanup, { once: true });
  const checkCancelled = () => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  try {
    checkCancelled();
    context = new AudioContext({ sampleRate: 16000 });
    await context.resume();
    checkCancelled();
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    } });
    checkCancelled();
    if (context.sampleRate !== 16000) throw new Error('This browser cannot capture at 16 kHz. Try Chrome.');
    await context.audioWorklet.addModule('/audio/pcm-worklet.js');
    checkCancelled();
    node = new AudioWorkletNode(context, 'pcm-capture');
    source = context.createMediaStreamSource(stream);
    let stopped: (() => void) | undefined;
    node.port.onmessage = ({ data }) => {
      if (closed) return;
      if (data.type === 'stopped') stopped?.();
      else if (data.type === 'frame') {
        try { onFrame({ pcm: data.pcm, rms: data.rms }); }
        catch { fail('Audio delivery failed. Stop and retry.'); }
      }
    };
    node.onprocessorerror = () => fail('Audio processing failed. Please retry.');
    stream.getAudioTracks().forEach(track => {
      track.onended = () => fail('Microphone disconnected. Reconnect it and retry.');
    });
    context.onstatechange = () => {
      if (context?.state === 'suspended') fail('Audio capture was interrupted. Please retry.');
    };
    // The processor outputs silence; connecting it keeps processing alive without mic feedback.
    source.connect(node);
    node.connect(context.destination);
    return { stop: async () => {
      if (closed) return;
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error('Audio stop timed out; the final partial frame may be missing.')), 1500);
          stopped = () => { clearTimeout(timer); resolve(); };
          node!.port.postMessage('stop');
        });
      } finally { cleanup(); }
    } };
  } catch (error) {
    cleanup();
    throw error;
  }
}
