import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createPreviewRegistry } from "../../src/mcp/application/preview-registry.js";
import { VALID_ACTIONS } from "../../src/mcp/domain/actions.js";
import { IG_SERVER_INSTRUCTIONS } from "../../src/mcp/domain/server-instructions.js";
import { INSTAGRAM_TOOL_DEFINITION } from "../../src/mcp/domain/tool-definition.js";
import { createInstagramMcpServer } from "../../src/mcp/infrastructure/mcp-server.js";

const paramNames = Object.keys(
  INSTAGRAM_TOOL_DEFINITION.parameters.properties.params.properties,
);

async function connectedClient(): Promise<Client> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createInstagramMcpServer({
    gateway: {
      checkAccount: async () => ({ id: "1", username: "u" }),
      getQuota: async () => ({
        quotaUsage: 0,
        quotaTotal: 100,
        quotaRemaining: 100,
      }),
      listMedia: async () => [],
      getInsights: async () => [],
      getPublication: async () => ({ id: "p" }),
      discoverAccount: async () => ({ username: "u" }),
      listComments: async () => [],
      replyComment: async () => ({ id: "c" }),
      hideComment: async () => ({ id: "c" }),
      publish: async () => ({ id: "p" }),
    },
    previews: createPreviewRegistry(),
    mediaFiles: { kind: async () => "file" },
    defaultProject: undefined,
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

describe("instrucciones del servidor (estándar MCP)", () => {
  it("el cliente las recibe en initialize con getInstructions()", async () => {
    const client = await connectedClient();
    expect(client.getInstructions()).toBe(IG_SERVER_INSTRUCTIONS);
    await client.close();
  });

  it("no pasan de 8 KB: van en el prompt de cada turno", () => {
    expect(Buffer.byteLength(IG_SERVER_INSTRUCTIONS, "utf8")).toBeLessThan(
      8 * 1024,
    );
  });

  it("nombran todas las acciones del MCP", () => {
    for (const action of VALID_ACTIONS) {
      expect(
        new RegExp(`\\b${action}\\b`).test(IG_SERVER_INSTRUCTIONS),
        `${action} no se menciona`,
      ).toBe(true);
    }
  });

  it("cada identificador con guion bajo citado es una acción o un parámetro", () => {
    const named =
      IG_SERVER_INSTRUCTIONS.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [];
    expect(named.length).toBeGreaterThan(5);
    for (const name of new Set(named)) {
      expect(
        [...VALID_ACTIONS, ...paramNames],
        `${name} no existe como acción ni como parámetro`,
      ).toContain(name);
    }
  });

  it("conserva las reglas clave de uso", () => {
    for (const fragment of [
      "publish_preview",
      "recovered",
      "subcódigo 460",
      "100 piezas cada 24 h",
      "ni borradores, ni borrado por API",
      "Business/Creator",
      "IG_ACCOUNT",
      "<cuenta>.env",
      "IG_MEDIA_BASE_URL",
      "127.0.0.1:4005",
      "programación",
      "insights",
    ]) {
      expect(IG_SERVER_INSTRUCTIONS).toContain(fragment);
    }
  });

  it("no contiene secretos ni chat_id", () => {
    expect(IG_SERVER_INSTRUCTIONS).not.toMatch(/chat_id/i);
    // Tokens largos (hex o base64) y asignaciones de credenciales.
    expect(IG_SERVER_INSTRUCTIONS).not.toMatch(/[A-Fa-f0-9]{32,}/);
    expect(IG_SERVER_INSTRUCTIONS).not.toMatch(
      /(?:token|password|secret)\s*[:=]\s*\S{6,}/i,
    );
    expect(IG_SERVER_INSTRUCTIONS).not.toContain("IG_GATEWAY_TOKEN=");
  });
});
