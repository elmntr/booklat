// Record locally; send the encoded audio to the local API only after Stop.
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SECONDS = 120;

export async function recordMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    throw new Error('Microphone recording is unavailable. Use a supported browser on localhost.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let recorder: MediaRecorder;
  try {
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
      .find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    throw error;
  }
  const chunks: Blob[] = [];
  let size = 0;
  let failure: Error | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const stop = () => { if (recorder.state !== 'inactive') recorder.stop(); };
  const audio = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = event => {
      size += event.data.size;
      if (size > MAX_BYTES) {
        failure = new Error('Recording exceeds 10 MiB. Try a shorter reading.');
        stop();
      } else chunks.push(event.data);
    };
    recorder.onerror = () => {
      failure = new Error('Microphone recording failed. Check your microphone and try again.');
      stop();
    };
    recorder.onstop = () => {
      clearTimeout(timer);
      stream.getTracks().forEach(track => track.stop());
      if (failure) reject(failure);
      else if (!size) reject(new Error('No audio was recorded.'));
      else resolve(new Blob(chunks, { type: recorder.mimeType }));
    };
    try {
      recorder.start(1000);
      // Leave one second for recorder/codec timing at the server's duration limit.
      timer = setTimeout(stop, (MAX_SECONDS - 1) * 1000);
    } catch (error) {
      stream.getTracks().forEach(track => track.stop());
      reject(error);
    }
  });
  return {
    audio, stop,
    cancel: () => {
      failure = new DOMException('Recording cancelled.', 'AbortError');
      stop();
      stream.getTracks().forEach(track => track.stop());
    },
  };
}
