import { Injectable } from '@nestjs/common';
import type { ContextBuilder, KnowledgeContext, RetrievedChunk } from './ai.interfaces';

/**
 * Numbers retrieved excerpts so responses can cite them as [1], [2], ... Excerpts that do not
 * fit in the character budget are left out rather than cut mid-text.
 */
@Injectable()
export class DefaultContextBuilder implements ContextBuilder {
  build(chunks: RetrievedChunk[], options: { maxChars: number }): KnowledgeContext {
    const references: RetrievedChunk[] = [];
    const blocks: string[] = [];
    let used = 0;
    let truncated = false;
    for (const chunk of chunks) {
      const block = `[${references.length + 1}] ${this.heading(chunk)}\n${chunk.text.trim()}`;
      const cost = block.length + (blocks.length > 0 ? 2 : 0);
      if (used + cost > options.maxChars) {
        truncated = true;
        continue;
      }
      blocks.push(block);
      references.push(chunk);
      used += cost;
    }
    return { text: blocks.join('\n\n'), references, truncated };
  }

  private heading(chunk: RetrievedChunk): string {
    const parts = [chunk.sourceTitle];
    if (chunk.sectionTitle) parts.push(chunk.sectionTitle);
    if (chunk.pageNumber !== null) parts.push(`p. ${chunk.pageNumber}`);
    return parts.join(' — ');
  }
}
