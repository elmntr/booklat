import createClient from 'openapi-fetch';
import type { paths, components } from './api.generated';
export const api = createClient<paths>();
export type Session = components['schemas']['Session'];
export type Passage = components['schemas']['Passage'];
export type Learner = components['schemas']['Learner'];
export type Transcription = components['schemas']['Transcription'];

export async function transcribeAudio(audio: Blob, language: 'en' | 'fil', signal: AbortSignal): Promise<Transcription> {
  if (!audio.size || audio.size > 10 * 1024 * 1024) {
    throw new Error('Choose a non-empty audio recording up to 10 MiB.');
  }
  const response = await fetch(`/api/transcribe?language=${language}`, {
    method: 'POST', body: audio, signal, headers: { 'Content-Type': 'application/octet-stream' },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(typeof error?.detail === 'string' ? error.detail : 'Speech recognition failed. Please try again.');
  }
  return response.json();
}
export type MarkStatus = components['schemas']['MarkOverride']['status'];
// WS wire schema: contracts/word-event.schema.json. Runtime validation below.
export type WordEvent = components['schemas']['WordMark'] & { type: 'word'; session_id: string };
export const statuses: MarkStatus[] = ['correct', 'substitution', 'mispronunciation', 'omission', 'repetition'];
export function parseWordEvent(raw: string): WordEvent {
  const event = JSON.parse(raw);
  if (event.type !== 'word' || typeof event.session_id !== 'string' ||
      !Number.isInteger(event.passage_index) || event.passage_index < 0 ||
      !statuses.includes(event.status) || typeof event.t !== 'number' || event.t < 0 ||
      !(event.heard_word === null || typeof event.heard_word === 'string')) {
    throw new Error('Invalid word event');
  }
  return event;
}
export function streamUrl(id: string) {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/read/${encodeURIComponent(id)}`;
}
