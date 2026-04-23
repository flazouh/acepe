<script lang="ts">
	import { mount, unmount } from "svelte";

	import { getMarkdownRenderApi } from "../../lib/markdown/index.js";
	import { getGitHubURL, type GitHubReference } from "../../lib/markdown/github-badge.js";
	import { getIconBasePath } from "../../lib/icon-context.js";
	import FilePathBadge from "../file-path-badge/file-path-badge.svelte";
	import GitHubBadge from "../github-badge/github-badge.svelte";

	import "./markdown-prose.css";

interface Props {
	content: string;
	class?: string;
	scrollable?: boolean;
	/** Text size class for the markdown content (e.g. "text-sm", "text-xs"). Defaults to "text-sm". */
	textSize?: string;
	/** Padding class applied to the rendered markdown wrapper. Defaults to "p-6". */
	contentPaddingClass?: string;
	/** Custom error message. Defaults to "Error rendering markdown" */
	errorMessage?: (error: string) => string;
	/**
	 * Base path for file type SVG icons (e.g. "/svgs/icons").
	 * Empty string (default) falls back to extension-colored dots.
	 */
	iconBasePath?: string;
}

let {
	content,
	class: className = "",
	scrollable = false,
	textSize = "text-sm",
	contentPaddingClass = "p-6",
	errorMessage,
	iconBasePath = getIconBasePath(),
}: Props = $props();

	const api = $derived(getMarkdownRenderApi());

	const syncResult = $derived(
		api ? api.renderMarkdownSync(content) : { html: null, fromCache: false, needsAsync: true }
	);

	let asyncHtml = $state<string | null>(null);
	let asyncError = $state<string | null>(null);
	let asyncPending = $state(false);
	let lastAsyncText = "";

	$effect(() => {
		if (!api) return;

		const result = syncResult;
		const currentText = content;

		if (result.needsAsync && !result.html && currentText !== lastAsyncText) {
			lastAsyncText = currentText;
			asyncPending = true;
			asyncError = null;

			api.renderMarkdown(currentText).match(
				(html) => {
					asyncHtml = html;
					asyncPending = false;
				},
				(err) => {
					asyncError = String(err);
					asyncPending = false;
				}
			);
		}
	});

	const html = $derived(syncResult.html ?? asyncHtml);
	const error = $derived(asyncError);
	const isLoading = $derived(syncResult.needsAsync && asyncPending);

	const displayErrorMessage = $derived(
		error ? (errorMessage ? errorMessage(error) : `Error rendering markdown: ${error}`) : ""
	);

	let containerRef: HTMLDivElement | null = $state(null);

	/** Mount FilePathBadge Svelte components into placeholder spans after each render. */
	$effect(() => {
		const container = containerRef;
		void html; // re-run when html changes

		if (!container) return;

		const placeholders = container.querySelectorAll<HTMLElement>(".file-path-badge-placeholder");
		const mounted: ReturnType<typeof mount>[] = [];

		for (const el of placeholders) {
			if (el.children.length > 0) continue; // already mounted

			const encoded = el.getAttribute("data-file-ref");
			if (!encoded) continue;

			try {
				const { filePath, locationSuffix } = JSON.parse(decodeURIComponent(encoded)) as {
					filePath: string;
					locationSuffix: string;
				};
				const displayName = filePath.split("/").pop() ?? filePath;
				const component = mount(FilePathBadge, {
					target: el,
					props: {
						filePath,
						fileName: locationSuffix ? `${displayName}${locationSuffix}` : undefined,
						iconBasePath,
						interactive: false,
					},
				});
				mounted.push(component);
			} catch {
				// Skip malformed placeholder
			}
		}

		return () => {
			for (const c of mounted) unmount(c);
		};
	});

	/** Mount shared GitHubBadge Svelte components into placeholder spans after each render. */
	$effect(() => {
		const container = containerRef;
		void html;

		if (!container) return;

		const placeholders = container.querySelectorAll<HTMLElement>(".github-badge-placeholder");
		const mounted: ReturnType<typeof mount>[] = [];

		for (const el of placeholders) {
			if (el.children.length > 0) continue;

			const encoded = el.getAttribute("data-github-ref");
			if (!encoded) continue;

			try {
				const ref = JSON.parse(decodeURIComponent(encoded)) as GitHubReference;
				const href = getGitHubURL(ref) || undefined;
				const component = mount(GitHubBadge, { target: el, props: { ref, href } });
				mounted.push(component);
			} catch {
				// Skip malformed placeholder
			}
		}

		return () => {
			for (const c of mounted) unmount(c);
		};
	});
</script>

<div
	class="min-w-0 max-w-full overflow-x-hidden overflow-y-auto {scrollable ? 'markdown-display-scrollable h-full w-full' : ''} {className}"
>
	{#if error}
		<div class="text-sm text-destructive p-4">
			<p class="font-medium">{displayErrorMessage}</p>
			<p class="whitespace-pre-wrap mt-2">{content}</p>
		</div>
	{:else if html}
		<div bind:this={containerRef} class="markdown-content min-w-0 max-w-full {contentPaddingClass} {textSize} leading-relaxed text-foreground">
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			{@html html}
		</div>
	{:else if isLoading}
		<div class="markdown-loading {textSize} text-foreground whitespace-pre-wrap leading-relaxed {contentPaddingClass}">
			{content}
		</div>
	{:else}
		<p class="{textSize} text-foreground whitespace-pre-wrap leading-relaxed {contentPaddingClass}">
			{content}
		</p>
	{/if}
</div>
