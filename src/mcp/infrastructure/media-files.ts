import { stat } from "node:fs/promises";
import type { MediaFileChecker } from "../domain/ig-gateway-port.js";

/** El único punto del MCP que toca el disco: existencia de las rutas de media. */
export function createMediaFileChecker(): MediaFileChecker {
  return {
    async kind(path) {
      try {
        const info = await stat(path);
        return info.isFile() ? "file" : "missing";
      } catch {
        return "missing";
      }
    },
  };
}
