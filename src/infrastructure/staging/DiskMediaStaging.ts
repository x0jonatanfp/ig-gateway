import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { PublicationError } from '../../domain/PublicationError.js';
import type { MediaItem, MediaType } from '../../domain/MediaItem.js';
import type { MediaInput, MediaStagingPort } from '../../domain/ports.js';

export class DiskMediaStaging implements MediaStagingPort {
  private readonly rootDir: string;
  private readonly publicBaseUrl: string;

  constructor(
    rootDir = process.env.IG_STAGING_DIR ?? './data/media',
    publicBaseUrl = process.env.IG_MEDIA_BASE_URL ?? '',
  ) {
    this.rootDir = resolve(rootDir);
    this.publicBaseUrl = publicBaseUrl.replace(/\/$/, '');
  }

  async stage(inputs: readonly MediaInput[], project = 'default'): Promise<readonly MediaItem[]> {
    if (!this.publicBaseUrl) {
      throw new PublicationError('IG_MEDIA_BASE_URL is required: Instagram can only download public HTTPS URLs', { code: 'STAGING_FAILURE', retryable: false });
    }
    const directory = join(this.rootDir, safeSegment(basename(project)));
    const projectSegment = safeSegment(basename(project));
    try {
      await mkdir(directory, { recursive: true, mode: 0o750 });
      // El umask de la unidad (0077) recorta el mode de mkdir: sin este chmod la carpeta queda 700
      // y nginx (grupo del usuario) no puede servir el media que Meta descarga.
      await chmod(directory, 0o750);
      return await Promise.all(inputs.map(async (input) => {
        const id = `${Date.now()}-${randomUUID()}-${safeSegment(basename(input.path))}`;
        const destination = join(directory, id);
        await copyFile(input.path, destination);
        await chmod(destination, 0o644);
        return {
          id,
          type: input.type ?? inferMediaType(input.mimeType, input.path),
          path: `${this.publicBaseUrl}/${projectSegment}/${id}`,
          localPath: destination,
          originalPath: input.originalPath ?? input.path,
          ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }),
          ...(input.altText === undefined ? {} : { altText: input.altText }),
          ...(input.userTags === undefined ? {} : { userTags: input.userTags }),
          ...(input.collaborators === undefined ? {} : { collaborators: input.collaborators }),
          ...(input.locationId === undefined ? {} : { locationId: input.locationId }),
          ...(input.shareToFeed === undefined ? {} : { shareToFeed: input.shareToFeed }),
          ...(input.coverUrl === undefined ? {} : { coverUrl: input.coverUrl }),
          ...(input.thumbOffset === undefined ? {} : { thumbOffset: input.thumbOffset }),
          ...(input.audioName === undefined ? {} : { audioName: input.audioName }),
        } satisfies MediaItem;
      }));
    } catch (cause) {
      throw new PublicationError('Could not stage media', { code: 'STAGING_FAILURE', retryable: false, cause });
    }
  }

  async cleanup(items: readonly MediaItem[]): Promise<void> {
    // Solo se borran copias dentro del root del staging: nunca un original.
    await Promise.all(
      items
        .map((item) => item.localPath ?? item.path)
        .filter((path) => this.isInsideRoot(path))
        .map((path) => rm(path, { force: true })),
    );
  }

  async sweep(ttlMs: number, now = Date.now()): Promise<number> {
    let removed = 0;
    const projects = await readdir(this.rootDir, { withFileTypes: true }).catch(() => []);
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const directory = join(this.rootDir, project.name);
      const files = await readdir(directory, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile()) continue;
        const path = join(directory, file.name);
        const info = await stat(path);
        if (now - info.mtimeMs > ttlMs) { await rm(path, { force: true }); removed += 1; }
      }
    }
    return removed;
  }

  private isInsideRoot(path: string): boolean {
    const candidate = resolve(path);
    const relativePath = relative(this.rootDir, candidate);
    return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath);
  }
}

function inferMediaType(mimeType: string | undefined, path: string): MediaType {
  if (mimeType?.startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(path)) return 'reel';
  return 'photo';
}
function safeSegment(value: string): string { return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'default'; }
