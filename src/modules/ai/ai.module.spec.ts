import { MODULE_METADATA } from '@nestjs/common/constants';
import { AiModule } from './ai.module';
import { AI_PROVIDERS } from './orchestration/ai.interfaces';

describe('AiModule', () => {
  it('registers no AI provider, so no external AI service can be called', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AiModule) as unknown[];
    const binding = providers.find(
      (provider): provider is { provide: symbol; useValue: unknown } =>
        typeof provider === 'object' &&
        provider !== null &&
        (provider as { provide?: unknown }).provide === AI_PROVIDERS,
    );
    expect(binding?.useValue).toEqual([]);
  });
});
