import { describe, expect, it } from 'vitest';
import { Caption, hasCapability, PublicationError, validateMediaType, type Account } from '../src/domain/index.js';

const account: Account = { id: '1', username: 'test', accessToken: 'secret', tokenFingerprint: 'hash', capabilities: new Set(['media', 'quota']) };

describe('domain', () => {
  it('accepts captions within length and hashtag limits', () => expect(Caption.create('Hola #uno #dos').hashtags).toEqual(['uno', 'dos']));
  it('rejects captions over 2200 chars and over 5 hashtags', () => {
    expect(() => Caption.create('x'.repeat(2201))).toThrow(/2200/);
    expect(Caption.create(Array.from({ length: 5 }, (_, i) => `#tag${i}`).join(' ')).hashtags).toHaveLength(5);
    expect(() => Caption.create(Array.from({ length: 6 }, (_, i) => `#tag${i}`).join(' '))).toThrow(/5 hashtags/);
  });
  it('validates carousel cardinality', () => {
    expect(() => validateMediaType('carousel', 1)).toThrow();
    expect(() => validateMediaType('carousel', 2)).not.toThrow();
    expect(() => validateMediaType('photo', 2)).toThrow();
  });
  it('lanza INVALID_REQUEST 400 ante captions y cardinalidades fuera de límite', () => {
    const invalid = (run: () => unknown, message: RegExp) => {
      let caught: unknown;
      try { run(); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(PublicationError);
      expect(caught).toMatchObject({ code: 'INVALID_REQUEST', retryable: false, status: 400 });
      expect((caught as Error).message).toMatch(message);
    };
    invalid(() => Caption.create('x'.repeat(2201)), /2200 characters/);
    invalid(() => Caption.create(Array.from({ length: 6 }, (_, i) => `#tag${i}`).join(' ')), /5 hashtags/);
    invalid(() => Caption.create(Array.from({ length: 21 }, (_, i) => `@user${i}`).join(' ')), /20 mentions/);
    invalid(() => validateMediaType('carousel', 1), /between 2 and 10/);
    invalid(() => validateMediaType('carousel', 11), /between 2 and 10/);
    invalid(() => validateMediaType('photo', 0), /at least one media item/);
    invalid(() => validateMediaType('story', 2), /exactly one media item/);
  });
  it('checks account capabilities', () => { expect(hasCapability(account, 'media')).toBe(true); expect(hasCapability(account, 'stories')).toBe(false); });
  it('exposes retryability and Meta trace fields', () => {
    const error = new PublicationError('temporary', { code: 'RATE_LIMIT', subcode: 9007, fbtrace: 'TRACE', retryable: true });
    expect(error.retryable).toBe(true); expect(error.subcode).toBe(9007); expect(error.fbtrace).toBe('TRACE');
  });
});
