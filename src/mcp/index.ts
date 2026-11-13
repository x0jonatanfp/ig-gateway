import { createPreviewRegistry } from "./application/preview-registry.js";
import { loadIgMcpConfig } from "./infrastructure/config.js";
import { createHttpIgGateway } from "./infrastructure/http-ig-gateway.js";
import { startInstagramMcpServer } from "./infrastructure/mcp-server.js";
import { createMediaFileChecker } from "./infrastructure/media-files.js";

// Composition root: entorno → cliente del gateway → servidor MCP stdio.
// Solo un error de configuración fatal (URL inválida) impide arrancar; sin
// token el servidor arranca y cada tool explica qué falta.
async function main(): Promise<void> {
  const config = loadIgMcpConfig();
  await startInstagramMcpServer({
    gateway: createHttpIgGateway(config),
    previews: createPreviewRegistry(),
    mediaFiles: createMediaFileChecker(),
    defaultProject: config.defaultProject,
  });
}

main().catch((err) => {
  // stdout es el canal del protocolo MCP: los errores van a stderr.
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
