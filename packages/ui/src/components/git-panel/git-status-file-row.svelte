<script lang="ts">
	/**
	 * GitStatusFileRow — Single file row in the git status list.
	 * Shows status icon, filename, DiffPill, and hover action buttons.
	 */
	import { FilePlus } from "phosphor-svelte";
	import { FileX } from "phosphor-svelte";
	import { FileDashed } from "phosphor-svelte";
	import { FileMinus } from "phosphor-svelte";
	import { File } from "phosphor-svelte";
	import PlusIcon from "../icons/plus-icon.svelte";
	import { ArrowCounterClockwise } from "phosphor-svelte";

	import { DiffPill } from "../diff-pill/index.js";
	import { getFileIconSrc, getFallbackIconSrc } from "../../lib/file-icon/index.js";
	import { cn } from "../../lib/utils.js";
	import type { GitIndexStatus, GitWorktreeStatus } from "./types.js";

	interface Props {
		path: string;
		status: GitIndexStatus | GitWorktreeStatus;
		additions: number;
		deletions: number;
		/** "staged" shows unstage (−) action, "unstaged" shows stage (+) and discard actions */
		section: "staged" | "unstaged";
		iconBasePath?: string;
		onStage?: (path: string) => void;
		onUnstage?: (path: string) => void;
		onDiscard?: (path: string) => void;
		class?: string;
	}

	let {
		path,
		status,
		additions,
		deletions,
		section,
		iconBasePath,
		onStage,
		onUnstage,
		onDiscard,
		class: className,
	}: Props = $props();

	const fileName = $derived(path.split("/").pop() ?? path);

	const useSvgIcons = $derived(Boolean(iconBasePath));
	const iconSrc = $derived(useSvgIcons ? getFileIconSrc(fileName, iconBasePath!) : "");
	const fallbackSrc = $derived(useSvgIcons ? getFallbackIconSrc(iconBasePath!) : "");

	function handleIconError(e: Event) {
		const img = e.target as HTMLImageElement;
		if (img) {
			img.onerror = null;
			img.src = fallbackSrc;
		}
	}
	const dirPath = $derived(() => {
		const parts = path.split("/");
		return parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";
	});

	function getStatusIconKind(s: GitIndexStatus | GitWorktreeStatus): FileStatusIconKind | null {
		switch (s) {
			case "added":
			case "deleted":
			case "renamed":
			case "untracked":
				return s;
			default:
				return null;
		}
	}

	function getStatusColor(s: GitIndexStatus | GitWorktreeStatus): string {
		switch (s) {
			case "added":
			case "untracked":
				return "text-success";
			case "deleted":
				return "text-destructive";
			case "renamed":
				return "text-warning";
			default:
				return "text-muted-foreground";
		}
	}

	function getStatusChar(s: GitIndexStatus | GitWorktreeStatus): string {
		switch (s) {
			case "added":
				return "A";
			case "modified":
				return "M";
			case "deleted":
				return "D";
			case "renamed":
				return "R";
			case "untracked":
				return "?";
			default:
				return "M";
		}
	}

	const statusIconKind = $derived(getStatusIconKind(status));
	const statusColor = $derived(getStatusColor(status));
	const statusChar = $derived(getStatusChar(status));
</script>

<div
	class={cn(
		"group flex items-center gap-1.5 px-2 py-0.5 text-left transition-colors hover:bg-muted/40",
		className,
	)}
	title={`${path} (+${additions} -${deletions})`}
>
	<!-- Status indicator -->
	<span class="shrink-0 w-3.5 text-center font-mono text-[0.625rem] font-bold {statusColor}">
		{statusChar}
	</span>

	<!-- File icon -->
	{#if useSvgIcons}
		<img
			src={iconSrc}
			alt=""
			class="h-3.5 w-3.5 shrink-0 object-contain"
			aria-hidden="true"
			onerror={handleIconError}
		/>
	{:else}
		<span class="shrink-0 {statusColor}">
			{#if statusIconKind}
				<FileStatusIcon
					status={statusIconKind}
					data-testid={`git-status-file-${statusIconKind}-rounded-icon`}
				/>
			{:else}
				<RoundedIcon
					name="file-text"
					class="size-3.5"
					data-testid="git-status-file-rounded-icon"
				/>
			{/if}
		</span>
	{/if}

	<!-- File name + directory -->
	<span class="min-w-0 flex-1 truncate font-mono text-[0.6875rem] leading-none text-foreground">
		{fileName}<span class="text-muted-foreground">{dirPath() ? ` — ${dirPath()}` : ""}</span>
	</span>

	<!-- Diff stats -->
	<DiffPill insertions={additions} {deletions} variant="plain" />

	<!-- Hover actions -->
	<div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
		{#if section === "unstaged"}
			{#if onStage}
				<button
					type="button"
					class="flex items-center justify-center h-5 w-5 rounded-md text-muted-foreground hover:text-success hover:bg-success/10 cursor-pointer transition-colors"
					title="Stage file"
					onclick={() => onStage?.(path)}
				>
					<PlusIcon />
				</button>
			{/if}
			{#if onDiscard}
				<button
					type="button"
					class="flex items-center justify-center h-5 w-5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer transition-colors"
					title="Discard changes"
					onclick={() => onDiscard?.(path)}
				>
					<RoundedIcon name="undo" class="size-3" />
				</button>
			{/if}
		{:else}
			{#if onUnstage}
				<button
					type="button"
					class="flex items-center justify-center h-5 w-5 rounded-md text-muted-foreground hover:text-warning hover:bg-warning/10 cursor-pointer transition-colors"
					title="Unstage file"
					onclick={() => onUnstage?.(path)}
				>
					<RoundedIcon name="minus" class="size-3" />
				</button>
			{/if}
		{/if}
	</div>
</div>
