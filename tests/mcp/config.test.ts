import { describe, expect, it } from "vitest";
import { loadIgMcpConfig } from "../../src/mcp/infrastructure/config.js";

describe("configuración", () => {
  it("aplica los valores por defecto del loopback", () => {
    expect(loadIgMcpConfig({})).toEqual({
      gatewayUrl: "http://127.0.0.1:4005",
      token: undefined,
      defaultProject: undefined,
    });
  });

  it("lee URL, token y proyecto del entorno", () => {
    const config = loadIgMcpConfig({
      IG_GATEWAY_URL: "http://127.0.0.1:4999/",
      IG_GATEWAY_TOKEN: "  abc  ",
      IG_DEFAULT_PROJECT: "/p",
    });
    expect(config.gatewayUrl).toBe("http://127.0.0.1:4999");
    expect(config.token).toBe("abc");
    expect(config.defaultProject).toBe("/p");
  });

  it("rechaza una URL inválida al arrancar", () => {
    expect(() => loadIgMcpConfig({ IG_GATEWAY_URL: "no-es-url" })).toThrow(
      "IG_GATEWAY_URL no es una URL válida",
    );
  });

  it("rechaza protocolos que no son http/https", () => {
    expect(() =>
      loadIgMcpConfig({ IG_GATEWAY_URL: "ftp://127.0.0.1:4005" }),
    ).toThrow("debe ser http o https");
  });

  it("no confunde un token vacío con uno definido", () => {
    expect(loadIgMcpConfig({ IG_GATEWAY_TOKEN: "   " }).token).toBeUndefined();
  });
});
