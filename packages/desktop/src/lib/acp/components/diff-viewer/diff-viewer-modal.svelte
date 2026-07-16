<script lang="ts">
import {
	GitViewer,
	LoadingIcon,
	HugeiconsIcon,
} from "@acepe/ui";
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";
import { fetchCommitDiff, fetchPrDiff } from "../../services/github-service.js";
import type { CommitDiff, GitHubError, PrDiff } from "../../types/github-integration.js";
import { buildDiffViewerData } from "./diff-viewer-modal-state.js";
import PierreDiffView from "./pierre-diff-view.svelte";

interface Props {
	open: boolean;
	reference?: {
		type: "commit" | "pr";
		sha?: string;
		owner?: string;
		repo?: string;
		number?: number;
	};
	projectPath?: string;
	onClose: () => void;
}

let { open = $bindable(), reference, projectPath, onClose }: Props = $props();

let loading = $state(false);
let error = $state<GitHubError | null>(null);
let diff = $state<CommitDiff | PrDiff | null>(null);
let selectedFile = $state<string>("");
let viewMode = $state<"inline" | "side-by-side">("inline");

const viewerData = $derived(buildDiffViewerData(diff));

async function loadDiff() {
	if (!reference || !open) return;

	loading = true;
	error = null;
	diff = null;
	selectedFile = "";

	if (reference.type === "commit" && reference.sha && projectPath) {
		const result = await fetchCommitDiff(reference.sha, projectPath);
		result.match(
			(commitDiff) => {
				diff = commitDiff;
				if (diff.files.length > 0) {
					selectedFile = diff.files[0].path;
				}
			},
			(err) => {
				error = err;
			}
		);
	} else if (reference.type === "pr" && reference.owner && reference.repo && reference.number) {
		const result = await fetchPrDiff(reference.owner, reference.repo, reference.number);
		result.match(
			(prDiff) => {
				diff = prDiff;
				if (diff.files.length > 0) {
					selectedFile = diff.files[0].path;
				}
			},
			(err) => {
				error = err;
			}
		);
	} else {
		error = { type: "unknown_error", message: "Invalid reference or missing project path" };
	}

	loading = false;
}

$effect(() => {
	if (open && reference) {
		loadDiff();
	}
});

function handleClose() {
	onClose();
	diff = null;
	selectedFile = "";
	error = null;
}

function handleViewOnGitHub() {
	if (!viewerData) return;
	const url = viewerData.type === "commit" ? viewerData.commit.githubUrl : viewerData.pr.githubUrl;
	if (url) window.open(url, "_blank");
}

// Find the raw FileDiff from the backend data for rendering
function findRawFileDiff(path: string) {
	return diff?.files.find((f) => f.path === path);
}
</script>

<DialogFrame
	{open}
	title="GitHub diff viewer"
	closeLabel="Close diff viewer"
	contentOverflow="hidden"
	onOpenChange={(nextOpen) => {
		if (!nextOpen) {
			handleClose();
		}
	}}
>
	<div class="flex min-h-0 flex-1 flex-col">
		{#if loading}
			<div class="flex flex-1 flex-col items-center justify-center gap-3">
				<LoadingIcon size={24} />
				<p class="text-sm text-muted-foreground">Loading diff...</p>
			</div>
		{:else if error}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
				<HugeiconsIcon name="warning" class="h-6 w-6 text-destructive" />
				<div class="flex flex-col gap-1">
					<h3 class="text-sm font-semibold text-foreground">Error loading diff</h3>
					<p class="text-xs text-muted-foreground">{error.message}</p>
					{#if error.type === "gh_not_authenticated"}
						<p class="text-xs text-muted-foreground/70">
							Try running: <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
								>gh auth login</code
							>
						</p>
					{:else if error.type === "git_not_found"}
						<p class="text-xs text-muted-foreground/70">Git is not installed or not in PATH</p>
					{:else if error.type === "gh_not_found"}
						<p class="text-xs text-muted-foreground/70">GitHub CLI is not installed</p>
					{/if}
				</div>
				<button
					type="button"
					class="flex items-center gap-1.5 h-5 px-2.5 text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors rounded-sm"
					onclick={loadDiff}
				>
					<HugeiconsIcon name="refresh" class="h-3 w-3" />
					Retry
				</button>
			</div>
		{:else if viewerData}
			<GitViewer
				data={viewerData}
				{selectedFile}
				{viewMode}
				iconBasePath="/svgs/icons"
				onSelectFile={(path) => {
					selectedFile = path;
				}}
				onChangeViewMode={(mode) => {
					viewMode = mode;
				}}
				onViewOnGitHub={handleViewOnGitHub}
				class="flex-1 min-h-0"
			>
				{#snippet diffContent({ file, viewMode: mode })}
					{@const rawDiff = findRawFileDiff(file.path)}
					{#if rawDiff}
						<PierreDiffView diff={rawDiff} viewMode={mode} />
					{/if}
				{/snippet}
			</GitViewer>
		{/if}
	</div>
</DialogFrame>
