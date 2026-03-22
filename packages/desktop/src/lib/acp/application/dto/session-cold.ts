import type { SessionIdentity } from "./session-identity.js";
import type { SessionMetadata } from "./session-metadata.js";

/**
 * Session cold data - serializable to database.
 *
 * Combines identity and metadata. This is what gets persisted.
 * Does not include transient state (hot state) or content (entries).
 */
export interface SessionCold extends SessionIdentity, SessionMetadata {}
