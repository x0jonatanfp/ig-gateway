import { describe, expect, it } from "vitest";
import { INSTAGRAM_TOOL_NAME } from "../../src/mcp/domain/tool-definition.js";
import {
  callInstagramTool,
  listInstagramTools,
} from "../../src/mcp/infrastructure/mcp-server.js";
import { createFakeGateway, makeDeps } from "./helpers.js";

describe("server startup", () => {
  it("exposes exactly the instagram tool", () => {
    const tools = listInstagramTools();
    expect(tools.map((tool) => tool.name)).toEqual([INSTAGRAM_TOOL_NAME]);
    expect(INSTAGRAM_TOOL_NAME).toBe("instagram");
  });

  it("publishes the worst case: the tool writes", () => {
    expect(listInstagramTools()[0]!.annotations).toMatchObject({
      readOnlyHint: false,
    });
  });

  it("tool carries description and schema", () => {
    const tool = listInstagramTools()[0]!;
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.inputSchema).toMatchObject({ type: "object" });
  });

  it("dispatches quota and flags a missing action", async () => {
    const ok = await callInstagramTool(makeDeps(createFakeGateway()), {
      action: "quota",
      params: {},
    });
    expect(ok.isError).toBeUndefined();
    expect(ok.content[0]!.text).toContain("Cuota de publicación");

    const missing = await callInstagramTool(makeDeps(), { params: {} });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]!.text).toContain("action es obligatoria");
  });
});
