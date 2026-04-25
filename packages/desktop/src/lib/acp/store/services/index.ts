/**
 * Domain services for session management.
 *
 * These services are extracted from SessionStore to separate concerns:
 * - SessionRepository: CRUD + history loading
 * - SessionConnectionManager: Connection lifecycle + model/mode
 * - SessionMessagingService: Messaging + streaming
 */

// Re-export interfaces
export type {
	IConnectionManager,
	IEntryManager,
	ISessionStateReader,
	ISessionStateWriter,
	ITransientProjectionManager,
} from "./interfaces/index.js";

export { SessionConnectionManager } from "./session-connection-manager.js";
export { SessionMessagingService } from "./session-messaging-service.js";
// Re-export services
export { SessionRepository } from "./session-repository.js";
