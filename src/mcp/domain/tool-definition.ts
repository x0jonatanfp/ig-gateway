import { VALID_ACTIONS } from "./actions.js";
import { PUBLICATION_TYPES } from "./media-rules.js";

// Definición de la tool `instagram` (una sola tool con `action` + `params`).
// La descripción lleva una línea por acción; el detalle de
// cada parámetro vive en las descripciones anidadas de `params.properties`,
// que no se recortan. Los parámetros válidos por acción se fijan en
// actions.ts y un test comprueba que esquema y tabla nombran los mismos.

export const INSTAGRAM_TOOL_NAME = "instagram";

export const INSTAGRAM_TOOL_ANNOTATIONS = {
  // MCP anota por tool y aquí conviven lecturas y escrituras: se publica el
  // peor caso para que el cliente aplique su guardia de escrituras.
  readOnlyHint: false,
} as const;

export const INSTAGRAM_TOOL_DEFINITION = {
  name: INSTAGRAM_TOOL_NAME,
  description:
    "Instagram through the local ig-gateway (never talks to Meta). Answers in Spanish. " +
    "Read: check(project?) resolves the account + Meta calls; quota(project?); media(project?,limit?); " +
    "insights(media_id); comments(media_id); discover(username,project?,limit?) public data of another Business/Creator account; " +
    "publication_status(id). " +
    "Write: publish_preview(media,type?,caption?,alt_text?,user_tags?,collaborators?,location_id?,share_to_feed?,cover_url?) dry run; " +
    "publish(same params + preview_id,confirm:true) requires a preview made in this same process with identical content; " +
    "reply_comment(media_id,text,confirm:true); hide_comment(comment_id,confirm:true). " +
    "project is a path whose .env has IG_ACCOUNT; falls back to IG_DEFAULT_PROJECT. Media = absolute paths that exist.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...VALID_ACTIONS],
        description: "Operación a ejecutar.",
      },
      params: {
        type: "object",
        description:
          "Argumentos de la acción (ver la lista de acciones y los parámetros).",
        properties: {
          project: {
            type: "string",
            description:
              "Ruta del proyecto cuyo .env lleva IG_ACCOUNT. Si falta, se usa IG_DEFAULT_PROJECT. Acciones: todas menos publication_status.",
          },
          limit: {
            type: "number",
            description:
              "Máximo de piezas (1-100; por defecto 20). Acciones: media, discover.",
          },
          media: {
            type: "array",
            items: { type: "string" },
            description:
              "Rutas absolutas de las piezas, en orden. Carrusel 2-10; foto, reel o story exactamente 1. Acciones: publish_preview, publish.",
          },
          type: {
            type: "string",
            enum: [...PUBLICATION_TYPES],
            description:
              "photo (por defecto), carousel, reel o story. Acciones: publish_preview, publish.",
          },
          caption: {
            type: "string",
            description:
              "Texto del post; máximo 2200 caracteres y 5 hashtags. Sin caption, vacío. Acciones: publish_preview, publish.",
          },
          alt_text: {
            type: "string",
            description:
              "Texto alternativo de la imagen. Acciones: publish_preview, publish.",
          },
          user_tags: {
            type: "array",
            items: {
              type: "object",
              properties: {
                username: { type: "string" },
                x: { type: "number" },
                y: { type: "number" },
              },
              required: ["username"],
            },
            description:
              "Etiquetas de personas con coordenadas 0-1. Acciones: publish_preview, publish.",
          },
          collaborators: {
            type: "array",
            items: { type: "string" },
            description:
              "Máximo 3; no vale en story. Acciones: publish_preview, publish.",
          },
          location_id: {
            type: "string",
            description:
              "Id de ubicación de Facebook; no vale en carrusel ni en story. Acciones: publish_preview, publish.",
          },
          share_to_feed: {
            type: "boolean",
            description:
              "Solo reels: compartir también en el feed. Acciones: publish_preview, publish.",
          },
          cover_url: {
            type: "string",
            description:
              "URL de portada del reel. Acciones: publish_preview, publish.",
          },
          preview_id: {
            type: "string",
            description:
              "Id devuelto por publish_preview en ESTE proceso; debe repetirse el mismo contenido. Acción: publish.",
          },
          confirm: {
            type: "boolean",
            description:
              "true confirma la escritura real. Obligatorio en publish, reply_comment y hide_comment.",
          },
          media_id: {
            type: "string",
            description:
              "Id de la pieza. Acciones: insights, comments, reply_comment (el comentario se responde sobre la pieza).",
          },
          comment_id: {
            type: "string",
            description: "Id del comentario a ocultar. Acción: hide_comment.",
          },
          text: {
            type: "string",
            description: "Texto de la respuesta. Acción: reply_comment.",
          },
          username: {
            type: "string",
            description:
              "Cuenta Business/Creator objetivo, con o sin @. Acción: discover.",
          },
          id: {
            type: "string",
            description:
              "Id de la publicación del gateway (publication-… o dry-run-…). Acción: publication_status.",
          },
        },
      },
    },
    required: ["action"],
  },
} as const;
