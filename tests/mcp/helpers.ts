import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { UseCaseDeps } from "../../src/mcp/application/context.js";
import { createPreviewRegistry } from "../../src/mcp/application/preview-registry.js";
import type { IgGatewayPort } from "../../src/mcp/domain/ig-gateway-port.js";

const dirs: string[] = [];

/** Fichero real en un directorio temporal: la validación usa stat de verdad. */
export function tempMedia(name = "pieza.png"): string {
  const dir = mkdtempSync(join(tmpdir(), "ig-mcp-media-"));
  dirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, "fake-image");
  return path;
}

export function cleanupTempMedia(): void {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function createFakeGateway() {
  return {
    checkAccount: vi.fn(async () => ({
      id: "10000000000000001",
      username: "example_studio",
      name: "Example Studio",
      followersCount: 8,
      mediaCount: 15,
      website: "https://www.example.com/studio",
      calls: {
        callsLastHour: 19,
        callsLastMinute: 2,
        maxCallsPerMinute: 30,
      },
    })),
    getQuota: vi.fn(async () => ({
      quotaUsage: 1,
      quotaTotal: 100,
      quotaRemaining: 99,
      quotaDuration: 86_400,
    })),
    listMedia: vi.fn(async () => [
      {
        id: "20000000000000002",
        permalink: "https://www.instagram.com/p/EXAMPLE/",
        caption: "La próxima foto de este feed puede ser la tuya.",
        mediaType: "CAROUSEL_ALBUM",
        timestamp: "2026-11-09T14:37:35+0000",
      },
    ]),
    getInsights: vi.fn(async () => [
      { name: "reach", values: [{ value: 120 }] },
      {
        name: "likes",
        values: [{ value: 8, endTime: "2026-11-09T08:00:00+0000" }],
      },
    ]),
    getPublication: vi.fn(async () => ({
      id: "publication-1797",
      type: "photo",
      status: "published",
      remoteId: "1797",
      idempotencyKey: "ig-mcp-abc",
      createdAt: "2026-11-09T15:00:00.000Z",
      caption: "Hola",
    })),
    discoverAccount: vi.fn(async () => ({
      username: "example_brand",
      name: "Example Brand",
      biography: "Example brand",
      followersCount: 10_000,
      mediaCount: 100,
      media: [
        {
          id: "30000000000000003",
          permalink: "https://www.instagram.com/reel/EXAMPLE/",
          caption: "Example caption",
          mediaType: "VIDEO",
          thumbnailUrl: "https://cdn.example/thumb.jpg",
          timestamp: "2026-10-03T15:33:53+0000",
          likeCount: 500,
          commentsCount: 20,
        },
      ],
    })),
    listComments: vi.fn(async () => [
      {
        id: "comment-1",
        username: "alguien",
        text: "Qué bonito",
        createdAt: "2026-11-09T10:00:00+0000",
      },
    ]),
    replyComment: vi.fn(async () => ({ id: "comment-2", text: "Gracias" })),
    hideComment: vi.fn(async () => ({ id: "comment-1", hidden: true })),
    publish: vi.fn(async (input: { dryRun: boolean; type: string }) => ({
      id: input.dryRun ? "dry-run-1794236399481" : "publication-1797",
      status: input.dryRun ? "created" : "published",
      type: input.type,
      caption: "Hola",
      mediaIds: ["m-1"],
      ...(input.dryRun ? {} : { remoteId: "1797" }),
    })),
  };
}

export type FakeGateway = ReturnType<typeof createFakeGateway>;

export function makeDeps(
  gateway: FakeGateway = createFakeGateway(),
  overrides: Partial<UseCaseDeps> = {},
): UseCaseDeps {
  return {
    gateway: gateway as unknown as IgGatewayPort,
    previews: createPreviewRegistry(),
    mediaFiles: { kind: async () => "file" },
    defaultProject: "/proyecto",
    ...overrides,
  };
}
