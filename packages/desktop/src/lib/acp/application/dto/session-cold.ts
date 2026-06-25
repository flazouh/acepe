import type { SessionIdentity } from "./session-identity.js";
import type { SessionMetadata } from "./session-metadata.js";

/**
 * Session cold data - serializable to database.
 *
 * Combines immutable session facts with persisted metadata. Existing-session
 * reconnect still routes through backend descriptor resolution rather than
 * trusting these fields as frontend resume authority.
 */
export interface SessionCold extends SessionIdentity, SessionMetadata {}

export function sessionColdFromSlices(
	sessionIdentity: SessionIdentity,
	sessionMetadata: SessionMetadata
): SessionCold {
	return {
		id: sessionIdentity.id,
		projectPath: sessionIdentity.projectPath,
		agentId: sessionIdentity.agentId,
		worktreePath: sessionIdentity.worktreePath,
		title: sessionMetadata.title,
		createdAt: sessionMetadata.createdAt,
		updatedAt: sessionMetadata.updatedAt,
		sourcePath: sessionMetadata.sourcePath,
		sessionLifecycleState: sessionMetadata.sessionLifecycleState,
		parentId: sessionMetadata.parentId,
		prNumber: sessionMetadata.prNumber,
		prState: sessionMetadata.prState,
		prLinkMode: sessionMetadata.prLinkMode,
		linkedPr: sessionMetadata.linkedPr,
		worktreeDeleted: sessionMetadata.worktreeDeleted,
		sequenceId: sessionMetadata.sequenceId,
		usageStats: sessionMetadata.usageStats,
	};
}
