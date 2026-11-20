import { Inject, Injectable, Optional } from '@nestjs/common';
import { AI_PROVIDERS, type AiProvider } from './ai.interfaces';

/** Looks up AiProvider implementations bound to AI_PROVIDERS. None are bound in production. */
@Injectable()
export class AiProviderRegistry {
  constructor(@Optional() @Inject(AI_PROVIDERS) private readonly providers: AiProvider[] = []) {}

  find(providerId: string): AiProvider | undefined {
    return this.providers.find((provider) => provider.id === providerId);
  }

  isRegistered(providerId: string): boolean {
    return this.find(providerId) !== undefined;
  }

  get size(): number {
    return this.providers.length;
  }
}
