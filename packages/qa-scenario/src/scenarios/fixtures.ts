/**
 * Shared rows for authored scenarios.
 *
 * The canonical session fold does not populate the library scope, so a scenario
 * that expects the sidebar to show something states those rows itself.
 */

import type { ProjectId, RpcProjectedProject, RpcProjectedSession, SessionId } from "@acepe/contracts"

export const QA_PROJECT_ID = "qa-project" as ProjectId
export const QA_WORKSPACE_ROOT = "/Users/qa/acepe"
export const QA_STARTED_AT = "2026-08-27T10:00:00.000Z"

export const qaProject: RpcProjectedProject = {
	projectId: QA_PROJECT_ID,
	title: "Acepe",
	workspaceRoot: QA_WORKSPACE_ROOT,
	createdAt: QA_STARTED_AT,
	updatedAt: QA_STARTED_AT,
	deletedAt: null,
	sessionCount: 1,
	color: "cyan",
	showExternalCliSessions: false,
	sortOrder: null,
	gitStatus: [],
}

export const qaSessionRow = (sessionId: SessionId, title: string): RpcProjectedSession => ({
	sessionId,
	projectId: QA_PROJECT_ID,
	title,
	provider: "claude",
	createdAt: QA_STARTED_AT,
	updatedAt: QA_STARTED_AT,
	lastActivityAt: QA_STARTED_AT,
	archivedAt: null,
	deletedAt: null,
	prNumber: null,
	prLinkMode: null,
	providerSessionId: null,
	providerSessionFailed: false,
})
