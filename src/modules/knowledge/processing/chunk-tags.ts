import { detectTags, type TagDefinition } from './tagging';

export interface ChunkTagContext {
  /** Crops an administrator attached to the source. */
  sourceCropCodes: string[];
  /** Crops found in the whole document; used only when the source has none attached. */
  detectedCropCodes: string[];
  /** Topics an administrator attached to the source. */
  sourceTopicCodes: string[];
  topicDefinitions: TagDefinition[];
}

/**
 * Crops apply to the whole source. Topics are found per chunk; when the source has
 * topics attached, a chunk only gets those, falling back to all of them.
 */
export function chunkTags(
  text: string,
  context: ChunkTagContext,
): { cropCodes: string[]; topicCodes: string[] } {
  const cropCodes = [
    ...(context.sourceCropCodes.length > 0 ? context.sourceCropCodes : context.detectedCropCodes),
  ].sort();
  const detected = detectTags(text, context.topicDefinitions);
  if (context.sourceTopicCodes.length === 0) return { cropCodes, topicCodes: detected };
  const allowed = detected.filter((code) => context.sourceTopicCodes.includes(code));
  return {
    cropCodes,
    topicCodes: allowed.length > 0 ? allowed : [...context.sourceTopicCodes].sort(),
  };
}

export function topicDefinition(topic: {
  code: string;
  nameEn: string;
  nameRw: string | null;
  keywords: string[];
}): TagDefinition {
  return {
    code: topic.code,
    terms: [topic.nameEn, ...(topic.nameRw ? [topic.nameRw] : []), ...topic.keywords].filter(
      (term) => term.trim().length > 0,
    ),
  };
}
