import { afterAll, describe, expect, it } from "vitest";
import { runInstagramAction } from "../../src/mcp/application/execute-instagram-action.js";
import { cleanupTempMedia, createFakeGateway, makeDeps } from "./helpers.js";

afterAll(cleanupTempMedia);

describe("instagram · lecturas", () => {
  it("check: cuenta, contadores y llamadas a Meta", async () => {
    const gateway = createFakeGateway();
    const result = await runInstagramAction(makeDeps(gateway), "check", {});
    expect(result.success).toBe(true);
    expect(result.text).toContain("@example_studio");
    expect(result.text).toContain("seguidores 8");
    expect(result.text).toContain("19 en la última hora");
    expect(gateway.checkAccount).toHaveBeenCalledWith("/proyecto");
  });

  it("quota: usada, total, restante y periodo", async () => {
    const result = await runInstagramAction(makeDeps(), "quota", {});
    expect(result.success).toBe(true);
    expect(result.text).toContain("1/100 usada");
    expect(result.text).toContain("quedan 99");
    expect(result.text).toContain("periodo 24 h");
  });

  it("media: permalink, tipo y fecha", async () => {
    const result = await runInstagramAction(makeDeps(), "media", {
      limit: 5,
    });
    expect(result.success).toBe(true);
    expect(result.text).toContain("2026-11-09");
    expect(result.text).toContain("CAROUSEL_ALBUM");
    expect(result.text).toContain("https://www.instagram.com/p/EXAMPLE/");
  });

  it("comments: id, autor y texto", async () => {
    const result = await runInstagramAction(makeDeps(), "comments", {
      media_id: "1797",
    });
    expect(result.success).toBe(true);
    expect(result.text).toContain("comment-1");
    expect(result.text).toContain("@alguien");
    expect(result.text).toContain("Qué bonito");
  });

  it("discover: perfil y piezas de otra cuenta, con aviso de URLs caducas", async () => {
    const result = await runInstagramAction(makeDeps(), "discover", {
      username: "@example_brand",
      limit: 2,
    });
    expect(result.success).toBe(true);
    expect(result.text).toContain("@example_brand");
    expect(result.text).toContain("seguidores 10000");
    expect(result.text).toContain("500 likes");
    expect(result.text).toContain("caducan");
  });

  it("publication_status: estado e id remoto", async () => {
    const result = await runInstagramAction(makeDeps(), "publication_status", {
      id: "publication-1797",
    });
    expect(result.success).toBe(true);
    expect(result.text).toContain("estado published");
    expect(result.text).toContain("Id en Instagram: 1797");
  });

  it("insights: métricas de la pieza por la ruta HTTP", async () => {
    const gateway = createFakeGateway();
    const result = await runInstagramAction(makeDeps(gateway), "insights", {
      media_id: "1797",
    });
    expect(result.success).toBe(true);
    expect(result.text).toContain("Insights de 1797");
    expect(result.text).toContain("reach: 120");
    expect(result.text).toContain("likes: 8 (2026-11-09)");
    expect(gateway.getInsights).toHaveBeenCalledWith("/proyecto", "1797");
  });
});

describe("instagram · moderación", () => {
  it("reply_comment exige confirm y responde el texto pedido", async () => {
    const gateway = createFakeGateway();
    const denied = await runInstagramAction(
      makeDeps(gateway),
      "reply_comment",
      { media_id: "1797", text: "Gracias" },
    );
    expect(denied.success).toBe(false);
    expect(denied.text).toContain("confirm: true");
    expect(gateway.replyComment).not.toHaveBeenCalled();

    const result = await runInstagramAction(
      makeDeps(gateway),
      "reply_comment",
      { media_id: "1797", text: "Gracias", confirm: true },
    );
    expect(result.success).toBe(true);
    expect(result.text).toContain("comment-2");
    expect(gateway.replyComment).toHaveBeenCalledWith(
      "/proyecto",
      "1797",
      "Gracias",
    );
  });

  it("hide_comment exige confirm y usa el id del comentario", async () => {
    const gateway = createFakeGateway();
    const denied = await runInstagramAction(makeDeps(gateway), "hide_comment", {
      comment_id: "comment-1",
    });
    expect(denied.success).toBe(false);
    expect(gateway.hideComment).not.toHaveBeenCalled();

    const result = await runInstagramAction(makeDeps(gateway), "hide_comment", {
      comment_id: "comment-1",
      confirm: true,
    });
    expect(result.success).toBe(true);
    expect(gateway.hideComment).toHaveBeenCalledWith("/proyecto", "comment-1");
  });
});

describe("instagram · project y parámetros", () => {
  it("sin project ni IG_DEFAULT_PROJECT falla antes de llamar al gateway", async () => {
    const gateway = createFakeGateway();
    const result = await runInstagramAction(
      makeDeps(gateway, { defaultProject: undefined }),
      "quota",
      {},
    );
    expect(result.success).toBe(false);
    expect(result.text).toContain("IG_DEFAULT_PROJECT");
    expect(gateway.getQuota).not.toHaveBeenCalled();
  });

  it("el project explícito manda sobre el de por defecto", async () => {
    const gateway = createFakeGateway();
    await runInstagramAction(makeDeps(gateway), "quota", {
      project: "/otro",
    });
    expect(gateway.getQuota).toHaveBeenCalledWith("/otro");
  });

  it("en lectura un parámetro desconocido solo avisa", async () => {
    const result = await runInstagramAction(makeDeps(), "media", {
      limit: 3,
      inventado: 1,
    });
    expect(result.success).toBe(true);
    expect(result.text).toContain("Aviso: parámetros ignorados: inventado");
  });

  it("en escritura un parámetro desconocido es error y no escribe", async () => {
    const gateway = createFakeGateway();
    const result = await runInstagramAction(makeDeps(gateway), "hide_comment", {
      comment_id: "c-1",
      confirm: true,
      inventado: true,
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("Parámetros desconocidos");
    expect(gateway.hideComment).not.toHaveBeenCalled();
  });

  it("acción desconocida lista las válidas", async () => {
    const result = await runInstagramAction(makeDeps(), "publicar", {});
    expect(result.success).toBe(false);
    expect(result.text).toContain("Acción desconocida: 'publicar'");
    expect(result.text).toContain("publish_preview");
  });
});
