import { describe, expect, it, vi } from 'vitest';
import { logger } from '../src/infrastructure/logging/Logger.js';
import { appLogger } from '../src/infrastructure/logging/Logger.js';
import { REDACTED, redactFields, redactUrl } from '../src/infrastructure/logging/Redact.js';

describe('log redaction', () => {
  it('removes tokens, captions, query strings and machine paths', () => {
    const fields = redactFields({
      accessToken: 'page-token',
      'x-ig-gateway-token': 'gateway-secret',
      caption: 'texto privado',
      body: '{"media":"/srv/x.jpg"}',
      localPath: '/srv/services/ig-gateway/data/media/x.jpg',
      envFile: '/home/user/project/.env',
      url: 'https://cdn.example.test/ig/media.jpg?token=abc&expires=1',
      mediaUrls: ['https://cdn.example.test/a.jpg?sig=1', 'https://cdn.example.test/b.jpg'],
      status: 200,
    });

    expect(fields).toMatchObject({
      accessToken: REDACTED,
      'x-ig-gateway-token': REDACTED,
      caption: REDACTED,
      body: REDACTED,
      localPath: REDACTED,
      envFile: REDACTED,
      status: 200,
    });
    expect(fields.url).toBe('https://cdn.example.test/ig/media.jpg');
    expect(fields.mediaUrls).toEqual(['https://cdn.example.test/a.jpg', 'https://cdn.example.test/b.jpg']);
    const serialized = JSON.stringify(fields);
    expect(serialized).not.toContain('page-token');
    expect(serialized).not.toContain('gateway-secret');
    expect(serialized).not.toContain('texto privado');
    expect(serialized).not.toContain('token=abc');
    expect(serialized).not.toContain('/srv/services');
    expect(serialized).not.toContain('/home/user');
  });

  it('leaves plain text and non-URL strings untouched', () => {
    expect(redactUrl('Instagram media container failed with ERROR')).toBe('Instagram media container failed with ERROR');
    expect(redactUrl('https://www.instagram.com/p/abc/#comments')).toBe('https://www.instagram.com/p/abc/');
    expect(redactFields({ message: 'rate limit', retryable: true })).toEqual({ message: 'rate limit', retryable: true });
  });

  it('is applied by the winston adapter, not by each caller', () => {
    // Quien escribe una línea no tiene que acordarse: el adaptador redacta.
    const logged = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    try {
      appLogger.info('probe', {
        accessToken: 'page-token',
        caption: 'texto privado',
        url: 'https://cdn.example.test/a.jpg?sig=1',
        route: '/v1/publications',
      });
      const [, fields] = logged.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(fields).toMatchObject({ accessToken: REDACTED, caption: REDACTED, route: '/v1/publications' });
      expect(fields.url).toBe('https://cdn.example.test/a.jpg');
      expect(JSON.stringify(logged.mock.calls)).not.toContain('page-token');
    } finally {
      logged.mockRestore();
    }
  });
});
