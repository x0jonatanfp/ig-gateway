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

describe("coherencia de la tool instagram", () => {
  it("el enum de acciones coincide con la tabla única", () => {
    expect(actionEnum).toEqual(VALID_ACTIONS);
  });

  it("todos los parámetros de la tabla existen en el esquema", () => {
    for (const action of VALID_ACTIONS) {
      for (const param of actionParamList(action)) {
        expect(properties, `${action}.${param}`).toContain(param);
      }
    }
  });

  it("no hay parámetros en el esquema que ninguna acción use", () => {
    for (const property of properties) {
      const used = VALID_ACTIONS.some((action) =>
        actionParamList(action).includes(property),
      );
      expect(used, property).toBe(true);
    }
  });

  it("cada parámetro tiene descripción", () => {
    for (const [name, value] of Object.entries(
      schema.properties.params.properties,
    )) {
      const description = (value as { description?: string }).description;
      expect(description, name).toBeTruthy();
    }
  });

  it("las instrucciones nombran todas las acciones", () => {
    for (const action of VALID_ACTIONS) {
      expect(IG_SERVER_INSTRUCTIONS).toContain(action);
    }
  });

  it("publicar y moderar están marcadas como escritura", () => {
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
