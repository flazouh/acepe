/**
 * File List State Manager
 *
 * Manages local UI state for the file list.
 * Follows idiomatic Svelte 5 pattern: classes manage local state, not props.
 */
import { SvelteSet } from "svelte/reactivity";

/**
 * Callback type for persistence notifications.
 */
export type OnChangeCallback = () => void;

export class FileListState {
	/**
	 * Set of expanded folder paths (format: "projectPath:folderPath").
	 */
	expandedFolders = $state(new SvelteSet<string>());

	/**
	 * Set of collapsed project paths.
	 */
	collapsedProjects = $state(new SvelteSet<string>());

	/**
	 * Optional callback when state changes (for persistence).
	 */
	private onChange: OnChangeCallback | null = null;

	/**
	 * Register a callback to be called when state changes.
	 * Used by workspace persistence to save file tree expansion state.
	 */
	setOnChange(callback: OnChangeCallback | null): void {
		this.onChange = callback;
	}

	/**
	 * Notify that state changed (debounced via workspace store).
	 */
	private notifyChange(): void {
		this.onChange?.();
	}

	/**
	 * Toggle a folder's expanded state.
	 */
	toggleFolder(projectPath: string, folderPath: string): void {
		const key = `${projectPath}:${folderPath}`;

		if (this.expandedFolders.has(key)) {
			this.expandedFolders.delete(key);
		} else {
			this.expandedFolders.add(key);
		}
		this.notifyChange();
	}

	/**
	 * Check if a folder is expanded.
	 */
	isFolderExpanded(projectPath: string, folderPath: string): boolean {
		return this.expandedFolders.has(`${projectPath}:${folderPath}`);
	}

	/**
	 * Toggle a project's collapsed state.
	 */
	toggleProject(projectPath: string): void {
		if (this.collapsedProjects.has(projectPath)) {
			this.collapsedProjects.delete(projectPath);
		} else {
			this.collapsedProjects.add(projectPath);
		}
		this.notifyChange();
	}

	/**
	 * Check if a project is collapsed.
	 */
	isProjectCollapsed(projectPath: string): boolean {
		return this.collapsedProjects.has(projectPath);
	}

	/**
	 * Expand all folders in a project.
	 */
	expandAllInProject(projectPath: string, folderPaths: string[]): void {
		for (const folderPath of folderPaths) {
			this.expandedFolders.add(`${projectPath}:${folderPath}`);
		}
		this.notifyChange();
	}

	/**
	 * Collapse all folders in a project.
	 */
	collapseAllInProject(projectPath: string): void {
		for (const key of this.expandedFolders) {
			if (key.startsWith(`${projectPath}:`)) {
				this.expandedFolders.delete(key);
			}
		}
		this.notifyChange();
	}

	/**
	 * Get the expansion state as a serializable object.
	 * Returns a map of projectPath -> array of expanded folder paths.
	 */
	getExpansionState(): Record<string, string[]> {
		const result: Record<string, string[]> = {};

		for (const key of this.expandedFolders) {
			const colonIndex = key.indexOf(":");
			if (colonIndex === -1) continue;

			const projectPath = key.substring(0, colonIndex);
			const folderPath = key.substring(colonIndex + 1);

			if (!result[projectPath]) {
				result[projectPath] = [];
			}
			result[projectPath].push(folderPath);
		}

		return result;
	}

	/**
	 * Restore expansion state from a serialized object.
	 * Does not trigger onChange to avoid circular persistence.
	 */
	setExpansionState(state: Record<string, string[]>): void {
		this.expandedFolders.clear();

		for (const [projectPath, folderPaths] of Object.entries(state)) {
			for (const folderPath of folderPaths) {
				this.expandedFolders.add(`${projectPath}:${folderPath}`);
			}
		}
	}
}
