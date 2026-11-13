import type { MediaType } from './MediaItem.js';

export type PublicationStatus = 'pending' | 'created' | 'published' | 'failed';

export interface Publication {
  id: string;
  accountId: string;
  mediaIds: readonly string[];
  type: MediaType;
  caption: string;
  status: PublicationStatus;
  remoteId?: string;
  /** true si Meta falló al responder pero la pieza sí se publicó (verificado). */
  recovered?: boolean;
  idempotencyKey?: string;
  createdAt: string;
  errorCode?: string;
}
