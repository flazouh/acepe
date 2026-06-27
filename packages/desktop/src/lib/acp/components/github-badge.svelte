<script lang="ts">
import { GitHubBadge } from "@acepe/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GithubLogo } from "@acepe/ui/icons";

import type { GitHubReference } from "../constants/github-badge-html.js";
import { getGitHubURL } from "../constants/github-badge-html.js";
import { fetchCommitDiff, fetchPrDiff } from "../services/github-service.js";
import { getPanelStore } from "../store/panel-store.svelte.js";
import {
	enhanceGitHubReference,
	getGitHubBadgeCopyText,
	getGitHubBadgeResetStatsState,
	getGitHubDiffStats,
	getGitHubStatsKey,
	shouldLoadGitHubStats,
} from "./github-badge-state.js";
import CopyButton from "./messages/copy-button.svelte";

interface Props {
	ref: GitHubReference;
	repoContext?: { owner: string; repo: string };
	projectPath?: string;
}

let { ref, repoContext, projectPath }: Props = $props();

const panelStore = getPanelStore();

const enhancedRef = $derived.by(() => {
	return enhanceGitHubReference(ref, repoContext);
});

const githubUrl = $derived(getGitHubURL(enhancedRef));

let insertions = $state(0);
let deletions = $state(0);
let prState = $state<"open" | "closed" | "merged" | undefined>(undefined);
let statsLoading = $state(false);
let hasLoadedStats = $state(false);
let lastStatsKey = $state("");

const statsKey = $derived.by(() => {
	return getGitHubStatsKey({ ref: enhancedRef, projectPath });
});

function applyStatsReset(): void {
	const resetState = getGitHubBadgeResetStatsState();
	insertions = resetState.insertions;
	deletions = resetState.deletions;
	prState = resetState.prState;
	statsLoading = resetState.statsLoading;
	hasLoadedStats = resetState.hasLoadedStats;
}

$effect(() => {
	const currentStatsKey = statsKey;
	if (currentStatsKey === lastStatsKey) {
		return;
	}

	lastStatsKey = currentStatsKey;
	applyStatsReset();

	if (enhancedRef.type === "pr") {
		ensureStatsLoaded();
	}
});

function ensureStatsLoaded() {
	if (
		!shouldLoadGitHubStats({
			ref: enhancedRef,
			hasLoadedStats,
			statsLoading,
			projectPath,
		})
	) {
		return;
	}

	const currentProjectPath = projectPath;
	if (!currentProjectPath) {
		return;
	}

	hasLoadedStats = true;
	statsLoading = true;

	if (enhancedRef.type === "commit" && enhancedRef.sha) {
		void fetchCommitDiff(enhancedRef.sha, currentProjectPath).then((result) => {
			result.match(
				(diff) => {
					const stats = getGitHubDiffStats(diff.files);
					insertions = stats.insertions;
					deletions = stats.deletions;
				},
				() => {}
			);
			statsLoading = false;
		});
		return;
	}

	if (enhancedRef.type === "pr" && enhancedRef.owner && enhancedRef.repo) {
		void fetchPrDiff(enhancedRef.owner, enhancedRef.repo, enhancedRef.number).then((result) => {
			result.match(
				(diff) => {
					prState = diff.pr.state;
					const stats = getGitHubDiffStats(diff.files);
					insertions = stats.insertions;
					deletions = stats.deletions;
				},
				() => {}
			);
			statsLoading = false;
		});
		return;
	}

	statsLoading = false;
}

function handleClick(e: MouseEvent) {
	e.preventDefault();
	e.stopPropagation();
	if ((e.target as HTMLElement).closest(".github-badge-action-btn")) return;
	ensureStatsLoaded();
	if (enhancedRef.type === "issue" || !projectPath) return;

	if (enhancedRef.type === "pr") {
		panelStore.openGitDialog(projectPath, undefined, {
			section: "prs",
			prNumber: enhancedRef.number,
		});
		return;
	}

	panelStore.openGitDialog(projectPath, undefined, {
		section: "commits",
		commitSha: enhancedRef.sha,
	});
}

function handleOpenInBrowser(e: MouseEvent) {
	e.preventDefault();
	e.stopPropagation();
	if (githubUrl) openUrl(githubUrl);
}

function handlePointerEnter() {
	ensureStatsLoaded();
}

function handleFocus() {
	ensureStatsLoaded();
}

function getTextToCopy(): string {
	return getGitHubBadgeCopyText(enhancedRef);
}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="inline-flex" onmouseenter={handlePointerEnter} onfocusin={handleFocus}>
	<GitHubBadge
		ref={enhancedRef}
		{insertions}
		{deletions}
		{prState}
		loading={statsLoading}
		onclick={handleClick}
	>
		{#if githubUrl}
			<!-- Use span instead of button to avoid invalid nested <button> inside GitHubBadge's <button> -->
			<span
				role="button"
				tabindex="0"
				class="github-badge-action-btn shrink-0 inline-flex items-center justify-center rounded p-0.5 text-muted-foreground/50 hover:text-foreground transition-colors cursor-pointer"
				title="Open on GitHub"
				onclick={handleOpenInBrowser}
				onkeydown={(e) => {
					if (e.key === "Enter" || e.key === " ") handleOpenInBrowser(e as unknown as MouseEvent)
				}}
				onmouseenter={(e) => e.stopPropagation()}
			>
				<GithubLogo weight="fill" size={12} />
			</span>
		{/if}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<span onmouseenter={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()}>
			<CopyButton
				getText={getTextToCopy}
				size={12}
				variant="icon"
				class="github-badge-action-btn shrink-0"
				stopPropagation
			/>
		</span>
	</GitHubBadge>
</div>
