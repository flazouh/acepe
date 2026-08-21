import * as Effect from "effect/Effect";
import { settings } from "$lib/utils/tauri-client/settings.js";

export interface ArchivedSessionRef {
	sessionId: string;
	projectPath: string;
	agentId: string;
}

export interface ThreadListSettings {
	hiddenProjects: string[];
	archivedSessions?: ArchivedSessionRef[];
}

/**
 * Service for persisting thread list display settings.
 * Handles project visibility toggles in the thread list sidebar.
 */
export class ThreadListSettingsService {
	/**
	 * Save thread list settings to persistent storage.
	 */
	saveSettings(settings: ThreadListSettings): Effect.Effect<void, Error> {
		return settingsService.saveThreadListSettings(settings).pipe(
			Effect.mapError((error) => {
				return new Error(`Failed to save thread list settings: ${error}`);
			})
		);
	}

	/**
	 * Load thread list settings from persistent storage.
	 * Returns default settings if none have been saved.
	 */
	getSettings(): Effect.Effect<ThreadListSettings, Error> {
		return settingsService.getThreadListSettings().pipe(
			Effect.mapError((error) => {
				return new Error(`Failed to get thread list settings: ${error}`);
			}),
			Effect.map((loaded) => ({
				hiddenProjects: loaded.hiddenProjects,
				archivedSessions: loaded.archivedSessions ?? [],
			}))
		);
	}

	/**
	 * Toggle visibility for a project.
	 * Returns the updated settings.
	 */
	toggleProjectVisibility(
		projectPath: string,
		currentSettings: ThreadListSettings
	): Effect.Effect<ThreadListSettings, Error> {
		const hiddenSet = new Set(currentSettings.hiddenProjects);

		if (hiddenSet.has(projectPath)) {
			hiddenSet.delete(projectPath);
		} else {
			hiddenSet.add(projectPath);
		}

		const newSettings: ThreadListSettings = {
			hiddenProjects: [...hiddenSet],
			archivedSessions: currentSettings.archivedSessions ?? [],
		};

		return this.saveSettings(newSettings).pipe(Effect.map(() => newSettings));
	}

	/**
	 * Set visibility for a specific project.
	 */
	setProjectVisibility(
		projectPath: string,
		visible: boolean,
		currentSettings: ThreadListSettings
	): Effect.Effect<ThreadListSettings, Error> {
		const hiddenSet = new Set(currentSettings.hiddenProjects);

		if (visible) {
			hiddenSet.delete(projectPath);
		} else {
			hiddenSet.add(projectPath);
		}

		const newSettings: ThreadListSettings = {
			hiddenProjects: [...hiddenSet],
			archivedSessions: currentSettings.archivedSessions ?? [],
		};

		return this.saveSettings(newSettings).pipe(Effect.map(() => newSettings));
	}

	/**
	 * Check if a project is visible (not hidden).
	 */
	isProjectVisible(projectPath: string, settings: ThreadListSettings): boolean {
		return !settings.hiddenProjects.includes(projectPath);
	}
}

// Singleton instance
let instance: ThreadListSettingsService | null = null;
const settingsService = settings;

export function getThreadListSettingsService(): ThreadListSettingsService {
	if (!instance) {
		instance = new ThreadListSettingsService();
	}
	return instance;
}
