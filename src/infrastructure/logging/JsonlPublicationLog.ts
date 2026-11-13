import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Publication } from '../../domain/Publication.js';
import type { PublicationLogPort } from '../../domain/ports.js';

export class JsonlPublicationLog implements PublicationLogPort {
  /**
   * El registro vive con el servicio, no en el directorio desde el que se llame:
   * si no, un dry-run desde otro repo dejaría allí un publications.jsonl suelto.
   */
  constructor(private readonly path = process.env.IG_PUBLICATION_LOG ?? './data/logs/publications.jsonl') {}
  async find(id: string): Promise<Publication | undefined> {
    const entries = await this.read();
    return entries.filter((entry) => entry.kind === 'publication').map((entry) => entry.data as Publication).find((publication) => publication.id === id);
  }
  async findByIdempotencyKey(key: string): Promise<Publication | undefined> {
    const entries = await this.read();
    return entries.filter((entry) => entry.kind === 'publication').map((entry) => entry.data as Publication).find((publication) => publication.idempotencyKey === key);
  }
  async append(publication: Publication): Promise<void> { await this.write({ kind: 'publication', data: publication }); }
  async appendEvent(event: Record<string, unknown>): Promise<void> { await this.write({ kind: 'event', data: event }); }
  private async write(entry: Record<string, unknown>): Promise<void> { await mkdir(dirname(this.path), { recursive: true }); await appendFile(this.path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8'); }
  private async read(): Promise<Record<string, unknown>[]> {
    try {
      return (await readFile(this.path, 'utf8')).split(/\r?\n/).filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; }
      });
    } catch { return []; }
  }
}
