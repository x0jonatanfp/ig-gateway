import { describe, expect, it } from "vitest";
import { loadIgMcpConfig } from "../../src/mcp/infrastructure/config.js";

describe("configuration", () => {
  it("applies the loopback defaults", () => {
    expect(loadIgMcpConfig({})).toEqual({
      gatewayUrl: "http://127.0.0.1:4005",
      token: undefined,
      defaultProject: undefined,
    });
  });

  it("reads URL, token and project from the environment", () => {
    const config = loadIgMcpConfig({
      IG_GATEWAY_URL: "http://127.0.0.1:4999/",
      IG_GATEWAY_TOKEN: "  abc  ",
      IG_DEFAULT_PROJECT: "/p",
    });
    expect(config.gatewayUrl).toBe("http://127.0.0.1:4999");
    expect(config.token).toBe("abc");
    expect(config.defaultProject).toBe("/p");
  });

  it("rejects an invalid URL at startup", () => {
    expect(() => loadIgMcpConfig({ IG_GATEWAY_URL: "no-es-url" })).toThrow(
      "IG_GATEWAY_URL no es una URL válida",
    );
  });

  it("rejects non-http/https protocols", () => {
    expect(() =>
      loadIgMcpConfig({ IG_GATEWAY_URL: "ftp://127.0.0.1:4005" }),
    ).toThrow("debe ser http o https");
  });

  it("does not mistake an empty token for a defined one", () => {
    expect(loadIgMcpConfig({ IG_GATEWAY_TOKEN: "   " }).token).toBeUndefined();
  });
});
