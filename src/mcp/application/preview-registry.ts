// Registro en memoria de vistas previas de ESTE proceso. Publicar exige que el
// `preview_id` esté aquí: un id de otra sesión, inventado o de otra máquina no
// vale, porque nadie ha visto ese contenido antes. Si el proceso muere, se
// repite la vista previa: es barato y evita publicar a ciegas.

export interface PreviewRecord {
  id: string;
  hash: string;
  createdAt: number;
  /** Resumen legible de lo que se vio (tipo, piezas, caption). */
  summary: string;
}

export interface PreviewRegistry {
  remember(record: PreviewRecord): void;
  get(id: string): PreviewRecord | undefined;
}

export function createPreviewRegistry(): PreviewRegistry {
  const records = new Map<string, PreviewRecord>();
  return {
    remember(record) {
      records.set(record.id, record);
    },
    get(id) {
      return records.get(id);
    },
  };
}
