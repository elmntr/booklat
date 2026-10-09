import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function processor() {
  let Processor;
  const messages = [];
  vm.runInNewContext(readFileSync(new URL('../public/audio/pcm-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { port = { postMessage: m => messages.push(m) }; },
    registerProcessor: (_, klass) => { Processor = klass; },
  });
  return { node: new Processor(), messages };
}

test('PCM16 little-endian clips, mixes channels, and emits 250 ms frames', () => {
  const { node, messages } = processor();
  for (let n = 0; n < 31; n++) node.process([[new Float32Array(128).fill(2)]]);
  assert.equal(messages.length, 0);
  node.process([[new Float32Array(128).fill(2)]]);
  assert.equal(messages[0].pcm.byteLength, 8000);
  assert.equal(new DataView(messages[0].pcm).getInt16(0, true), 32767);
  node.port.onmessage({ data: 'stop' });
  assert.equal(messages[1].pcm.byteLength, 192);
  assert.equal(messages[2].type, 'stopped');
  assert.equal(node.process([]), false);
});

test('negative samples, silence, stereo downmix and partial stop', () => {
  const { node, messages } = processor();
  node.process([[Float32Array.of(-2, 1, 0), Float32Array.of(-2, -1, 0)]]);
  node.port.onmessage({ data: 'stop' });
  const view = new DataView(messages[0].pcm);
  assert.equal(view.byteLength, 6);
  assert.equal(view.getInt16(0, true), -32768);
  assert.equal(view.getInt16(2, true), 0);
  assert.equal(view.getInt16(4, true), 0);
  assert.ok(Math.abs(messages[0].rms - Math.sqrt(1 / 3)) < 1e-6);
});

const { captureMicrophone } = await import('./audio.ts');
function browserMock(getMedia) {
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  let context;
  let worklet;
  globalThis.window = { isSecureContext: true, setTimeout, clearTimeout };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: getMedia ?? (async () => stream) },
  } });
  globalThis.AudioContext = class {
    sampleRate = 16000; state = 'running';
    audioWorklet = { addModule: async () => {} };
    constructor() { context = this; }
    async resume() {}
    async close() { this.state = 'closed'; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  };
  globalThis.AudioWorkletNode = class {
    constructor() { worklet = this; }
    connect() {} disconnect() {}
    port = {
      close() {},
      postMessage: () => {
        this.port.onmessage({ data: { type: 'frame', pcm: new ArrayBuffer(20), rms: 0.1 } });
        this.port.onmessage({ data: { type: 'stopped' } });
      },
    };
  };
  return { track, stream, get context() { return context; }, get worklet() { return worklet; } };
}

test('normal stop flushes before releasing the microphone and context', async () => {
  const mock = browserMock();
  const frames = [];
  const capture = await captureMicrophone(new AbortController().signal, frame => frames.push(frame), assert.fail);
  await capture.stop();
  assert.equal(frames[0].pcm.byteLength, 20);
  assert.equal(mock.track.stopped, true);
  assert.equal(mock.context.state, 'closed');
  await capture.stop();
});

test('permission failure closes the context', async () => {
  const mock = browserMock(async () => { throw new DOMException('Denied', 'NotAllowedError'); });
  await assert.rejects(captureMicrophone(new AbortController().signal, () => {}, assert.fail), { name: 'NotAllowedError' });
  assert.equal(mock.context.state, 'closed');
});

test('cancel while permission is pending also stops a late-arriving stream', async () => {
  let grant;
  const mock = browserMock(() => new Promise(resolve => { grant = resolve; }));
  const abort = new AbortController();
  const pending = captureMicrophone(abort.signal, () => {}, assert.fail);
  await Promise.resolve();
  abort.abort();
  grant(mock.stream);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(mock.track.stopped, true);
  assert.equal(mock.context.state, 'closed');
});

test('device loss reports failure and releases resources', async () => {
  const mock = browserMock();
  let failure;
  await captureMicrophone(new AbortController().signal, () => {}, message => { failure = message; });
  mock.track.onended();
  assert.match(failure, /disconnected/);
  assert.equal(mock.track.stopped, true);
  assert.equal(mock.context.state, 'closed');
});
