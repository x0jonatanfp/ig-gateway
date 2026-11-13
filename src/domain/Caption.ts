export class Caption {
  static readonly MAX_LENGTH = 2_200;
  // Instagram recortó los hashtags a 5 por post y por reel el 18-dic-2025; la
  // documentación de Meta sigue diciendo 30.
  static readonly MAX_HASHTAGS = 5;
  // Pendiente de verificar contra Meta: su documentación dice 20 y otras
  // fuentes, 3.
  static readonly MAX_MENTIONS = 20;

  private constructor(readonly value: string, readonly hashtags: readonly string[], readonly mentions: readonly string[]) {}

  static create(value = ''): Caption {
    if (value.length > Caption.MAX_LENGTH) {
      throw new Error(`Caption exceeds ${Caption.MAX_LENGTH} characters`);
    }

    const hashtags = [...value.matchAll(/(?:^|\s)#([\p{L}\p{N}_]+)/gu)].map((match) => match[1] as string);
    if (hashtags.length > Caption.MAX_HASHTAGS) {
      throw new Error(`Caption exceeds ${Caption.MAX_HASHTAGS} hashtags`);
    }

    const mentions = [...value.matchAll(/(?:^|\s)@([\p{L}\p{N}._]+)/gu)].map((match) => match[1] as string);
    if (mentions.length > Caption.MAX_MENTIONS) {
      throw new Error(`Caption exceeds ${Caption.MAX_MENTIONS} mentions`);
    }

    return new Caption(value, hashtags, mentions);
  }
}
