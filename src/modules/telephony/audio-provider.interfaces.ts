/**
 * Audio playback providers for IVR. No voice provider is registered by default; the gateway
 * reports audio as unavailable and nothing is played or sent over the network.
 */
export const AUDIO_PROVIDERS = Symbol('AUDIO_PROVIDERS');

export interface AudioPlaybackCommand {
  kind: 'play-url' | 'play-text' | 'unavailable';
  url?: string;
  text?: string;
  message?: string;
}

export interface AudioProvider {
  readonly id: string;
  readonly isTestDouble?: boolean;
  buildLessonAudio(lessonId: string, language: string): Promise<AudioPlaybackCommand>;
}