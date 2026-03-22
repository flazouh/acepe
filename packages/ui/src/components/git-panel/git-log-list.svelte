<script lang="ts">
	/**
	 * GitLogList — Scrollable commit history list with expandable file changes.
	 * Click a commit to expand/collapse its file list.
	 * Click a file to expand/collapse its inline diff (rendered via snippet).
	 */
	import type { Snippet } from "svelte";
	import CaretRight from "phosphor-svelte/lib/CaretRight";
	import GitCommit from "phosphor-svelte/lib/GitCommit";

	import { DiffPill } from "../diff-pill/index.js";
	import { getFileIconSrc, getFallbackIconSrc } from "../../lib/file-icon/index.js";
	import { cn } from "../../lib/utils.js";
	import type { GitLogEntry, GitLogEntryFile } from "./types.js";

	interface Props {
		entries: GitLogEntry[];
		/** Files for expanded commits, keyed by SHA */
		expandedCommitFiles?: Record<string, GitLogEntryFile[]>;
		/** Called when a commit is expanded (consumer fetches files) */
		onExpand?: (sha: string) => void;
		/** Called when a commit SHA is selected (e.g. open full diff viewer) */
		onSelect?: (sha: string) => void;
		/** Snippet for rendering a file's diff inline */
		fileDiffContent?: Snippet<[{ file: GitLogEntryFile }]>;
		/** Base path for file-type SVG icons */
		iconBasePath?: string;
		class?: string;
	}

	let {
		entries,
		expandedCommitFiles = {},
		onExpand,
		onSelect,
		fileDiffContent,
		iconBasePath,
		class: className,
	}: Props = $props();

	let expandedSha = $state<string | null>(null);
	let expandedFilePath = $state<string | null>(null);

	const useSvgIcons = $derived(Boolean(iconBasePath));
	const fallbackSrc = $derived(useSvgIcons ? getFallbackIconSrc(iconBasePath!) : "");

	function toggleExpand(sha: string) {
		if (expandedSha === sha) {
			expandedSha = null;
			expandedFilePath = null;
		} else {
			expandedSha = sha;
			expandedFilePath = null;
			onExpand?.(sha);
		}
	}

	function toggleFileDiff(filePath: string) {
		expandedFilePath = expandedFilePath === filePath ? null : filePath;
	}

	function getFileName(path: string): string {
		return path.split("/").pop() ?? path;
	}

	function handleIconError(e: Event) {
		const img = e.target as HTMLImageElement;
		if (img) {
			img.onerror = null;
			img.src = fallbackSrc;
		}
	}

	function getStatusChar(status: string): string {
		switch (status) {
			case "added":
				return "A";
			case "modified":
				return "M";
			case "deleted":
				return "D";
			case "renamed":
				return "R";
			default:
				return "M";
		}
	}

	function getStatusColor(status: string): string {
		switch (status) {
			case "added":
				return "text-success";
			case "deleted":
				return "text-destructive";
			case "renamed":
				return "text-warning";
			default:
				return "text-muted-foreground";
		}
	}
</script>

<div class={cn("flex flex-col overflow-y-auto", className)}>
	{#if entries.length === 0}
		<div class="flex items-center justify-center py-8 text-sm text-muted-foreground">
			No commits
		</div>
	{:else}
		{#each entries as entry (entry.sha)}
			{@const isExpanded = expandedSha === entry.sha}
			{@const files = expandedCommitFiles[entry.sha]}

			<!-- Commit row -->
			<button
				type="button"
				class={cn(
					"flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/40 transition-colors cursor-pointer",
					isExpanded && "bg-muted/30",
				)}
				onclick={() => toggleExpand(entry.sha)}
			>
				<CaretRight
					size={10}
					weight="bold"
					class={cn(
						"shrink-0 text-muted-foreground transition-transform duration-150",
						isExpanded && "rotate-90",
					)}
				/>

				<GitCommit size={14} weight="bold" class="text-success shrink-0" />

				<span class="font-mono text-[0.6875rem] text-muted-foreground shrink-0">
					{entry.shortSha}
				</span>

				<span class="min-w-0 flex-1 truncate text-[0.6875rem] text-foreground">
					{entry.message}
				</span>

				<span class="text-[0.625rem] text-muted-foreground shrink-0">
					{entry.author}
				</span>

				<span class="text-[0.625rem] text-muted-foreground shrink-0">
					{entry.date}
				</span>
			</button>

			<!-- Expanded file list -->
			{#if isExpanded}
				<div class="border-b border-border/20 bg-muted/10">
					{#if !files}
						<div class="flex items-center gap-2 px-6 py-2 text-[0.6875rem] text-muted-foreground">
							<span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"></span>
							Loading files...
						</div>
					{:else if files.length === 0}
						<div class="px-6 py-2 text-[0.6875rem] text-muted-foreground">
							No changed files
						</div>
					{:else}
						{#each files as file (file.path)}
							{@const fileName = getFileName(file.path)}
							{@const dirPath = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : ""}
							{@const isFileExpanded = expandedFilePath === file.path}

							<!-- File row -->
							<button
								type="button"
								class={cn(
									"flex items-center gap-1.5 w-full px-6 py-0.5 text-left hover:bg-muted/40 transition-colors cursor-pointer",
									isFileExpanded && "bg-muted/20",
								)}
								onclick={() => {
									if (fileDiffContent && file.patch) {
										toggleFileDiff(file.path);
									} else {
										onSelect?.(entry.sha);
									}
								}}
								title={file.path}
							>
								<!-- Expand caret (only if diff snippet available) -->
								{#if fileDiffContent && file.patch}
									<CaretRight
										size={8}
										weight="bold"
										class={cn(
											"shrink-0 text-muted-foreground/50 transition-transform duration-150",
											isFileExpanded && "rotate-90",
										)}
									/>
								{/if}

								<!-- Status indicator -->
								<span class="shrink-0 w-3 text-center font-mono text-[0.5625rem] font-bold {getStatusColor(file.status)}">
									{getStatusChar(file.status)}
								</span>

								<!-- File icon -->
								{#if useSvgIcons}
									<img
										src={getFileIconSrc(fileName, iconBasePath!)}
										alt=""
										class="h-3 w-3 shrink-0 object-contain"
										aria-hidden="true"
										onerror={handleIconError}
									/>
								{/if}

								<!-- File name + directory -->
								<span class="min-w-0 flex-1 truncate font-mono text-[0.625rem] leading-none text-foreground">
									{fileName}{#if dirPath}<span class="text-muted-foreground"> — {dirPath}</span>{/if}
								</span>

								<!-- Diff stats -->
								<DiffPill insertions={file.additions} deletions={file.deletions} variant="plain" class="text-[0.625rem]" />
							</button>

							<!-- Inline diff -->
							{#if isFileExpanded && fileDiffContent && file.patch}
								<div class="border-t border-border/10 bg-background">
									{@render fileDiffContent({ file })}
								</div>
							{/if}
						{/each}
					{/if}
				</div>
			{/if}
		{/each}
	{/if}
</div>
