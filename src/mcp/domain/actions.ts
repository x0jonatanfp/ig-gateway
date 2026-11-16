// Única fuente de verdad de las acciones y sus parámetros de la tool
// `instagram`. La validación de parámetros desconocidos (application/), el
// esquema (tool-definition.ts) y los tests de coherencia usan esta tabla:
// añadir un parámetro aquí obliga a añadirlo en el esquema y en su caso de uso.

export interface ActionParamSpec {
  /** Parámetros que la acción exige. */
  required: readonly string[];
  /** Parámetros que la acción acepta sin exigirlos. */
  optional: readonly string[];
  /** true si la acción escribe o publica (incluye la escritura en seco). */
  writes: boolean;
}

export const ACTION_PARAMS: Record<string, ActionParamSpec> = {
  check: { required: [], optional: ["project"], writes: false },
  quota: { required: [], optional: ["project"], writes: false },
  media: { required: [], optional: ["project", "limit"], writes: false },
  insights: { required: ["media_id"], optional: ["project"], writes: false },
  active_hours: { required: [], optional: ["project", "timezone"], writes: false },
  comments: { required: ["media_id"], optional: ["project"], writes: false },
  discover: {
    required: ["username"],
    optional: ["project", "limit"],
    writes: false,
  },
  publication_status: { required: ["id"], optional: [], writes: false },
  publish_preview: {
    required: ["media"],
    optional: [
      "project",
      "type",
      "caption",
      "alt_text",
      "user_tags",
      "collaborators",
      "location_id",
      "share_to_feed",
      "cover_url",
    ],
    writes: true,
  },
  publish: {
    required: ["media", "preview_id"],
    optional: [
      "project",
      "type",
      "caption",
      "alt_text",
      "user_tags",
      "collaborators",
      "location_id",
      "share_to_feed",
      "cover_url",
      "confirm",
    ],
    writes: true,
  },
  reply_comment: {
    required: ["media_id", "text"],
    optional: ["project", "confirm"],
    writes: true,
  },
  hide_comment: {
    required: ["comment_id"],
    optional: ["project", "confirm"],
    writes: true,
  },
};

/** Las acciones válidas, en el orden en que se documentan. */
export const VALID_ACTIONS: readonly string[] = Object.keys(ACTION_PARAMS);

/** Todos los parámetros que una acción acepta (obligatorios + opcionales). */
export function actionParamList(action: string): string[] {
  const spec = ACTION_PARAMS[action];
  if (!spec) return [];
  return [...spec.required, ...spec.optional];
}
