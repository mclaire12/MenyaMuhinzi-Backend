import { KnowledgeSourceStatus, type Prisma } from '../../../generated/prisma/client';

type Client = Pick<Prisma.TransactionClient, 'knowledgeSource' | 'knowledgeSourceVersion'>;

/** The source shows the status of its latest version, or ARCHIVED once archived. */
export async function syncSourceStatus(
  client: Client,
  sourceId: string,
): Promise<KnowledgeSourceStatus> {
  const source = await client.knowledgeSource.findUniqueOrThrow({
    where: { id: sourceId },
    select: {
      archivedAt: true,
      versions: { orderBy: { versionNumber: 'desc' }, take: 1, select: { status: true } },
    },
  });
  const status = source.archivedAt
    ? KnowledgeSourceStatus.ARCHIVED
    : (source.versions[0]?.status ?? KnowledgeSourceStatus.DRAFT);
  await client.knowledgeSource.update({ where: { id: sourceId }, data: { status } });
  return status;
}
