import { describe, expect, it } from 'vitest';
import { Caption, hasCapability, PublicationError, validateMediaType, type Account } from '../src/domain/index.js';

const account: Account = { id: '1', username: 'test', accessToken: 'secret', tokenFingerprint: 'hash', capabilities: new Set(['media', 'quota']) };

describe('domain', () => {
  it('accepts captions within length and hashtag limits', () => expect(Caption.create('Hola #uno #dos').hashtags).toEqual(['uno', 'dos']));
  it('rejects captions over 2200 chars and over 30 hashtags', () => {
    expect(() => Caption.create('x'.repeat(2201))).toThrow(/2200/);
    expect(() => Caption.create(Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(' '))).toThrow(/30/);
  });
  it('validates carousel cardinality', () => {
    expect(() => validateMediaType('carousel', 1)).toThrow();
    expect(() => validateMediaType('carousel', 2)).not.toThrow();
    expect(() => validateMediaType('photo', 2)).toThrow();
  });
  it('checks account capabilities', () => { expect(hasCapability(account, 'media')).toBe(true); expect(hasCapability(account, 'stories')).toBe(false); });
  it('exposes retryability and Meta trace fields', () => {
    const error = new PublicationError('temporary', { code: 'RATE_LIMIT', subcode: 9007, fbtrace: 'TRACE', retryable: true });
    expect(error.retryable).toBe(true); expect(error.subcode).toBe(9007); expect(error.fbtrace).toBe('TRACE');
  });
});
