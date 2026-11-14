import {
  createShareLinkForActor,
  listShareLinksForActor,
  revokeShareLinkForActor,
} from '~/server/application/share-links';
import { logger } from '~/server/logging/logger';

export const shareLinkDependencies = {
  create: createShareLinkForActor,
  list: listShareLinksForActor,
  revoke: revokeShareLinkForActor,
  onError: (error: object, requestId: string) =>
    logger.error('Share request failed', { error, requestId }),
};
