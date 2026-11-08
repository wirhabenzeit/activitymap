// The Convex recording codec lives with the backend package; the mirror
// encodes files exactly as backend/ decodes them.
export { encodeWhole as encodeRecording } from '../../../backend/recording/codec';
