<script lang="ts">
import {
	EmbeddedIconButton,
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
} from "@acepe/ui/panel-header";
import { ResultAsync } from "neverthrow";
import { ArrowsClockwise } from "phosphor-svelte";
import { WarningCircle } from "phosphor-svelte";
import { getSingletonHighlighter, type Highlighter } from "shiki";
import type { Snippet } from "svelte";
import { onMount } from "svelte";
import { toast } from "svelte-sonner";
import CopyButton from "$lib/acp/components/messages/copy-button.svelte";
import { TIMING } from "$lib/acp/constants/timing.js";
import { loadCursorTheme } from "$lib/acp/utils/shiki-theme.js";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	error?: Error | null;
	reset?: () => void;
	children?: Snippet;
}

let { error: propError = null, reset, children }: Props = $props();

// Error state - initialized from prop, can be set by global handlers
// svelte-ignore state_referenced_locally
let error = $state<Error | null>(propError);
let highlighter = $state<Highlighter | null>(null);
let copiedMessage = $state(false);
let copiedFixPrompt = $state(false);

// Sync error from prop when it changes - use $effect
$effect(() => {
	if (propError !== null) {
		error = propError;
	}
});

// Initialize highlighter on mount (runs once)
onMount(() => {
	loadCursorTheme()
		.andThen((loadedTheme) => {
			return ResultAsync.fromPromise(
				getSingletonHighlighter({
					themes: [loadedTheme],
					langs: ["typescript", "javascript", "text", "json"],
				}),
				() => new Error("Failed to load highlighter")
			);
		})
		.map((h) => {
			highlighter = h;
		})
		.mapErr((err: Error) => {
			console.error("Failed to initialize highlighter:", err);
		});
});

// Compute highlighted error HTML - recomputes when highlighter or error changes
const highlightedError = $derived.by(() => {
	if (!highlighter || !error) {
		return "";
	}

	const errorText = formatErrorForDisplay(error);
	const loadedThemes = highlighter.getLoadedThemes();
	const themeName = loadedThemes.length > 0 ? loadedThemes[0] : "cursor-dark";
	return highlighter.codeToHtml(errorText, {
		lang: detectLanguage(errorText),
		theme: themeName,
	});
});

// Global error handler
onMount(() => {
	const handleError = (event: ErrorEvent) => {
		// Ignore benign ResizeObserver loop errors - they don't affect functionality
		if (event.message?.includes?.("ResizeObserver loop")) {
			return;
		}

		event.preventDefault();
		let err: Error;

		if (event.error instanceof Error) {
			// Preserve the original error and its stack trace
			err = event.error;
		} else if (event.error) {
			// If it's not an Error but has a value, create Error and preserve stack if possible
			const errorValue: unknown = event.error;
			err = new Error(String(errorValue));
			// Try to preserve any stack information from the event
			if (errorValue && typeof errorValue === "object" && "stack" in errorValue) {
				err.stack = String((errorValue as { stack: unknown }).stack);
			}
		} else {
			// Create new error with message and location info
			err = new Error(event.message || "Unknown error");
			// Add location information to help with debugging
			if (event.filename) {
				err.stack = `Error: ${err.message}\n    at ${event.filename}:${event.lineno}:${event.colno}`;
			}
		}

		error = err;
	};

	const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
		event.preventDefault();
		let err: Error;

		if (event.reason instanceof Error) {
			// Preserve the original error and its stack trace
			err = event.reason;
		} else if (event.reason) {
			// Try to preserve stack from non-Error objects that have stack
			const reasonValue: unknown = event.reason;
			err = new Error(String(reasonValue));
			if (reasonValue && typeof reasonValue === "object" && "stack" in reasonValue) {
				err.stack = String((reasonValue as { stack: unknown }).stack);
			}
		} else {
			// Create new error, but try to capture a stack trace
			err = new Error(String(event.reason || "Unhandled promise rejection"));
			// Capture current stack but remove the error boundary frame
			const stack = new Error().stack;
			if (stack) {
				const lines = stack.split("\n");
				// Remove the first line (Error message) and the error boundary frame
				const relevantLines = lines.slice(2);
				err.stack = `Error: ${err.message}\n${relevantLines.join("\n")}`;
			}
		}

		error = err;
	};

	window.addEventListener("error", handleError);
	window.addEventListener("unhandledrejection", handleUnhandledRejection);

	return () => {
		window.removeEventListener("error", handleError);
		window.removeEventListener("unhandledrejection", handleUnhandledRejection);
	};
});

function formatErrorForDisplay(err: Error): string {
	const lines: string[] = [];

	// Error name and message
	if (err.name && err.name !== "Error") {
		lines.push(`${err.name}: ${err.message}`);
	} else {
		lines.push(err.message);
	}

	// Stack trace
	if (err.stack) {
		// The stack trace already includes the error message as the first line
		// We want to show the full stack trace, but format it nicely
		const stackLines = err.stack.split("\n");

		// Check if the first line is just the error message (common format)
		// If so, skip it since we already displayed it above
		const firstLine = stackLines[0]?.trim() || "";
		const isFirstLineJustMessage =
			firstLine === `${err.name}: ${err.message}` || firstLine === err.message;

		const relevantStackLines = isFirstLineJustMessage ? stackLines.slice(1) : stackLines;

		if (relevantStackLines.length > 0) {
			lines.push("");
			lines.push("Stack trace:");
			// Show up to 50 lines for better debugging
			lines.push(...relevantStackLines.slice(0, 50));
			if (relevantStackLines.length > 50) {
				lines.push(`... (${relevantStackLines.length - 50} more lines)`);
			}
		}
	} else {
		// If no stack trace, at least indicate that
		lines.push("");
		lines.push("(No stack trace available)");
	}

	return lines.join("\n");
}

function detectLanguage(text: string): string {
	if (
		text.includes("SyntaxError") ||
		text.includes("TypeError") ||
		text.includes("ReferenceError")
	) {
		return "javascript";
	}
	if (text.includes("import") || text.includes("export") || text.includes("from")) {
		return "typescript";
	}
	return "text";
}

async function copyError() {
	if (!error) return;

	const errorText = formatErrorForDisplay(error);
	await ResultAsync.fromPromise(
		navigator.clipboard.writeText(errorText),
		(e) => new Error(`Failed to copy error: ${String(e)}`)
	)
		.map(() => {
			copiedMessage = true;
			toast.success(m.toast_error_copied());
			setTimeout(() => {
				copiedMessage = false;
			}, TIMING.TOAST_DURATION_MS);
		})
		.mapErr((e) => {
			toast.error(m.toast_error_copy_failed());
			console.error("Failed to copy error:", e);
		});
}

async function copyFixPrompt() {
	if (!error) return;

	const errorText = formatErrorForDisplay(error);
	const fixPrompt = `I encountered this error in my application. Please help me fix it:\n\n\`\`\`\n${errorText}\n\`\`\`\n\nWhat's causing this error and how can I fix it?`;

	await ResultAsync.fromPromise(
		navigator.clipboard.writeText(fixPrompt),
		(e) => new Error(`Failed to copy fix prompt: ${String(e)}`)
	)
		.map(() => {
			copiedFixPrompt = true;
			toast.success(m.toast_fix_prompt_copied());
			setTimeout(() => {
				copiedFixPrompt = false;
			}, TIMING.TOAST_DURATION_MS);
		})
		.mapErr((e) => {
			toast.error(m.toast_fix_prompt_copy_failed());
			console.error("Failed to copy fix prompt:", e);
		});
}

function handleReload() {
	window.location.reload();
}

function handleDismiss() {
	error = null;
	if (reset) {
		reset();
	}
}
</script>

{#if error}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
		<div
			class="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-border/40 bg-background overflow-hidden shadow-2xl"
			role="alert"
		>
			<!-- Header -->
			<EmbeddedPanelHeader class="bg-muted/10 border-border/30 shrink-0">
				<div class="flex items-center h-full border-r border-border/50 shrink-0">
					<EmbeddedIconButton ariaLabel="Error" class="pointer-events-none text-destructive">
						<WarningCircle class="h-3.5 w-3.5" weight="fill" />
					</EmbeddedIconButton>
				</div>
				<HeaderTitleCell compactPadding>
					<span class="text-[11px] font-semibold font-mono text-foreground select-none truncate leading-none">
						Application Error
					</span>
				</HeaderTitleCell>
				<HeaderActionCell>
					<CopyButton
						onClick={copyError}
						copied={copiedMessage}
						class="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors rounded-sm"
					/>
					<CopyButton
						onClick={copyFixPrompt}
						copied={copiedFixPrompt}
						class="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors rounded-sm"
					/>
				</HeaderActionCell>
			</EmbeddedPanelHeader>

			<!-- Error Display -->
			<div class="flex-1 min-h-0 overflow-auto error-boundary bg-muted/10">
				{#if highlightedError}
					<div class="p-0">
						{@html highlightedError}
					</div>
				{:else}
					<div class="p-4">
						<pre class="text-sm whitespace-pre-wrap font-mono text-foreground">{formatErrorForDisplay(error)}</pre>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="shrink-0 flex items-center h-7 border-t border-border/50 px-2 gap-1 justify-end">
				<button
					type="button"
					onclick={handleDismiss}
					class="h-5 px-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
				>
					Dismiss
				</button>
				<button
					type="button"
					onclick={handleReload}
					class="h-5 px-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
				>
					<ArrowsClockwise class="h-3 w-3" weight="fill" />
					{m.button_reload()}
				</button>
			</div>
		</div>
	</div>
{:else if children}
	{@render children()}
{/if}

<style>
	:global(.error-boundary pre) {
		margin: 0;
		padding: 1rem;
		overflow-x: auto;
		font-size: 0.875rem;
		line-height: 1.5;
		background: transparent !important;
	}

	:global(.error-boundary code) {
		font-family:
			ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
	}

	:global(.error-boundary .shiki) {
		margin: 0;
		padding: 1rem;
		overflow-x: auto;
		background: transparent !important;
	}
</style>
