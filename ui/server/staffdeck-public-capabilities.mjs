// Compatibility entry for server consumers. The protocol implementation has
// no Node/authentication dependencies and is shared with injected browser clients.
export {
  createPublicCapabilityClient,
  planPublicOperation,
  decodePublicJobEvents,
  PUBLIC_PROTOCOL_BLOCKERS,
  PublicCapabilityError,
} from '../shared/staffdeck-public-capabilities.mjs';
