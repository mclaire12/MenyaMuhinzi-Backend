import { TokenRevocationReason } from '../../../generated/prisma/client';
import { WebSessionService } from './web-session.service';

describe('WebSessionService session version', () => {
  it('does not rotate when the conditional version update matches nothing', async () => {
    const current = {
      id: 'session-row',
      revokedAt: null,
      sessionVersion: 2,
      userId: 'user-1',
    };
    const prisma = {
      webSession: {
        findFirst: jest.fn().mockResolvedValue(current),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const crypto = {
      sessionHashes: jest.fn().mockReturnValue(['hash']),
      generateSessionId: jest.fn().mockReturnValue('next-session-id'),
      hashSessionId: jest.fn().mockReturnValue('next-hash'),
    };
    const service = new WebSessionService(
      prisma as never,
      {} as never,
      crypto as never,
      { idleTtl: '30m', absoluteTtl: '12h' } as never,
    );

    await expect(service.rotateSessionId('current-session-id', 2)).resolves.toBeNull();
    expect(prisma.webSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-row', sessionVersion: 2, revokedAt: null },
      }),
    );
    expect(crypto.hashSessionId).toHaveBeenCalledWith('next-session-id');
    expect(JSON.stringify(prisma.webSession.updateMany.mock.calls)).not.toContain('next-session-id');
  });

  it('refuses to revoke a session that belongs to another user', async () => {
    const prisma = {
      webSession: {
        findFirst: jest.fn().mockResolvedValue({ id: 'session-row', userId: 'owner' }),
        updateMany: jest.fn(),
      },
    };
    const service = new WebSessionService(
      prisma as never,
      {} as never,
      { sessionHashes: () => ['hash'] } as never,
      { idleTtl: '30m', absoluteTtl: '12h' } as never,
    );

    await expect(
      service.revokeOne('session', 'other-user', TokenRevocationReason.LOGOUT),
    ).resolves.toBe(false);
    expect(prisma.webSession.updateMany).not.toHaveBeenCalled();
  });
});
