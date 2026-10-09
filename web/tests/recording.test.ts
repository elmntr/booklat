import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordMicrophone } from '../src/recording.ts';

let tracksStopped = 0;
let recorder: FakeRecorder;
class FakeRecorder {
  static isTypeSupported(type: string) { return type.startsWith('audio/webm'); }
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | undefined;
  onstop: (() => void) | undefined;
  constructor() { recorder = this; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['final audio']) });
    this.onstop?.();
  }
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => tracksStopped++ }] }) },
} });
Object.assign(globalThis, { window: { MediaRecorder: FakeRecorder }, MediaRecorder: FakeRecorder });

test('Stop includes final audio and releases the microphone', async () => {
  tracksStopped = 0;
  const capture = await recordMicrophone();
  recorder.ondataavailable?.({ data: new Blob(['first audio']) });
  capture.stop();
  const audio = await capture.audio;
  assert.equal(await audio.text(), 'first audiofinal audio');
  assert.equal(audio.type, 'audio/webm');
  assert.equal(tracksStopped, 1);
  capture.stop();
  assert.equal(tracksStopped, 1);
});

test('Cancellation rejects instead of submitting audio', async () => {
  const capture = await recordMicrophone();
  capture.cancel();
  await assert.rejects(capture.audio, { name: 'AbortError' });
});

test('Oversized recording fails and releases the microphone', async () => {
  tracksStopped = 0;
  const capture = await recordMicrophone();
  recorder.ondataavailable?.({ data: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]) });
  await assert.rejects(capture.audio, /exceeds 10 MiB/);
  assert.equal(tracksStopped, 1);
});
