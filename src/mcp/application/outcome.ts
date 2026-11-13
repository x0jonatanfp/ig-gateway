import type { ToolOutcome } from "../domain/ig-gateway-port.js";

export type { ToolOutcome };

export function fail(error: string): ToolOutcome {
  return { success: false, text: error };
}

export function ok(text: string): ToolOutcome {
  return { success: true, text };
}
