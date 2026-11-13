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

describe("instagram · validación de media", () => {
  it("rechaza rutas relativas sin llamar al gateway", async () => {
    const gateway = createFakeGateway();
    const result = await previewWith({ media: ["foto.png"] }, gateway);
    expect(result.success).toBe(false);
    expect(result.text).toContain("no absoluta");
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it("rechaza rutas inexistentes sin llamar al gateway", async () => {
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

  it("exige una sola pieza en foto, reel y story", async () => {
    const result = await previewWith({
      media: paths(2),
      type: "photo",
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("exactamente una pieza");
  });

  it("carrusel por debajo y por encima del rango", async () => {
    const one = await previewWith({ media: paths(1), type: "carousel" });
    expect(one.success).toBe(false);
    expect(one.text).toContain("entre 2 y 10");

    const eleven = await previewWith({ media: paths(11), type: "carousel" });
    expect(eleven.success).toBe(false);
    expect(eleven.text).toContain("entre 2 y 10");
  });

  it("acepta un carrusel de 2 piezas", async () => {
    const result = await previewWith({ media: paths(2), type: "carousel" });
    expect(result.success).toBe(true);
    expect(result.text).toContain("2 piezas");
  });

  it("rechaza un tipo de publicación desconocido", async () => {
    const result = await previewWith({ media: paths(1), type: "video" });
    expect(result.success).toBe(false);
    expect(result.text).toContain("type no válido");
  });
});

describe("instagram · límites del caption", () => {
  it(`rechaza más de ${MAX_CAPTION_CHARS} caracteres`, async () => {
    const result = await previewWith({
      media: paths(1),
      caption: "a".repeat(MAX_CAPTION_CHARS + 1),
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("supera 2200 caracteres");
  });

  it("acepta exactamente el máximo", async () => {
    const result = await previewWith({
      media: paths(1),
      caption: "a".repeat(MAX_CAPTION_CHARS),
    });
    expect(result.success).toBe(true);
  });

  it(`rechaza más de ${MAX_HASHTAGS} hashtags`, async () => {
    const caption = Array.from({ length: MAX_HASHTAGS + 1 }, (_, i) => `#tag${i}`).join(" ");
    const result = await previewWith({ media: paths(1), caption });
    expect(result.success).toBe(false);
    expect(result.text).toContain(`${MAX_HASHTAGS + 1} hashtags`);
  });

  it(`acepta ${MAX_HASHTAGS} hashtags`, async () => {
    const caption = Array.from({ length: MAX_HASHTAGS }, (_, i) => `#tag${i}`).join(" ");
    const result = await previewWith({ media: paths(1), caption });
    expect(result.success).toBe(true);
  });
});

describe("instagram · límites de opciones", () => {
  it("una historia no admite colaboradores", async () => {
    const result = await previewWith({
      media: paths(1),
      type: "story",
      collaborators: ["uno"],
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("no admite colaboradores");
  });

  it("más de 3 colaboradores", async () => {
    const result = await previewWith({
      media: paths(1),
      collaborators: ["a", "b", "c", "d"],
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("máximo 3 colaboradores");
  });

  it("un carrusel no admite location_id", async () => {
    const result = await previewWith({
      media: paths(2),
      type: "carousel",
      location_id: "123",
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("no admite location_id");
  });

  it("share_to_feed solo vale para reels", async () => {
    const result = await previewWith({
      media: paths(1),
      type: "photo",
      share_to_feed: true,
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("solo vale para reels");
  });
});
