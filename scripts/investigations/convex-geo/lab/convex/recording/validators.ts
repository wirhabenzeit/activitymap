import { v } from 'convex/values';

export const scopeFields = {
  owner: v.string(),
  key: v.string(),
  accountGeneration: v.string(),
  sourceVersion: v.string(),
  generation: v.string(),
};

export {
  manifestValidator,
  summaryValidator,
} from '../../../../../../backend/convex/recordingValidators';

export function uploadContentType(attemptId: string) {
  return `application/vnd.activitymap.recording.${attemptId}+gzip`;
}
