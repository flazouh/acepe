<script lang="ts">
import { AgentPanelErrorCard } from "@acepe/ui/agent-panel";
import { ResultAsync } from "neverthrow";
import { getSingletonHighlighter, type Highlighter } from "shiki";
import type { Snippet } from "svelte";
import { onMount } from "svelte";
import CopyButton from "$lib/acp/components/messages/copy-button.svelte";
import { loadCursorTheme } from "$lib/acp/utils/shiki-theme.js";
import { captureException, isSentryCaptureAvailable } from "$lib/analytics.js";
import { ensureErrorReference, findErrorReference } from "$lib/errors/error-reference.js";
import {
	buildIssueReportDraft,
	openIssueReportDraft,
	resolveIssueActionLabel,
} from "$lib/errors/issue-report.js";

interface Props {
	error?: Error | null;
	reset?: () => void;
	children?: Snippet;
}

let { error: propError = null, reset, children }: Props = $props();

// svelte-ignore state_referenced_locally
let error = $state<Error | null>(propError);
let highlighter = $state<Highlighter | null>(null);

const errorReference = $derived(error ? findErrorReference(error) : null);
const errorDisplayText = $derived(error ? formatErrorForDisplay(error) : "");

const issueDraft = $derived.by(() => {
	if (error === null) {
		return null;
	}

	return buildIssueReportDraft({
		title: `Application error: ${error.message}`,
		summary: error.message,
		details: errorDisplayText,
		referenceId: errorReference?.referenceId ?? null,
		referenceSearchable: errorReference?.searchable === true,
		surface: "global-error-boundary",
		diagnosticsSummary: error.message,
		metadata: [
			{
				label: "Error name",
				value: error.name,
			},
		],
	});
});

$effect(() => {
	if (propError !== null) {
		ensureErrorReference(propError);
		error = propError;
	}
});

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

const highlightedError = $derived.by(() => {
	if (!highlighter || !error) {
		return "";
	}

	const loadedThemes = highlighter.getLoadedThemes();
	const themeName = loadedThemes.length > 0 ? loadedThemes[0] : "cursor-dark";
	return highlighter.codeToHtml(errorDisplayText, {
		lang: detectLanguage(errorDisplayText),
		theme: themeName,
	});
});

function reportBoundaryError(
	nextError: Error,
	source: "window.error" | "window.unhandledrejection"
): void {
	const sentryAvailable = isSentryCaptureAvailable();
	const eventId = captureException(nextError, { source });
	ensureErrorReference(
		nextError,
		sentryAvailable && eventId !== null
			? {
					searchable: true,
					backendEventId: eventId,
				}
			: undefined
	);
	error = nextError;
}

onMount(() => {
	const handleError = (event: ErrorEvent) => {
		if (event.message?.includes?.("ResizeObserver loop")) {
			return;
		}

		event.preventDefault();
		let err: Error;

		if (event.error instanceof Error) {
			err = event.error;
		} else if (event.error) {
			const errorValue: unknown = event.error;
			err = new Error(String(errorValue));
			if (errorValue && typeof errorValue === "object" && "stack" in errorValue) {
				err.stack = String((errorValue as { stack: unknown }).stack);
			}
		} else {
			err = new Error(event.message || "Unknown error");
			if (event.filename) {
				err.stack = `Error: ${err.message}\n    at ${event.filename}:${event.lineno}:${event.colno}`;
			}
		}

		reportBoundaryError(err, "window.error");
	};

	const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
		event.preventDefault();
		let err: Error;

		if (event.reason instanceof Error) {
			err = event.reason;
		} else if (event.reason) {
			const reasonValue: unknown = event.reason;
			err = new Error(String(reasonValue));
			if (reasonValue && typeof reasonValue === "object" && "stack" in reasonValue) {
				err.stack = String((reasonValue as { stack: unknown }).stack);
			}
		} else {
			err = new Error(String(event.reason || "Unhandled promise rejection"));
			const stack = new Error().stack;
			if (stack) {
				const lines = stack.split("\n");
				const relevantLines = lines.slice(2);
				err.stack = `Error: ${err.message}\n${relevantLines.join("\n")}`;
			}
		}

		reportBoundaryError(err, "window.unhandledrejection");
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

	if (err.name && err.name !== "Error") {
		lines.push(`${err.name}: ${err.message}`);
	} else {
		lines.push(err.message);
	}

	if (err.stack) {
		const stackLines = err.stack.split("\n");
		const firstLine = stackLines[0]?.trim() || "";
		const isFirstLineJustMessage =
			firstLine === `${err.name}: ${err.message}` || firstLine === err.message;

		const relevantStackLines = isFirstLineJustMessage ? stackLines.slice(1) : stackLines;

		if (relevantStackLines.length > 0) {
			lines.push("");
			lines.push("Stack trace:");
			lines.push(...relevantStackLines.slice(0, 50));
			if (relevantStackLines.length > 50) {
				lines.push(`... (${relevantStackLines.length - 50} more lines)`);
			}
		}
	} else {
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

function handleIssueAction() {
	if (issueDraft === null) {
		return;
	}

	openIssueReportDraft(issueDraft);
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
		<div class="relative w-full max-w-2xl" role="alert">
			<div class="absolute top-1.5 right-1.5 z-10">
				<CopyButton variant="embedded" text={errorDisplayText} stopPropagation={true} />
			</div>

			<AgentPanelErrorCard
				title="Error"
				summary={error.message}
				details={highlightedError ? "" : errorDisplayText}
				detailsHtml={highlightedError || null}
				dismissLabel="Dismiss"
				retryLabel="Reload"
				issueActionLabel={issueDraft ? resolveIssueActionLabel(issueDraft) : undefined}
				onDismiss={handleDismiss}
				onRetry={handleReload}
				onIssueAction={issueDraft ? handleIssueAction : undefined}
			/>
		</div>
	</div>
{:else if children}
	{@render children()}
{/if}
