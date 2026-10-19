import {
  createShareLinkForActor,
  listShareLinksForActor,
  revokeShareLinkForActor,
} from '~/server/application/share-links';

export const shareLinkDependencies = {
  create: createShareLinkForActor,
  list: listShareLinksForActor,
  revoke: revokeShareLinkForActor,
};
