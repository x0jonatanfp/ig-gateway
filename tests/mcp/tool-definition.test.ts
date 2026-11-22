import { describe, expect, it } from "vitest";
import {
  ACTION_PARAMS,
  VALID_ACTIONS,
  actionParamList,
} from "../../src/mcp/domain/actions.js";
import { IG_SERVER_INSTRUCTIONS } from "../../src/mcp/domain/server-instructions.js";
import { INSTAGRAM_TOOL_DEFINITION } from "../../src/mcp/domain/tool-definition.js";

const schema = INSTAGRAM_TOOL_DEFINITION.parameters;
const properties = Object.keys(schema.properties.params.properties);
const actionEnum: readonly string[] = [
  ...(schema.properties.action.enum as readonly string[]),
];

describe("instagram tool coherence", () => {
  it("action enum matches the single table", () => {
    expect(actionEnum).toEqual(VALID_ACTIONS);
  });

  it("every table param exists in the schema", () => {
    for (const action of VALID_ACTIONS) {
      for (const param of actionParamList(action)) {
        expect(properties, `${action}.${param}`).toContain(param);
      }
    }
  });

  it("no schema param goes unused by every action", () => {
    for (const property of properties) {
      const used = VALID_ACTIONS.some((action) =>
        actionParamList(action).includes(property),
      );
      expect(used, property).toBe(true);
    }
  });

  it("every param has a description", () => {
    for (const [name, value] of Object.entries(
      schema.properties.params.properties,
    )) {
      const description = (value as { description?: string }).description;
      expect(description, name).toBeTruthy();
    }
  });

  it("instructions name every action", () => {
    for (const action of VALID_ACTIONS) {
      expect(IG_SERVER_INSTRUCTIONS).toContain(action);
    }
  });

  it("publish and moderate actions are marked as writes", () => {
    for (const action of [
      "publish_preview",
      "publish",
      "reply_comment",
      "hide_comment",
    ]) {
      expect(ACTION_PARAMS[action]?.writes, action).toBe(true);
    }
    for (const action of [
      "check",
      "quota",
      "media",
      "comments",
      "discover",
      "publication_status",
    ]) {
      expect(ACTION_PARAMS[action]?.writes, action).toBe(false);
    }
  });
});
