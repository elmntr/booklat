import createClient from 'openapi-fetch';
import type { paths, components } from './api.generated';
export const api = createClient<paths>();
export type Session = components['schemas']['Session'];
export type Passage = components['schemas']['Passage'];
export type Learner = components['schemas']['Learner'];
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
