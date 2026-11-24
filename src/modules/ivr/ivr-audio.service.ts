import { Inject, Injectable } from '@nestjs/common';
import { AUDIO_PROVIDERS, type AudioProvider } from '../telephony/audio-provider.interfaces';

@Injectable()
export class IvrAudioService {
  constructor(@Inject(AUDIO_PROVIDERS) private readonly providers: AudioProvider[]) {}

  get hasProvider(): boolean {
    return this.providers.length > 0;
  }

  async buildLessonCommand(lessonId: string, language: 'rw' | 'en') {
    const provider = this.providers[0];
    if (!provider) {
      return {
        kind: 'unavailable' as const,
        message:
          language === 'rw'
            ? 'Amajwi ntabwo aboneka. Nta serivisi yo gutanga amajwi irashyirwaho.'
            : 'Audio is unavailable. No voice provider is configured.',
      };
    }
    const command = await provider.buildLessonAudio(lessonId, language);
    return command;
  }
}
