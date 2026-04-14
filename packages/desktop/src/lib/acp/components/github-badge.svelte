<script lang="ts">
import { GitHubBadge } from "@acepe/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GithubLogo } from "phosphor-svelte";

import type { GitHubReference } from "../constants/github-badge-html.js";
import { getGitHubURL } from "../constants/github-badge-html.js";
import { useSessionContext } from "../hooks/use-session-context.js";
import { fetchCommitDiff, fetchPrDiff } from "../services/github-service.js";
import { getPanelStore } from "../store/panel-store.svelte.js";
import CopyButton from "./messages/copy-button.svelte";

interface Props {
	ref: GitHubReference;
	repoContext?: { owner: string; repo: string };
	projectPath?: string;
}

let { ref, repoContext, projectPath: propProjectPath }: Props = $props();

const panelStore = getPanelStore();
const sessionContext = useSessionContext();
const contextProjectPath = $derived(sessionContext?.projectPath);
const projectPath = $derived(propProjectPath ?? contextProjectPath);

// Enhance commit ref with repo context if available
const enhancedRef = $derived.by(() => {
	if (ref.type === "commit" && repoContext && !ref.owner) {
		return {
			type: "commit" as const,
			sha: ref.sha,
			owner: repoContext.owner,
			repo: repoContext.repo,
		};
	}
	return ref;
});

const githubUrl = $derived(getGitHubURL(enhancedRef));

let insertions = $state(0);
let deletions = $state(0);
let prState = $state<"open" | "closed" | "merged" | undefined>(undefined);
let statsLoading = $state(false);
let hasLoadedStats = $state(false);
let lastStatsKey = $state("");

const statsKey = $derived.by(() => {
	if (enhancedRef.type === "commit") {
		return `commit:${projectPath ?? ""}:${enhancedRef.sha}`;
	}

	if (enhancedRef.type === "pr") {
		return `pr:${projectPath ?? ""}:${enhancedRef.owner}/${enhancedRef.repo}#${enhancedRef.number}`;
	}

	return `issue:${enhancedRef.owner}/${enhancedRef.repo}#${enhancedRef.number}`;
});

$effect(() => {
	const currentStatsKey = statsKey;
	if (currentStatsKey === lastStatsKey) {
		return;
	}

	lastStatsKey = currentStatsKey;
	insertions = 0;
	deletions = 0;
	prState = undefined;
	statsLoading = false;
	hasLoadedStats = false;

	if (enhancedRef.type === "pr") {
		ensureStatsLoaded();
	}
});

function ensureStatsLoaded() {
	if (hasLoadedStats || statsLoading || !projectPath || enhancedRef.type === "issue") {
		return;
	}

	hasLoadedStats = true;
	statsLoading = true;

	if (enhancedRef.type === "commit" && enhancedRef.sha) {
		void fetchCommitDiff(enhancedRef.sha, projectPath).then((result) => {
			result.match(
				(diff) => {
					const stats = diff.files.reduce(
						(acc, file) => ({
							insertions: acc.insertions + (file.additions ?? 0),
							deletions: acc.deletions + (file.deletions ?? 0),
						}),
						{ insertions: 0, deletions: 0 }
					);
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
					const stats = diff.files.reduce(
						(acc, file) => ({
							insertions: acc.insertions + (file.additions ?? 0),
							deletions: acc.deletions + (file.deletions ?? 0),
						}),
						{ insertions: 0, deletions: 0 }
					);
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
	if (enhancedRef.type === "commit") return enhancedRef.sha;
	return `${enhancedRef.owner}/${enhancedRef.repo}#${enhancedRef.number}`;
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
