import { afterAll, describe, expect, it } from "vitest";
import { runInstagramAction } from "../../src/mcp/application/execute-instagram-action.js";
import {
  cleanupTempMedia,
  createFakeGateway,
  makeDeps,
  tempMedia,
} from "./helpers.js";

afterAll(cleanupTempMedia);

describe("instagram audio (read)", () => {
  it("lists the tracks with id, title, artist, duration and preview", async () => {
    const gateway = createFakeGateway();
    const result = await runInstagramAction(makeDeps(gateway), "audio", {});
    expect(result.success).toBe(true);
    expect(result.text).toContain("403060247990261 · Example Song · Example Artist · 154 s");
    expect(result.text).toContain("https://www.instagram.com/reels/audio/403060247990261/");
    expect(result.text).toContain("audio_id");
    expect(gateway.searchAudio).toHaveBeenCalledWith("/proyecto", "music", undefined, 25);
  });

  it("forwards audio_type, search_query and limit", async () => {
    const gateway = createFakeGateway();
    const result = await runInstagramAction(makeDeps(gateway), "audio", {
      audio_type: "original_sound",
      search_query: " lluvia ",
      limit: 3,
    });
    expect(result.success).toBe(true);
    expect(result.text).toContain("con «lluvia»");
    expect(gateway.searchAudio).toHaveBeenCalledWith(
      "/proyecto",
      "original_sound",
      "lluvia",
      3,
    );
  });

  it("rejects an unknown audio_type without calling the gateway", async () => {
    const gateway = createFakeGateway();
    const result = await runInstagramAction(makeDeps(gateway), "audio", {
      audio_type: "podcast",
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("audio_type no válido");
    expect(gateway.searchAudio).not.toHaveBeenCalled();
  });

  it("says so when Meta returns nothing", async () => {
    const gateway = createFakeGateway();
    gateway.searchAudio.mockResolvedValueOnce([]);
    const result = await runInstagramAction(makeDeps(gateway), "audio", {
      search_query: "inexistente",
    });
    expect(result.success).toBe(true);
    expect(result.text).toContain("Meta no ha devuelto audio");
  });
});

describe("instagram audio on reels", () => {
  it("previews a reel with audio and sends id and volumes", async () => {
    const gateway = createFakeGateway();
    const result = await runInstagramAction(makeDeps(gateway), "publish_preview", {
      media: [tempMedia("reel.mp4")],
      type: "reel",
      audio_id: "403060247990261",
      audio_volume: 80,
      video_volume: 40,
    });
    expect(result.success).toBe(true);
    const [input] = gateway.publish.mock.calls[0] as unknown as [
      { dryRun: boolean; audioId?: string; audioVolume?: number; videoVolume?: number },
    ];
    expect(input.dryRun).toBe(true);
    expect(input.audioId).toBe("403060247990261");
    expect(input.audioVolume).toBe(80);
    expect(input.videoVolume).toBe(40);
  });

  it("a changed audio id invalidates the preview", async () => {
    const gateway = createFakeGateway();
    const deps = makeDeps(gateway);
    const path = tempMedia("reel.mp4");
    const preview = await runInstagramAction(deps, "publish_preview", {
      media: [path],
      type: "reel",
      audio_id: "403060247990261",
    });
    const previewId = /preview_id=(pv-[0-9a-f]+)/.exec(preview.text)?.[1] as string;
    const result = await runInstagramAction(deps, "publish", {
      media: [path],
      type: "reel",
      audio_id: "999999999999999",
      preview_id: previewId,
      confirm: true,
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("no coincide con la vista previa");
    expect(gateway.publish).toHaveBeenCalledTimes(1);
  });

  it("audio_id is reels-only", async () => {
    const gateway = createFakeGateway();
    const result = await runInstagramAction(makeDeps(gateway), "publish_preview", {
      media: [tempMedia()],
      type: "photo",
      audio_id: "403060247990261",
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("solo vale para reels");
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it("volume limits need audio_id and stay within 1-100", async () => {
    const gateway = createFakeGateway();
    const withoutId = await runInstagramAction(makeDeps(gateway), "publish_preview", {
      media: [tempMedia("reel.mp4")],
      type: "reel",
      audio_volume: 50,
    });
    expect(withoutId.success).toBe(false);
    expect(withoutId.text).toContain("exigen audio_id");

    for (const volume of [0, 101, 12.5]) {
      const result = await runInstagramAction(makeDeps(gateway), "publish_preview", {
        media: [tempMedia("reel.mp4")],
        type: "reel",
        audio_id: "403060247990261",
        audio_volume: volume,
      });
      expect(result.success, `volumen ${volume}`).toBe(false);
      expect(result.text).toContain("entero entre 1 y 100");
    }
    expect(gateway.publish).not.toHaveBeenCalled();
  });
});
