import { describe, expect, it } from "vitest";
import { runInstagramAction } from "../../src/mcp/application/execute-instagram-action.js";
import {
  ConfigurationError,
  GatewayError,
  type GatewayErrorCode,
  describeGatewayError,
} from "../../src/mcp/domain/gateway-error.js";
import { createFakeGateway, makeDeps } from "./helpers.js";

function depsFailing(error: unknown) {
  const gateway = createFakeGateway();
  gateway.getQuota.mockRejectedValueOnce(error);
  return makeDeps(gateway);
}

describe("errores del gateway por código", () => {
  const cases: Array<{
    code: GatewayErrorCode;
    expectRetry: boolean;
    fragment: string;
  }> = [
    { code: "AUTHENTICATION", expectRetry: false, fragment: "IG_ACCOUNT" },
    { code: "PERMISSION", expectRetry: false, fragment: "permiso" },
    { code: "RATE_LIMIT", expectRetry: true, fragment: "Límite de peticiones" },
    { code: "INVALID_REQUEST", expectRetry: false, fragment: "rechazó" },
    { code: "REMOTE_FAILURE", expectRetry: true, fragment: "transitorio" },
    { code: "NOT_FOUND", expectRetry: false, fragment: "No existe" },
    { code: "QUOTA_EXHAUSTED", expectRetry: false, fragment: "Cuota" },
    {
      code: "STAGING_FAILURE",
      expectRetry: false,
      fragment: "preparar el media",
    },
    { code: "UNKNOWN", expectRetry: false, fragment: "no clasificado" },
    { code: "UNREACHABLE", expectRetry: true, fragment: "conectar" },
  ];

  for (const { code, expectRetry, fragment } of cases) {
    it(`${code}: texto en español y reintentabilidad`, async () => {
      const result = await runInstagramAction(
        depsFailing(
          new GatewayError("detail", { code, retryable: expectRetry }),
        ),
        "quota",
        {},
      );
      expect(result.success).toBe(false);
      expect(result.text).toContain(`[${code}]`);
      expect(result.text).toContain(fragment);
      expect(result.text).toContain(
        expectRetry ? "Se puede reintentar" : "No reintentar",
      );
      expect(result.text).toContain("Detalle del gateway: detail");
    });
  }

  it("incluye el subcódigo cuando lo hay", () => {
    const text = describeGatewayError(
      new GatewayError("session invalidated", {
        code: "AUTHENTICATION",
        retryable: false,
        subcode: 460,
      }),
    );
    expect(text).toContain("subcódigo 460");
  });

  it("un fallo de configuración no se presenta como error del gateway", async () => {
    const result = await runInstagramAction(
      depsFailing(
        new ConfigurationError("Falta IG_GATEWAY_TOKEN: define la variable."),
      ),
      "quota",
      {},
    );
    expect(result.success).toBe(false);
    expect(result.text).toContain("Falta IG_GATEWAY_TOKEN");
    expect(result.text).not.toContain("Error [");
  });

  it("un error inesperado no filtra objetos internos", async () => {
    const result = await runInstagramAction(
      depsFailing(new Error("boom")),
      "quota",
      {},
    );
    expect(result.text).toContain("Error inesperado: boom");
  });

  it("las respuestas no nombran la cabecera del token", async () => {
    // El token solo existe en el adaptador HTTP: ni la aplicación ni los
    // casos de uso lo reciben, así que no puede acabar en una respuesta.
    const result = await runInstagramAction(
      depsFailing(
        new GatewayError("fallo del gateway", {
          code: "REMOTE_FAILURE",
          retryable: true,
        }),
      ),
      "quota",
      {},
    );
    expect(result.text).not.toContain("x-ig-gateway-token");
    const check = await runInstagramAction(makeDeps(), "check", {});
    expect(check.text.toLowerCase()).not.toContain("token");
  });
});
