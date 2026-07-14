/**
 * Sessions Provider for the command palette.
 * Provides access to session/thread search and navigation.
 */

import { okAsync, type ResultAsync } from "neverthrow";
import type { SessionPaletteReference } from "../../../store/session-cold-index.js";
import type { SessionStore } from "../../../store/session-store.svelte.js";
import { normalizeTitleForDisplay } from "../../../store/session-title-policy.js";
import type { PaletteItem, PaletteItemMetadata } from "../../../types/palette-item.js";
import type { ProjectManager } from "../../project-manager.svelte.js";
import { fuzzySearch } from "../fuzzy-search.js";
import { getRecentItemsStore, type StoredRecentItem } from "../recent-items-store.svelte.js";
import type { PaletteProvider } from "./palette-provider.js";

/**
 * Handler for opening a session.
 */
export type OpenSessionHandler = (sessionId: string, projectPath: string) => void;

/**
 * Configuration for SessionsProvider.
 */
export interface SessionsProviderConfig {
	/** Session store instance */
	sessionStore: SessionStore;
	/** Project manager for project metadata */
	projectManager: ProjectManager;
	/** Handler for opening a session */
	onOpenSession: OpenSessionHandler;
}

/**
 * Converts a session to a palette item.
 */
function sessionToPaletteItem(
	session: SessionPaletteReference,
	projectName: string,
	projectBadgeLabel?: string | null,
	projectColor?: string,
	projectIconSrc?: string | null
): PaletteItem {
	const metadata: PaletteItemMetadata = {
		projectPath: session.projectPath,
		projectName,
		projectBadgeLabel,
		projectColor,
		projectIconSrc,
		agentId: session.agentId,
	};

	return {
		id: session.id,
		label: normalizeTitleForDisplay(session.title ?? "") || "Untitled conversation",
		description: projectName,
		iconName: "chat",
		metadata,
	};
}

/**
 * Provider for command palette sessions mode.
 */
export class SessionsProvider implements PaletteProvider {
	readonly mode = "sessions" as const;
	readonly label = "Sessions";
	readonly placeholder = "Search conversations...";

	private readonly recentStore = getRecentItemsStore();

	constructor(private readonly config: SessionsProviderConfig) {}

	/**
	 * Get project metadata for a session.
	 */
	private getProjectInfo(projectPath: string): {
		name: string;
		badgeLabel: string | null;
		color?: string;
		iconSrc: string | null;
	} {
		const project = this.config.projectManager.getProject(projectPath);
		if (project) {
			return {
				name: project.name,
				badgeLabel: this.config.projectManager.getProjectBadgeLabel(project.path) ?? null,
				color: project.color,
				iconSrc: project.iconPath ?? null,
			};
		}
		// Fallback: extract name from path
		const parts = projectPath.split("/");
		return { name: parts[parts.length - 1] || projectPath, badgeLabel: null, iconSrc: null };
	}

	/**
	 * Search for sessions matching the query.
	 */
	search(query: string): PaletteItem[] {
		const sessions = this.config.sessionStore.read.getSessionPaletteReferences();

		// Convert sessions to searchable format
		const searchable = sessions.map((session) => {
			const projectInfo = this.getProjectInfo(session.projectPath);
			return {
				id: session.id,
				label: normalizeTitleForDisplay(session.title ?? "") || "Untitled conversation",
				description: projectInfo.name,
				_session: session,
				_projectInfo: projectInfo,
			};
		});

		// Perform fuzzy search
		const results = fuzzySearch(query, searchable);

		// Map back to palette items
		return results.map(({ item, score }) => {
			const paletteItem = sessionToPaletteItem(
				item._session,
				item._projectInfo.name,
				item._projectInfo.badgeLabel,
				item._projectInfo.color,
				item._projectInfo.iconSrc
			);
			return {
				id: paletteItem.id,
				label: paletteItem.label,
				description: paletteItem.description,
				icon: paletteItem.icon,
				iconName: paletteItem.iconName,
				metadata: paletteItem.metadata,
				score,
			};
		});
	}

	/**
	 * Execute: open the session.
	 */
	execute(item: PaletteItem): ResultAsync<void, Error> {
		// Add to recent
		this.addToRecent(item);

		// Open the session
		this.config.onOpenSession(item.id, item.metadata.projectPath ?? "");

		return okAsync(undefined);
	}

	/**
	 * Get recently accessed sessions.
	 */
	getRecent(): PaletteItem[] {
		const recent = this.recentStore.getRecent("sessions");
		return recent
			.map((stored) => this.storedToItem(stored))
			.filter((item): item is PaletteItem => item !== null);
	}

	/**
	 * Add a session to recent items.
	 */
	addToRecent(item: PaletteItem): void {
		this.recentStore.addRecent("sessions", {
			id: item.id,
			label: item.label,
			description: item.description,
		});
	}

	/**
	 * Convert a stored recent item back to a palette item.
	 */
	private storedToItem(stored: StoredRecentItem): PaletteItem | null {
		// Try to find the session in the store
		const session = this.config.sessionStore.read.getSessionPaletteReference(stored.id);
		if (session) {
			const projectInfo = this.getProjectInfo(session.projectPath);
			return sessionToPaletteItem(
				session,
				projectInfo.name,
				projectInfo.badgeLabel,
				projectInfo.color,
				projectInfo.iconSrc
			);
		}

		// Session not found - return a minimal item from stored data
		// This handles cases where the session was deleted
		return {
			id: stored.id,
			label: stored.label,
			description: stored.description,
			iconName: "chat",
			metadata: {},
		};
	}
}
