import { File, type FileContents } from "@pierre/diffs";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { createCacheKey } from "../../../acp/utils/memoization.js";
import { buildPierreFileOptions, ensurePierreThemeRegistered } from "../../../acp/utils/pierre-rendering.js";
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
	private fileInstance: File<undefined> | null = $state(null);

	/**
	 * The container element where the file is rendered.
	 */
	private containerElement: HTMLElement | null = $state(null);

	/**
	 * ResultAsync that tracks theme registration to prevent race conditions.
	 * If set, registration is either in progress or complete.
	 */
	private currentOverflow: "scroll" | "wrap" = $state("scroll");
	private currentDisableLineNumbers = $state(false);
	private currentThemeType: "dark" | "light" = $state("dark");

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
			themeType?: "dark" | "light";
		}
	): ResultAsync<void, Error> {
		this.currentDisableLineNumbers = options?.disableLineNumbers ? options.disableLineNumbers : false;
		this.currentOverflow = options?.overflow ? options.overflow : "scroll";
		this.currentThemeType = options?.themeType ? options.themeType : "dark";

		return this.ensureThemeRegistered()
			.andThen(() => this.createFileInstance(container, options))
			.andThen(() => this.renderFile(fileContents, container));
	}

	private ensureThemeRegistered(): ResultAsync<void, Error> {
		return ResultAsync.fromPromise(ensurePierreThemeRegistered(), (e) => {
			if (e instanceof Error) {
				return new Error(`Failed to register theme for file view: ${e.message}`, { cause: e });
			}
			return new Error(`Failed to register theme for file view: ${String(e)}`);
		});
	}

	private createFileInstance(
		container: HTMLElement,
		options?: {
			disableLineNumbers?: boolean;
			overflow?: "scroll" | "wrap";
			themeType?: "dark" | "light";
		}
	): ResultAsync<void, Error> {
		this.containerElement = container;

		const nextOptions = buildPierreFileOptions(
			options?.themeType ? options.themeType : "dark",
			options?.overflow ? options.overflow : "scroll",
			options?.disableLineNumbers ? options.disableLineNumbers : false
		);

		return ResultAsync.fromPromise(
			new Promise<void>((resolve) => {
				if (this.fileInstance === null) {
					this.fileInstance = new File<undefined>(nextOptions, getWorkerPool());
				} else {
					this.fileInstance.setOptions(nextOptions);
				}
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

	setThemeType(themeType: "dark" | "light"): void {
		if (this.fileInstance === null) {
			this.currentThemeType = themeType;
			return;
		}

		this.currentThemeType = themeType;
		this.fileInstance.setOptions(
			buildPierreFileOptions(themeType, this.currentOverflow, this.currentDisableLineNumbers)
		);
		this.fileInstance.setThemeType(themeType);
	}

	/**
	 * Ensures the file contents has a cache key for Pierre's render cache.
	 * Generates one based on content hash if not present.
	 */
	private ensureCacheKey(fileContents: FileContents): FileContents {
		if (fileContents.cacheKey) {
			return fileContents;
		}
		return Object.assign({}, fileContents, {
			cacheKey: `file-view-${createCacheKey(fileContents.contents, fileContents.name)}`,
		});
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
		const currentFileInstance = this.fileInstance;
		if (currentFileInstance) {
			currentFileInstance.cleanUp();
			this.fileInstance = null;
		}
		this.containerElement = null;
	}
}
