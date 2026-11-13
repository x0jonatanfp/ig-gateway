import type {
  IgGatewayPort,
  MediaFileChecker,
} from "../domain/ig-gateway-port.js";
import { str } from "./fields.js";
import { fail } from "./outcome.js";
import type { ToolOutcome } from "./outcome.js";
import type { PreviewRegistry } from "./preview-registry.js";

export interface UseCaseDeps {
  gateway: IgGatewayPort;
  previews: PreviewRegistry;
  mediaFiles: MediaFileChecker;
  /** Proyecto por defecto (IG_DEFAULT_PROJECT) si la tool no recibe uno. */
  defaultProject: string | undefined;
}

export type ProjectResolution =
  | { ok: true; project: string }
  | { ok: false; outcome: ToolOutcome };

/**
 * La cuenta sale del proyecto: su `.env` lleva `IG_ACCOUNT`. El MCP nunca
 * elige cuenta ni acepta tokens de Meta, así que sin proyecto no hay nada que
 * hacer y se explica cómo darlo.
 */
export function resolveProject(
  params: Record<string, unknown>,
  defaultProject: string | undefined,
): ProjectResolution {
  const project = str(params, "project") || defaultProject?.trim() || "";
  if (!project) {
    return {
      ok: false,
      outcome: fail(
        "Falta project: pasa una ruta cuyo .env tenga IG_ACCOUNT o define IG_DEFAULT_PROJECT. No se ha llamado al gateway.",
      ),
    };
  }
  return { ok: true, project };
}
