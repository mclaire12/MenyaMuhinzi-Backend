import type { PrismaClient } from '../src/generated/prisma/client';

const DEFAULTS = [
  {
    channel: 'USSD',
    sessionTtlSeconds: 180,
    maxScreenChars: 160,
    serviceCode: '*123#',
  },
  {
    channel: 'IVR',
    sessionTtlSeconds: 600,
    maxScreenChars: 160,
    accessNumber: '+250800000000',
  },
] as const;

/** USSD and IVR channels start disabled until an administrator enables them and a provider is registered. */
export async function seedTelephony(prisma: PrismaClient): Promise<void> {
  for (const defaults of DEFAULTS) {
    await prisma.telephonyChannelSetting.upsert({
      where: { channel: defaults.channel },
      update: {},
      create: {
        channel: defaults.channel,
        isEnabled: false,
        serviceCode: 'serviceCode' in defaults ? defaults.serviceCode : null,
        accessNumber: 'accessNumber' in defaults ? defaults.accessNumber : null,
        sessionTtlSeconds: defaults.sessionTtlSeconds,
        maxScreenChars: defaults.maxScreenChars,
        menuVersion: '1',
      },
    });
  }
}