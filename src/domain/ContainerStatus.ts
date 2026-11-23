/**
 * Significado de los subcódigos que Meta devuelve en `status` cuando el
 * contenedor termina en `ERROR` (documentación del IG Container y de los
 * códigos de error de Instagram, consultada el 23-nov-2026).
 *
 * Solo están los que la documentación publica. Meta no da subcódigos propios
 * para duración, edit list, códec, tamaño o audio: esos problemas llegan como
 * formato no admitido (2207026), así que aquí no se inventa una causa por cada
 * uno. Un subcódigo que no esté en el mapa se muestra tal cual.
 */
const CONTAINER_ERROR_MEANINGS: Readonly<Record<number, string>> = {
  2207001: 'Instagram server error; retry',
  2207003: 'timeout downloading the media; retry the upload',
  2207020: 'the media expired; create a new container and upload again',
  2207026: 'unsupported video format; upload an MOV or MP4',
  2207032: 'Meta could not create the media; create the container again',
  2207050: 'the Instagram account is restricted',
  2207053: 'unknown upload error; create a new container (video only)',
  2207057: 'thumb_offset is outside the video duration',
};

/** El subcódigo del contenedor, si Meta lo dio como número (o como texto numérico). */
export function containerFailureSubcode(status: unknown): number | undefined {
  if (typeof status === 'number') return Number.isInteger(status) ? status : undefined;
  if (typeof status === 'string' && /^\d+$/.test(status.trim())) return Number(status.trim());
  return undefined;
}

/**
 * Detalle legible del fallo: «subcode 2207026: …» si Meta lo dio, el valor tal
 * cual si no es un número, y «Meta no dio detalle» cuando no hay `status`.
 */
export function containerFailureDetail(status: unknown): string {
  const subcode = containerFailureSubcode(status);
  if (subcode !== undefined) {
    const meaning = CONTAINER_ERROR_MEANINGS[subcode];
    return `subcode ${subcode}${meaning === undefined ? '' : `: ${meaning}`}`;
  }
  if (typeof status === 'string' && status.trim() !== '') return `subcode ${status.trim()}`;
  return 'Meta no dio detalle';
}
