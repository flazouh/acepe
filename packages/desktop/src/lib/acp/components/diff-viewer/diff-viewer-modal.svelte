<script lang="ts">
import {
	type GitCommitData,
	type GitPrData,
	GitViewer,
	type GitViewerFile,
	LoadingIcon,
} from "@acepe/ui";
import ArrowsClockwise from "phosphor-svelte/lib/ArrowsClockwise";
import WarningCircle from "phosphor-svelte/lib/WarningCircle";
import X from "phosphor-svelte/lib/X";
import EmbeddedModalShell from "$lib/components/ui/embedded-modal-shell.svelte";
import { fetchCommitDiff, fetchPrDiff } from "../../services/github-service.js";
import type { CommitDiff, GitHubError, PrDiff } from "../../types/github-integration.js";
import { isCommitDiff } from "../../types/github-integration.js";
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

// Map backend diff types to shared GitViewer types
const viewerData = $derived.by(() => {
	if (!diff) return null;

	const mapFiles = (files: CommitDiff["files"] | PrDiff["files"]): GitViewerFile[] =>
		files.map((f) => ({
			path: f.path,
			status: f.status,
			additions: f.additions,
			deletions: f.deletions,
			patch: f.patch,
		}));

	if (isCommitDiff(diff)) {
		const commitData: GitCommitData = {
			sha: diff.sha,
			shortSha: diff.shortSha,
			message: diff.message,
			messageBody: diff.messageBody,
			author: diff.author,
			authorEmail: diff.authorEmail,
			date: diff.date,
			files: mapFiles(diff.files),
			githubUrl: diff.repoContext
				? `https://github.com/${diff.repoContext.owner}/${diff.repoContext.repo}/commit/${diff.sha}`
				: undefined,
		};
		return { type: "commit" as const, commit: commitData };
	}

	const prData: GitPrData = {
		number: diff.pr.number,
		title: diff.pr.title,
		author: diff.pr.author,
		state: diff.pr.state,
		description: diff.pr.description,
		files: mapFiles(diff.files),
		githubUrl: `https://github.com/${diff.repoContext.owner}/${diff.repoContext.repo}/pull/${diff.pr.number}`,
	};
	return { type: "pr" as const, pr: prData };
});

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

{#if open}
	<EmbeddedModalShell
		{open}
		ariaLabel="GitHub diff viewer"
		panelClass="embedded-diff-viewer-modal"
		onClose={handleClose}
	>
		<div class="flex min-h-0 flex-1 flex-col bg-background/95">
			<div class="flex items-center justify-end shrink-0 border-b border-border/30 px-3 py-2">
				<button
					type="button"
					class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					onclick={handleClose}
					title="Close (ESC)"
					aria-label="Close"
				>
					<X size={16} weight="bold" />
				</button>
			</div>

			{#if loading}
				<div class="flex flex-1 flex-col items-center justify-center gap-3">
					<LoadingIcon class="h-6 w-6" />
					<p class="text-sm text-muted-foreground">Loading diff...</p>
				</div>
			{:else if error}
				<div class="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
					<WarningCircle class="h-6 w-6 text-destructive" weight="fill" />
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
						<ArrowsClockwise class="h-3 w-3" weight="fill" />
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
	</EmbeddedModalShell>
{/if}
