import { File, type FileContents } from "@pierre/diffs";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { createCacheKey } from "../../../acp/utils/memoization.js";
import { registerCursorThemeForPierreDiffs } from "../../../acp/utils/pierre-diffs-theme.js";
import { getWorkerPool } from "../../../acp/utils/worker-pool-singleton.js";

/**
 * State manager for the File component from @pierre/diffs.
 *
 * Manages the File instance and rendering lifecycle for displaying
 * single code files with syntax highlighting.
 */
export class FileViewState {
	/**
	 * The File instance for rendering code.
	 */
	private fileInstance: File | null = $state(null);

	/**
	 * The container element where the file is rendered.
	 */
	private containerElement: HTMLElement | null = $state(null);

	/**
	 * ResultAsync that tracks theme registration to prevent race conditions.
	 * If set, registration is either in progress or complete.
	 */
	private static themeRegistrationResultAsync: ResultAsync<void, Error> | null = null;

	/**
	 * Initializes and renders the file using @pierre/diffs.
	 *
	 * @param fileContents - The file contents to render
	 * @param container - The container element to render into
	 * @param options - Optional rendering options
	 * @returns ResultAsync wrapping void on success, Error on failure
	 */
	initializeFile(
		fileContents: FileContents,
		container: HTMLElement,
		options?: {
			disableLineNumbers?: boolean;
			overflow?: "scroll" | "wrap";
		}
	): ResultAsync<void, Error> {
		return this.ensureThemeRegistered()
			.andThen(() => this.cleanupExistingInstance())
			.andThen(() => this.createFileInstance(container, options))
			.andThen(() => this.renderFile(fileContents, container));
	}

	private ensureThemeRegistered(): ResultAsync<void, Error> {
		if (!FileViewState.themeRegistrationResultAsync) {
			FileViewState.themeRegistrationResultAsync = ResultAsync.fromPromise(
				registerCursorThemeForPierreDiffs(),
				(e) => {
					if (e instanceof Error) {
						return new Error(`Failed to register theme for file view: ${e.message}`, { cause: e });
					}
					return new Error(`Failed to register theme for file view: ${String(e)}`);
				}
			).mapErr((err) => {
				// Reset on error to allow retry
				FileViewState.themeRegistrationResultAsync = null;
				return err;
			});
		}
		return FileViewState.themeRegistrationResultAsync;
	}

	private cleanupExistingInstance(): ResultAsync<void, Error> {
		if (this.fileInstance) {
			ResultAsync.fromPromise(
				new Promise<void>((resolve) => {
					const instance = this.fileInstance!;
					this.fileInstance = null;
					instance.cleanUp();
					resolve();
				}),
				(e) => {
					// Log cleanup errors but don't fail initialization
					console.warn("Error cleaning up existing file instance:", e);
					return new Error("Cleanup warning (non-fatal)");
				}
			).mapErr(() => {
				// Ignore cleanup errors - they're non-fatal
			});
		}
		return okAsync(undefined);
	}

	private createFileInstance(
		container: HTMLElement,
		options?: {
			disableLineNumbers?: boolean;
			overflow?: "scroll" | "wrap";
		}
	): ResultAsync<void, Error> {
		this.containerElement = container;

		return ResultAsync.fromPromise(
			new Promise<void>((resolve) => {
				// Create File instance with theme and worker pool for non-blocking highlighting
				// Using "Cursor Dark" theme (registered via registerCursorThemeForPierreDiffs)
				// For light mode, fall back to pierre-light if needed
				this.fileInstance = new File(
					{
						theme: { dark: "Cursor Dark", light: "pierre-light" },
						disableLineNumbers: options?.disableLineNumbers ?? false,
						overflow: options?.overflow ?? "scroll",
					},
					getWorkerPool()
				);
				resolve();
			}),
			(e) => {
				if (e instanceof Error) {
					return new Error(`Failed to create File instance: ${e.message}`, { cause: e });
				}
				return new Error(`Failed to create File instance: ${String(e)}`);
			}
		);
	}

	private renderFile(fileContents: FileContents, container: HTMLElement): ResultAsync<void, Error> {
		if (!this.fileInstance) {
			return errAsync(new Error("File instance not created"));
		}

		// Add cache key if not present for Pierre's render cache
		const fileWithCacheKey = this.ensureCacheKey(fileContents);

		return ResultAsync.fromPromise(
			new Promise<void>((resolve) => {
				this.fileInstance?.render({
					file: fileWithCacheKey,
					containerWrapper: container,
				});
				resolve();
			}),
			(e) => {
				// Clean up the instance if rendering fails
				this.fileInstance = null;
				if (e instanceof Error) {
					return new Error(`Failed to render file: ${e.message}`, { cause: e });
				}
				return new Error(`Failed to render file: ${String(e)}`);
			}
		);
	}

	/**
	 * Ensures the file contents has a cache key for Pierre's render cache.
	 * Generates one based on content hash if not present.
	 */
	private ensureCacheKey(fileContents: FileContents): FileContents {
		if (fileContents.cacheKey) {
			return fileContents;
		}
		return {
			...fileContents,
			cacheKey: `file-view-${createCacheKey(fileContents.contents, fileContents.name)}`,
		};
	}

	/**
	 * Updates the file with new contents.
	 *
	 * @param fileContents - The new file contents to render
	 * @returns ResultAsync wrapping void on success, Error on failure
	 */
	updateFile(fileContents: FileContents): ResultAsync<void, Error> {
		if (!this.fileInstance || !this.containerElement) {
			return okAsync(undefined);
		}

		// Add cache key if not present for Pierre's render cache
		const fileWithCacheKey = this.ensureCacheKey(fileContents);

		return ResultAsync.fromPromise(
			new Promise<void>((resolve) => {
				this.fileInstance?.render({
					file: fileWithCacheKey,
					containerWrapper: this.containerElement!,
				});
				resolve();
			}),
			(e) => {
				if (e instanceof Error) return e;
				return new Error(String(e));
			}
		);
	}

	/**
	 * Cleans up the File instance and removes event listeners.
	 */
	cleanup(): void {
		if (this.fileInstance) {
			this.fileInstance.cleanUp();
			this.fileInstance = null;
		}
		this.containerElement = null;
	}
}
