import { afterAll, describe, expect, it } from "vitest";
import type { UseCaseDeps } from "../../src/mcp/application/context.js";
import { runInstagramAction } from "../../src/mcp/application/execute-instagram-action.js";
import { MAX_CAPTION_CHARS, MAX_HASHTAGS } from "../../src/mcp/domain/media-rules.js";
import {
  cleanupTempMedia,
  createFakeGateway,
  makeDeps,
  tempMedia,
} from "./helpers.js";

afterAll(cleanupTempMedia);

const paths = (count: number) =>
  Array.from({ length: count }, () => tempMedia());

async function previewWith(
  params: Record<string, unknown>,
  gateway = createFakeGateway(),
  mediaFiles: UseCaseDeps["mediaFiles"] = { kind: async () => "file" },
) {
  return runInstagramAction(
    makeDeps(gateway, { mediaFiles }),
    "publish_preview",
    params,
  );
}

describe("instagram media validation", () => {
  it("rejects relative paths without calling the gateway", async () => {
    const gateway = createFakeGateway();
    const result = await previewWith({ media: ["foto.png"] }, gateway);
    expect(result.success).toBe(false);
    expect(result.text).toContain("no absoluta");
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it("rejects missing paths without calling the gateway", async () => {
    const gateway = createFakeGateway();
    const result = await previewWith(
      { media: ["/no/existe/foto.png"] },
      gateway,
      { kind: async () => "missing" },
    );
    expect(result.success).toBe(false);
    expect(result.text).toContain("No existe el fichero");
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it("requires a single item for photo, reel and story", async () => {
    const result = await previewWith({
      media: paths(2),
      type: "photo",
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("exactamente una pieza");
  });

  it("carousel below and above the range", async () => {
    const one = await previewWith({ media: paths(1), type: "carousel" });
    expect(one.success).toBe(false);
    expect(one.text).toContain("entre 2 y 10");

    const eleven = await previewWith({ media: paths(11), type: "carousel" });
    expect(eleven.success).toBe(false);
    expect(eleven.text).toContain("entre 2 y 10");
  });

  it("accepts a 2-item carousel", async () => {
    const result = await previewWith({ media: paths(2), type: "carousel" });
    expect(result.success).toBe(true);
    expect(result.text).toContain("2 piezas");
  });

  it("rejects an unknown publication type", async () => {
    const result = await previewWith({ media: paths(1), type: "video" });
    expect(result.success).toBe(false);
    expect(result.text).toContain("type no válido");
  });
});

describe("instagram caption limits", () => {
  it(`rejects more than ${MAX_CAPTION_CHARS} chars`, async () => {
    const result = await previewWith({
      media: paths(1),
      caption: "a".repeat(MAX_CAPTION_CHARS + 1),
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("supera 2200 caracteres");
  });

  it("accepts exactly the maximum", async () => {
    const result = await previewWith({
      media: paths(1),
      caption: "a".repeat(MAX_CAPTION_CHARS),
    });
    expect(result.success).toBe(true);
  });

  it(`rejects more than ${MAX_HASHTAGS} hashtags`, async () => {
    const caption = Array.from({ length: MAX_HASHTAGS + 1 }, (_, i) => `#tag${i}`).join(" ");
    const result = await previewWith({ media: paths(1), caption });
    expect(result.success).toBe(false);
    expect(result.text).toContain(`${MAX_HASHTAGS + 1} hashtags`);
  });

  it(`accepts ${MAX_HASHTAGS} hashtags`, async () => {
    const caption = Array.from({ length: MAX_HASHTAGS }, (_, i) => `#tag${i}`).join(" ");
    const result = await previewWith({ media: paths(1), caption });
    expect(result.success).toBe(true);
  });
});

describe("instagram option limits", () => {
  it("a story accepts no collaborators", async () => {
    const result = await previewWith({
      media: paths(1),
      type: "story",
      collaborators: ["uno"],
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("no admite colaboradores");
  });

  it("more than 3 collaborators", async () => {
    const result = await previewWith({
      media: paths(1),
      collaborators: ["a", "b", "c", "d"],
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("máximo 3 colaboradores");
  });

  it("a carousel accepts no location_id", async () => {
    const result = await previewWith({
      media: paths(2),
      type: "carousel",
      location_id: "123",
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("no admite location_id");
  });

  it("share_to_feed is reels-only", async () => {
    const result = await previewWith({
      media: paths(1),
      type: "photo",
      share_to_feed: true,
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("solo vale para reels");
  });
});
