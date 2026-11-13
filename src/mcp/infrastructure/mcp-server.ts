import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { UseCaseDeps } from "../application/context.js";
import { runInstagramAction } from "../application/execute-instagram-action.js";
import { IG_SERVER_INSTRUCTIONS } from "../domain/server-instructions.js";
import {
  INSTAGRAM_TOOL_ANNOTATIONS,
  INSTAGRAM_TOOL_DEFINITION,
  INSTAGRAM_TOOL_NAME,
} from "../domain/tool-definition.js";

export function listInstagramTools() {
  return [
    {
      name: INSTAGRAM_TOOL_DEFINITION.name,
      description: INSTAGRAM_TOOL_DEFINITION.description,
      inputSchema: INSTAGRAM_TOOL_DEFINITION.parameters,
      annotations: { ...INSTAGRAM_TOOL_ANNOTATIONS },
    },
  ];
}

export async function callInstagramTool(
  deps: UseCaseDeps,
  args: Record<string, unknown>,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  const action = typeof args.action === "string" ? args.action.trim() : "";
  const params =
    args.params &&
    typeof args.params === "object" &&
    !Array.isArray(args.params)
      ? (args.params as Record<string, unknown>)
      : {};
  if (!action) {
    return {
      content: [{ type: "text", text: "action es obligatoria" }],
      isError: true,
    };
  }
  const outcome = await runInstagramAction(deps, action, params);
  return {
    content: [{ type: "text", text: outcome.text }],
    ...(outcome.success ? {} : { isError: true }),
  };
}

/** Servidor MCP stdio con la tool `instagram`: catálogo y despacho. */
export function createInstagramMcpServer(deps: UseCaseDeps): Server {
  const server = new Server(
    { name: "ig-mcp", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: IG_SERVER_INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listInstagramTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== INSTAGRAM_TOOL_NAME) {
      return {
        content: [
          { type: "text", text: `Tool desconocida: '${req.params.name}'` },
        ],
        isError: true,
      };
    }
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    return callInstagramTool(deps, args);
  });

  return server;
}

export async function startInstagramMcpServer(
  deps: UseCaseDeps,
): Promise<void> {
  const server = createInstagramMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
