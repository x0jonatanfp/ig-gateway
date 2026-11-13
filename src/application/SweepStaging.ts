import type { MediaStagingPort } from '../domain/ports.js';

export class SweepStaging {
  constructor(private readonly staging: MediaStagingPort) {}
  execute(ttlMs: number, now?: number): Promise<number> { return this.staging.sweep(ttlMs, now); }
}
