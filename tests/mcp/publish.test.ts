import { afterAll, describe, expect, it } from "vitest";
import { runInstagramAction } from "../../src/mcp/application/execute-instagram-action.js";
import { previewHash } from "../../src/mcp/domain/preview.js";
import {
  cleanupTempMedia,
  createFakeGateway,
  makeDeps,
  tempMedia,
} from "./helpers.js";

afterAll(cleanupTempMedia);

const caption = "Hola desde ig-mcp\n\n#example_studio";

async function preview(gateway = createFakeGateway()) {
  const deps = makeDeps(gateway);
  const path = tempMedia();
  const result = await runInstagramAction(deps, "publish_preview", {
    media: [path],
    caption,
    type: "photo",
  });
  const match = /preview_id=(pv-[0-9a-f]+)/.exec(result.text);
  expect(match).not.toBeNull();
  return {
    deps,
    gateway,
    path,
    previewId: match?.[1] as string,
    result,
  };
}

describe("instagram · publish_preview", () => {
  it("llama al gateway con dryRun y no publica nada", async () => {
    const { gateway, path, result } = await preview();
    expect(result.success).toBe(true);
    expect(result.text).toContain("No se ha publicado nada");
    expect(result.text).toContain("caption 34 caracteres");
    const [input] = gateway.publish.mock.calls[0] as [
      { dryRun: boolean; media: string[]; type: string; caption: string },
    ];
    expect(input.dryRun).toBe(true);
    expect(input.media).toEqual([path]);
    expect(input.caption).toBe(caption);
    expect(input.type).toBe("photo");
  });

  it("el hash cambia con cada opción que define el post", () => {
    const base = {
      project: "/p",
      media: ["/a.png"],
      type: "photo" as const,
      caption: "hola",
    };
    const baseHash = previewHash(base);
    expect(previewHash({ ...base })).toBe(baseHash);
    expect(previewHash({ ...base, caption: "otra" })).not.toBe(baseHash);
    expect(previewHash({ ...base, type: "reel" })).not.toBe(baseHash);
    expect(previewHash({ ...base, media: ["/b.png"] })).not.toBe(baseHash);
    expect(previewHash({ ...base, altText: "alt" })).not.toBe(baseHash);
    expect(previewHash({ ...base, collaborators: ["uno"] })).not.toBe(baseHash);
  });
});

describe("instagram · publish (guardas)", () => {
  it("sin preview_id no publica", async () => {
    const gateway = createFakeGateway();
    const result = await runInstagramAction(makeDeps(gateway), "publish", {
      media: [tempMedia()],
      caption,
      confirm: true,
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("exige preview_id");
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it("con preview_id desconocido no publica", async () => {
    const gateway = createFakeGateway();
    const result = await runInstagramAction(makeDeps(gateway), "publish", {
      media: [tempMedia()],
      caption,
      preview_id: "pv-0000000000000000",
      confirm: true,
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("preview_id desconocido");
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it("con contenido distinto del preview no publica", async () => {
    const { deps, gateway, path, previewId } = await preview();
    const result = await runInstagramAction(deps, "publish", {
      media: [path],
      caption: `${caption} (cambiado)`,
      preview_id: previewId,
      confirm: true,
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("no coincide con la vista previa");
    expect(gateway.publish).toHaveBeenCalledTimes(1);
  });

  it("con el mismo contenido pero el type cambiado no publica", async () => {
    const { deps, gateway, path, previewId } = await preview();
    const result = await runInstagramAction(deps, "publish", {
      media: [path],
      caption,
      type: "reel",
      preview_id: previewId,
      confirm: true,
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("no coincide");
    expect(gateway.publish).toHaveBeenCalledTimes(1);
  });

  it("sin confirm no publica aunque el preview exista", async () => {
    const { deps, gateway, path, previewId } = await preview();
    const result = await runInstagramAction(deps, "publish", {
      media: [path],
      caption,
      preview_id: previewId,
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("confirm: true");
    expect(gateway.publish).toHaveBeenCalledTimes(1);
  });
});

describe("instagram · publish (camino feliz)", () => {
  it("publica con dryRun false y la idempotencyKey derivada del hash", async () => {
    const { deps, gateway, path, previewId } = await preview();
    const result = await runInstagramAction(deps, "publish", {
      media: [path],
      caption,
      preview_id: previewId,
      confirm: true,
    });
    expect(result.success).toBe(true);
    expect(result.text).toContain("Publicado: publication-1797");
    expect(result.text).toContain("Id en Instagram: 1797");
    expect(gateway.publish).toHaveBeenCalledTimes(2);
    const [input] = gateway.publish.mock.calls[1] as unknown as [
      { dryRun: boolean; idempotencyKey: string; media: string[] },
    ];
    expect(input.dryRun).toBe(false);
    expect(input.idempotencyKey).toMatch(/^ig-mcp-[0-9a-f]{32}$/);
    expect(input.media).toEqual([path]);
  });

  it("el preview de una instancia no vale en otra (registro por proceso)", async () => {
    const { path, previewId } = await preview();
    const other = createFakeGateway();
    const result = await runInstagramAction(makeDeps(other), "publish", {
      media: [path],
      caption,
      preview_id: previewId,
      confirm: true,
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("preview_id desconocido");
    expect(other.publish).not.toHaveBeenCalled();
  });
});
