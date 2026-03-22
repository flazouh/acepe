import type { Session } from "../application/dto/session.js";
import type { Project } from "../logic/project-manager.svelte.js";

/**
 * Panel content types - discriminated union for panel states.
 *
 * A panel always has content - it's never "empty".
 * The content type determines what UI is shown.
 */
export type PanelContent = LoadingContent | ReadyContent | ErrorContent | ProjectSelectionContent;

/**
 * Loading state - panel is connecting to ACP.
 */
export interface LoadingContent {
	readonly type: "loading";
	readonly projectPath: string;
	readonly agentId?: string;
}

/**
 * Ready state - panel has an active session.
 */
export interface ReadyContent {
	readonly type: "ready";
	readonly session: Session;
}

/**
 * Error state - something went wrong.
 */
export interface ErrorContent {
	readonly type: "error";
	readonly message: string;
	readonly projectPath?: string;
	readonly agentId?: string;
}

/**
 * Project selection state - user needs to pick a project.
 */
export interface ProjectSelectionContent {
	readonly type: "project_selection";
	readonly projects: readonly Project[];
}

/**
 * Type guard for loading content.
 */
export function isLoadingContent(content: PanelContent): content is LoadingContent {
	return content.type === "loading";
}

/**
 * Type guard for ready content.
 */
export function isReadyContent(content: PanelContent): content is ReadyContent {
	return content.type === "ready";
}

/**
 * Type guard for error content.
 */
export function isErrorContent(content: PanelContent): content is ErrorContent {
	return content.type === "error";
}

/**
 * Type guard for project selection content.
 */
export function isProjectSelectionContent(
	content: PanelContent
): content is ProjectSelectionContent {
	return content.type === "project_selection";
}

// ============================================
// FACTORY FUNCTIONS
// ============================================

/**
 * Create a loading content.
 */
export function createLoadingContent(projectPath: string, agentId?: string): LoadingContent {
	return { type: "loading", projectPath, agentId };
}

/**
 * Create a ready content with a session.
 */
export function createReadyContent(session: Session): ReadyContent {
	return { type: "ready", session };
}

/**
 * Create an error content.
 */
export function createErrorContent(
	message: string,
	projectPath?: string,
	agentId?: string
): ErrorContent {
	return { type: "error", message, projectPath, agentId };
}

/**
 * Create a project selection content.
 */
export function createProjectSelectionContent(
	projects: readonly Project[]
): ProjectSelectionContent {
	return { type: "project_selection", projects };
}
