<script lang="ts">
import type { FileContents, SupportedLanguages } from "@pierre/diffs";

import { onDestroy, untrack } from "svelte";

import { useTheme } from "$lib/components/theme/context.svelte.js";

import { FileViewState } from "./file-view.svelte.js";

interface FileViewProps {
	/**
	 * The file contents to display.
	 * Can be a FileContents object or just content string.
	 */
	file: FileContents | string;

	/**
	 * Optional language override (used when file is a string).
	 */
	lang?: string;

	/**
	 * Optional filename (used when file is a string, for language detection).
	 */
	filename?: string;

	/**
	 * Optional max height override.
	 */
	maxHeight?: number;

	/**
	 * Whether to disable line numbers.
	 */
	disableLineNumbers?: boolean;

	/**
	 * Overflow behavior: 'scroll' or 'wrap'.
	 */
	overflow?: "scroll" | "wrap";
}

let {
	file,
	lang,
	filename,
	maxHeight,
	disableLineNumbers = false,
	overflow = "scroll",
}: FileViewProps = $props();

// Convert string content to FileContents if needed
const fileContents = $derived.by((): FileContents => {
	if (typeof file === "string") {
		const result: FileContents = {
			name: filename ? filename : "output.txt",
			contents: file,
		};
		// Only include lang if it's defined (FileContents["lang"] is optional)
		if (lang !== undefined) {
			result.lang = lang as SupportedLanguages;
		}
		return result;
	}
	return file;
});

let containerElement: HTMLDivElement | null = $state(null);
const fileViewState = new FileViewState();
let isInitialized = $state(false);
let initializationError = $state<Error | null>(null);
const themeState = useTheme();
const effectiveTheme = $derived(themeState.effectiveTheme);

// Track previous option values to detect changes
// Initialize as undefined to trigger first render as "options changed"
let previousDisableLineNumbers = $state<boolean | undefined>(undefined);
let previousOverflow = $state<"scroll" | "wrap" | undefined>(undefined);

// Initialize or update file when container and file are available
// Clear file when file becomes null
// Re-initialize when options change
$effect(() => {
	// Track if this effect is still valid (for race condition handling)
	let isValid = true;

	if (containerElement && fileContents) {
		const theme = effectiveTheme;
		const optionsChanged =
			previousDisableLineNumbers !== disableLineNumbers || previousOverflow !== overflow;

		if (!isInitialized || optionsChanged) {
			// Reset error state
			initializationError = null;

			fileViewState
				.initializeFile(fileContents, containerElement, {
					disableLineNumbers,
					overflow,
					themeType: theme,
				})
				.match(
					() => {
						// Only update state if this effect is still valid
						if (isValid) {
							isInitialized = true;
							previousDisableLineNumbers = disableLineNumbers;
							previousOverflow = overflow;
						}
					},
					(error) => {
						// Handle initialization errors
						if (isValid) {
							initializationError = error instanceof Error ? error : new Error(String(error));
							isInitialized = false;
							console.error("Failed to initialize file view:", error);
						}
					}
				);
		} else {
			// Only update file contents if options haven't changed
			fileViewState.updateFile(fileContents).mapErr((err) => {
				console.error("Failed to update file view:", err);
			});
		}
	} else if (isInitialized && !fileContents) {
		// Clear the file view when file becomes null
		fileViewState.cleanup();
		isInitialized = false;
		initializationError = null;
		previousDisableLineNumbers = disableLineNumbers;
		previousOverflow = overflow;
	}

	// Cleanup function to mark effect as invalid if it runs again
	return () => {
		isValid = false;
	};
});

$effect(() => {
	const theme = effectiveTheme;
	untrack(() => {
		fileViewState.setThemeType(theme);
	});
});

onDestroy(() => {
	fileViewState.cleanup();
});
</script>

<!-- Container for @pierre/diffs File -->
<div
	bind:this={containerElement}
	class="file-container"
	style="max-height: {maxHeight ? `${maxHeight}px` : 'none'}; overflow: auto;"
	role="region"
	aria-label="Code file view"
></div>

{#if initializationError}
	<div class="error-message text-destructive text-sm font-normal" role="alert">
		Failed to initialize file view: {initializationError.message}
	</div>
{/if}

<style>
	.file-container {
		width: 100%;
		min-height: 0;
	}

	/* @pierre/diffs renders into shadow DOM, so we style the container */
	:global(.file-container *) {
		font-family: "Fira Code", "JetBrains Mono", "Consolas", monospace;
	}

	.error-message {
		padding: 1rem;
		margin: 0.5rem 0;
		border-radius: 0.375rem;
	}
</style>
