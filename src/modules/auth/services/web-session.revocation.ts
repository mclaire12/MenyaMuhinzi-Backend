import { Prisma, TokenRevocationReason } from '../../../generated/prisma/client';

type SessionRevoker = {
  webSession: {
    updateMany: (args: Prisma.WebSessionUpdateManyArgs) => Prisma.PrismaPromise<Prisma.BatchPayload>;
  };
};

/** Revokes every matching web session that is still active. Safe to include in an existing transaction. */
export function revokeActiveWebSessions(
  db: SessionRevoker,
  where: Prisma.WebSessionWhereInput,
  reason: TokenRevocationReason,
): Prisma.PrismaPromise<Prisma.BatchPayload> {
  return db.webSession.updateMany({
    where: { ...where, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}
