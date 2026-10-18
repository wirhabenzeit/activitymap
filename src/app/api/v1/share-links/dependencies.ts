import { resolveActor } from '~/server/auth/actor';
import {
  createShareLinkForActor,
  listShareLinksForActor,
  revokeShareLinkForActor,
} from '~/server/application/share-links';

export const shareLinkDependencies = {
  resolveActor: (request: Request) => resolveActor(request.headers),
  create: createShareLinkForActor,
  list: listShareLinksForActor,
  revoke: revokeShareLinkForActor,
};
