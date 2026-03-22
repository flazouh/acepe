/**
 * Files Provider for the command palette.
 * Provides access to file search across all projects.
 */

import { invoke } from "@tauri-apps/api/core";
import { okAsync, ResultAsync as RA, type ResultAsync } from "neverthrow";
import { File } from "phosphor-svelte";

import type { IndexedFile, ProjectIndex } from "../../../../services/converted-session-types.js";
import type { PaletteItem, PaletteItemMetadata } from "../../../types/palette-item.js";
import { fuzzyMatchFiles } from "../../../utils/fuzzy-match.js";
import { createLogger } from "../../../utils/logger.js";
import type { Project, ProjectManager } from "../../project-manager.svelte.js";
import { getRecentItemsStore, type StoredRecentItem } from "../recent-items-store.svelte.js";
import type { PaletteProvider } from "./palette-provider.js";

const logger = createLogger({ id: "files-provider", name: "FilesProvider" });

/**
 * Handler for opening a file.
 */
export type OpenFileHandler = (filePath: string, projectPath: string) => void;

/**
 * Configuration for FilesProvider.
 */
export interface FilesProviderConfig {
	/** Project manager for project list */
	projectManager: ProjectManager;
	/** Handler for opening a file */
	onOpenFile: OpenFileHandler;
}

/**
 * Cached file index for a project.
 */
interface CachedProjectFiles {
	projectPath: string;
	files: IndexedFile[];
	loadedAt: number;
}

/** Cache duration: 30 seconds */
const CACHE_DURATION_MS = 30_000;

/**
 * Provider for command palette files mode.
 */
export class FilesProvider implements PaletteProvider {
	readonly mode = "files" as const;
	readonly label = "Files";
	readonly placeholder = "Search files...";

	private readonly recentStore = getRecentItemsStore();
	private readonly fileCache = new Map<string, CachedProjectFiles>();
	private loadingProjects = new Set<string>();

	constructor(private readonly config: FilesProviderConfig) {}

	/**
	 * Get all cached files across projects.
	 */
	private getAllCachedFiles(): Array<{ file: IndexedFile; project: Project }> {
		const now = Date.now();
		const results: Array<{ file: IndexedFile; project: Project }> = [];

		for (const project of this.config.projectManager.projects) {
			const cached = this.fileCache.get(project.path);
			if (cached && now - cached.loadedAt < CACHE_DURATION_MS) {
				for (const file of cached.files) {
					results.push({ file, project });
				}
			}
		}

		return results;
	}

	/**
	 * Load files for a project (lazy loading).
	 */
	loadProjectFiles(projectPath: string): ResultAsync<IndexedFile[], Error> {
		// Check cache
		const cached = this.fileCache.get(projectPath);
		const now = Date.now();
		if (cached && now - cached.loadedAt < CACHE_DURATION_MS) {
			return okAsync(cached.files);
		}

		// Check if already loading
		if (this.loadingProjects.has(projectPath)) {
			// Return empty for now, will be populated when load completes
			return okAsync([]);
		}

		this.loadingProjects.add(projectPath);

		return RA.fromPromise(
			invoke<ProjectIndex>("get_project_files", { projectPath }),
			(error) => new Error(`Failed to load files for ${projectPath}: ${error}`)
		)
			.map((index) => {
				this.fileCache.set(projectPath, {
					projectPath,
					files: index.files,
					loadedAt: Date.now(),
				});
				this.loadingProjects.delete(projectPath);
				return index.files;
			})
			.mapErr((error) => {
				this.loadingProjects.delete(projectPath);
				logger.error("Failed to load project files:", error);
				return error;
			});
	}

	/**
	 * Trigger loading of all projects in the background.
	 */
	preloadAllProjects(): void {
		for (const project of this.config.projectManager.projects) {
			this.loadProjectFiles(project.path).match(
				() => {},
				(error) => logger.warn(`Failed to preload ${project.path}:`, error)
			);
		}
	}

	/**
	 * Search for files matching the query.
	 */
	search(query: string): PaletteItem[] {
		// Trigger preload on first search
		if (this.fileCache.size === 0) {
			this.preloadAllProjects();
		}

		// Get all cached files
		const allFiles = this.getAllCachedFiles();

		if (allFiles.length === 0) {
			// Still loading - return empty
			return [];
		}

		// Create IndexedFile array for fuzzy matching
		const indexedFiles = allFiles.map(({ file }) => file);

		// Perform fuzzy search
		const results = fuzzyMatchFiles(query, indexedFiles, 50);

		// Map back to palette items with project info
		return results.map(({ item, score }) => {
			// Find the project for this file
			const fileEntry = allFiles.find((f) => f.file.path === item.path);
			const project = fileEntry?.project;

			return this.fileToPaletteItem(item, project, score);
		});
	}

	/**
	 * Convert a file to a palette item.
	 */
	private fileToPaletteItem(
		file: IndexedFile,
		project: Project | undefined,
		score?: number
	): PaletteItem {
		// Extract filename from path
		const lastSlash = file.path.lastIndexOf("/");
		const filename = lastSlash >= 0 ? file.path.slice(lastSlash + 1) : file.path;

		const metadata: PaletteItemMetadata = {
			projectPath: project?.path,
			projectName: project?.name,
			projectColor: project?.color,
			extension: file.extension,
		};

		return {
			id: project ? `${project.path}:${file.path}` : file.path,
			label: filename,
			description: file.path,
			icon: File,
			metadata,
			score,
		};
	}

	/**
	 * Execute: open the file.
	 */
	execute(item: PaletteItem): ResultAsync<void, Error> {
		// Add to recent
		this.addToRecent(item);

		// Parse the file path from the ID
		const colonIndex = item.id.indexOf(":");
		if (colonIndex > 0) {
			const projectPath = item.id.slice(0, colonIndex);
			const filePath = item.id.slice(colonIndex + 1);
			this.config.onOpenFile(filePath, projectPath);
		} else {
			// Fallback: use the ID as file path
			this.config.onOpenFile(item.id, item.metadata.projectPath ?? "");
		}

		return okAsync(undefined);
	}

	/**
	 * Get recently opened files.
	 */
	getRecent(): PaletteItem[] {
		const recent = this.recentStore.getRecent("files");
		return recent.map((stored) => this.storedToItem(stored));
	}

	/**
	 * Add a file to recent items.
	 */
	addToRecent(item: PaletteItem): void {
		this.recentStore.addRecent("files", {
			id: item.id,
			label: item.label,
			description: item.description,
		});
	}

	/**
	 * Convert a stored recent item back to a palette item.
	 */
	private storedToItem(stored: StoredRecentItem): PaletteItem {
		// Try to find project info
		const colonIndex = stored.id.indexOf(":");
		let project: Project | undefined;
		if (colonIndex > 0) {
			const projectPath = stored.id.slice(0, colonIndex);
			project = this.config.projectManager.projects.find((p) => p.path === projectPath);
		}

		// Extract extension from description (file path)
		const dotIndex = stored.label.lastIndexOf(".");
		const extension = dotIndex >= 0 ? stored.label.slice(dotIndex + 1) : "";

		return {
			id: stored.id,
			label: stored.label,
			description: stored.description,
			icon: File,
			metadata: {
				projectPath: project?.path,
				projectName: project?.name,
				projectColor: project?.color,
				extension,
			},
		};
	}

	/**
	 * Clear the file cache (useful when projects are updated).
	 */
	clearCache(): void {
		this.fileCache.clear();
	}

	/**
	 * Check if files are currently loading.
	 */
	get isLoading(): boolean {
		return this.loadingProjects.size > 0;
	}
}
