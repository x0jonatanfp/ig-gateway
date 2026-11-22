import { afterAll, describe, expect, it } from "vitest";
import { runInstagramAction } from "../../src/mcp/application/execute-instagram-action.js";
import { cleanupTempMedia, createFakeGateway, makeDeps } from "./helpers.js";

afterAll(cleanupTempMedia);

describe("instagram reads", () => {
  it("check: account, counters and Meta calls", async () => {
    const gateway = createFakeGateway();
    const result = await runInstagramAction(makeDeps(gateway), "check", {});
    expect(result.success).toBe(true);
    expect(result.text).toContain("@example_studio");
    expect(result.text).toContain("seguidores 8");
    expect(result.text).toContain("19 en la última hora");
    expect(gateway.checkAccount).toHaveBeenCalledWith("/proyecto");
  });

  it("quota: used, total, remaining and period", async () => {
    const result = await runInstagramAction(makeDeps(), "quota", {});
    expect(result.success).toBe(true);
    expect(result.text).toContain("1/100 usada");
    expect(result.text).toContain("quedan 99");
    expect(result.text).toContain("periodo 24 h");
  });

  it("media: permalink, type and date", async () => {
    const result = await runInstagramAction(makeDeps(), "media", {
      limit: 5,
    });
    expect(result.success).toBe(true);
    expect(result.text).toContain("2026-11-09");
    expect(result.text).toContain("CAROUSEL_ALBUM");
    expect(result.text).toContain("https://www.instagram.com/p/EXAMPLE/");
  });

  it("comments: id, author and text", async () => {
    const result = await runInstagramAction(makeDeps(), "comments", {
      media_id: "1797",
    });
    expect(result.success).toBe(true);
    expect(result.text).toContain("comment-1");
    expect(result.text).toContain("@alguien");
    expect(result.text).toContain("Qué bonito");
  });

  it("discover: profile and items of another account, with expiring-URL notice", async () => {
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

  it("publication_status: status and remote id", async () => {
    const result = await runInstagramAction(makeDeps(), "publication_status", {
      id: "publication-1797",
    });
    expect(result.success).toBe(true);
    expect(result.text).toContain("estado published");
    expect(result.text).toContain("Id en Instagram: 1797");
  });

  it("insights: item metrics through the HTTP route", async () => {
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

describe("instagram active hours", () => {
  it("active_hours: summary with peak hours in the requested zone", async () => {
    const gateway = createFakeGateway();
    const result = await runInstagramAction(makeDeps(gateway), "active_hours", {
      timezone: "Europe/Madrid",
    });
    expect(result.success).toBe(true);
    expect(result.text).toContain("27 días");
    expect(result.text).toContain("Europe/Madrid");
    expect(result.text).toContain("Horas punta: 21:00 (62,4), 00:00 (40), 01:00 (40)");
    expect(result.text).toContain("21:00  62,4");
    expect(gateway.getActiveHours).toHaveBeenCalledWith("/proyecto", "Europe/Madrid");
  });

  it("active_hours: with no data days says so instead of inventing hours", async () => {
    const gateway = createFakeGateway();
    gateway.getActiveHours.mockResolvedValueOnce({
      timeZone: "UTC",
      days: 0,
      hours: Array.from({ length: 24 }, (_, hour) => ({ hour, average: 0 })),
      peak: [],
    });
    const result = await runInstagramAction(makeDeps(gateway), "active_hours", {});
    expect(result.success).toBe(true);
    expect(result.text).toContain("Meta no ha devuelto datos");
    expect(result.text).toContain("100 seguidores");
  });
});

describe("instagram moderation", () => {
  it("reply_comment requires confirm and replies the requested text", async () => {
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

  it("hide_comment requires confirm and uses the comment id", async () => {
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

describe("instagram project and params", () => {
  it("without project or IG_DEFAULT_PROJECT fails before calling the gateway", async () => {
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

  it("explicit project wins over the default one", async () => {
    const gateway = createFakeGateway();
    await runInstagramAction(makeDeps(gateway), "quota", {
      project: "/otro",
    });
    expect(gateway.getQuota).toHaveBeenCalledWith("/otro");
  });

  it("on reads an unknown param only warns", async () => {
    const result = await runInstagramAction(makeDeps(), "media", {
      limit: 3,
      madeUp: 1,
    });
    expect(result.success).toBe(true);
    expect(result.text).toContain("Aviso: parámetros ignorados: madeUp");
  });

  it("on writes an unknown param errors and writes nothing", async () => {
    const gateway = createFakeGateway();
    const result = await runInstagramAction(makeDeps(gateway), "hide_comment", {
      comment_id: "c-1",
      confirm: true,
      madeUp: true,
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("Parámetros desconocidos");
    expect(gateway.hideComment).not.toHaveBeenCalled();
  });

  it("unknown action lists the valid ones", async () => {
    const result = await runInstagramAction(makeDeps(), "publicar", {});
    expect(result.success).toBe(false);
    expect(result.text).toContain("Acción desconocida: 'publicar'");
    expect(result.text).toContain("publish_preview");
  });
});
