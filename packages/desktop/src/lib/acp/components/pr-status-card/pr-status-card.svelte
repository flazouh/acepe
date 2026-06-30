<!--
  PrStatusCard — Collapsible PR card above modified files.

  Matches modified-files-header visual style (bg-accent bar).
  Left: PR icon + #N — clicking opens PR in browser.
  Right: DiffPill + chevron.
  Click bar: expand/collapse with markdown description + commit list below.

  During AI generation the card auto-opens and streams the PR title and
  description live via the `streamingData` prop.

  The merge button lives in ModifiedFilesHeader, not here.

  Fully presentational — all data is passed in as props.
-->
<script lang="ts">
import { AgentPanelPrCard as SharedAgentPanelPrCard, type AgentPanelPrCardModel } from "@acepe/ui";
import "@acepe/ui/markdown-prose.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import DiffViewerModal from "../diff-viewer/diff-viewer-modal.svelte";
import CiJobModal from "./ci-job-modal.svelte";
import PrChecksSurface from "../shared/pr-checks-surface.svelte";
import type { SessionLinkedPr } from "../../application/dto/session-linked-pr";
import { git, type CiJobDetails, type PrDetails } from "$lib/utils/tauri-client/git.js";
import type { ShipCardData } from "../ship-card/ship-card-parser.js";
import type { PrChecksItem } from "@acepe/ui";

interface Props {
	sessionId: string | null;
	projectPath: string;
	prNumber: number | null;
	isCreating: boolean;
	prDetails: PrDetails | null;
	fetchError: string | null;
	linkedPr: SessionLinkedPr | null;
	/** Live streaming data from AI generation — shown before the PR is created. */
	streamingData?: ShipCardData | null;
	onFixCheck?: (check: PrChecksItem) => void;
}

let {
	sessionId,
	projectPath,
	prNumber,
	isCreating,
	prDetails,
	fetchError,
	linkedPr,
	streamingData = null,
	onFixCheck,
}: Props = $props();

let diffModalOpen = $state(false);
let selectedCommitSha = $state<string | null>(null);

let ciModalOpen = $state(false);
let ciModalCheck = $state<PrChecksItem | null>(null);
let ciJobDetails = $state<CiJobDetails | null>(null);
let ciJobLoading = $state(false);

// Auto-expand when streaming data arrives
const isStreaming = $derived(streamingData?.started && !streamingData.complete);
const hasStreamingContent = $derived(
	streamingData !== null && (streamingData.prTitle !== null || streamingData.prDescription !== null)
);

// Show the card when streaming content arrives or a PR exists (not during initial creating phase)
const isVisible = $derived(prNumber !== null || hasStreamingContent);

// Derive the title to display — streaming title takes priority during generation
const displayTitle = $derived.by(() => {
	if (streamingData?.prTitle) return streamingData.prTitle;
	if (prDetails?.title) return prDetails.title;
	return null;
});

function handleOpenGitHub(e: MouseEvent) {
	e.stopPropagation();
	const url = prDetails?.url;
	if (url?.startsWith("https://github.com/")) {
		void openUrl(url).catch(() => {});
	}
}

function handleCommitClick(sha: string) {
	selectedCommitSha = sha;
	diffModalOpen = true;
}

async function handleViewDetails(check: PrChecksItem): Promise<void> {
	if (!check.detailsUrl) return;
	ciModalCheck = check;
	ciJobDetails = null;
	ciJobLoading = true;
	ciModalOpen = true;
	await git.ciJobDetails(projectPath, check.detailsUrl).match(
		(details) => {
			ciJobDetails = details;
			ciJobLoading = false;
		},
		() => {
			ciJobLoading = false;
		}
	);
}

function handleOpenCheck(
	check: NonNullable<AgentPanelPrCardModel["checks"]>[number],
	event: MouseEvent
) {
	event.stopPropagation();
	if (check.detailsUrl?.startsWith("https://github.com/")) {
		void openUrl(check.detailsUrl).catch(() => {});
	}
}

const prCardModel = $derived.by<AgentPanelPrCardModel>(() => {
	if (prDetails) {
		return {
			mode: "pr",
			number: prDetails.number,
			title: prDetails.title,
			state: prDetails.state,
			additions: prDetails.additions,
			deletions: prDetails.deletions,
			descriptionMarkdown: prDetails.body ?? "",
			commits: prDetails.commits.map((commit) => ({
				sha: commit.oid,
				message: commit.messageHeadline,
				insertions: commit.additions,
				deletions: commit.deletions,
				onClick: () => {
					handleCommitClick(commit.oid);
				},
			})),
			checks: linkedPr?.checks ?? [],
			isChecksLoading: linkedPr?.isChecksLoading ?? false,
			hasResolvedChecks: linkedPr?.hasResolvedChecks ?? false,
			checksCollapseThreshold: 3,
			onOpenCheck: handleOpenCheck,
			onFixCheck,
			onViewDetails: (check) => void handleViewDetails(check),
			onOpen: handleOpenGitHub,
		};
	}

	if (hasStreamingContent) {
		return {
			mode: "streaming",
			title: displayTitle,
			descriptionMarkdown: streamingData?.prDescription ?? "",
			isStreaming,
			generatingLabel: "Generating...",
		};
	}

	if (isCreating) {
		return {
			mode: "creating",
			number: prNumber,
			creatingLabel: "Creating PR...",
		};
	}

	return {
		mode: "pending",
		number: prNumber,
	};
});
</script>

{#if projectPath && linkedPr}
	{#key `${projectPath}:${linkedPr.prNumber}:${sessionId ?? "no-session"}`}
		<PrChecksSurface
			{projectPath}
			prNumber={linkedPr.prNumber}
			surfaceId={sessionId ? `agent-panel-pr-card:${sessionId}` : `agent-panel-pr-card:${linkedPr.prNumber}`}
		/>
	{/key}
{/if}

{#if isVisible}
	<SharedAgentPanelPrCard
		visible={isVisible}
		model={prCardModel}
		{fetchError}
		initiallyExpanded={hasStreamingContent}
	/>
{/if}

{#if diffModalOpen && selectedCommitSha}
	<DiffViewerModal
		open={diffModalOpen}
		reference={{ type: "commit", sha: selectedCommitSha }}
		{projectPath}
		onClose={() => {
			diffModalOpen = false;
			selectedCommitSha = null;
		}}
	/>
{/if}

{#if ciModalOpen && ciModalCheck}
	<CiJobModal
		open={ciModalOpen}
		check={ciModalCheck}
		job={ciJobDetails}
		isLoading={ciJobLoading}
		{projectPath}
		onClose={() => {
			ciModalOpen = false;
		}}
		onFix={(check) => {
			ciModalOpen = false;
			onFixCheck?.(check);
		}}
	/>
{/if}
