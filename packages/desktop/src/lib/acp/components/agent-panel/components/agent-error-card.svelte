<script lang="ts">
import { AgentPanelErrorCard as SharedAgentPanelErrorCard } from "@acepe/ui/agent-panel";

interface Props {
	title: string;
	summary: string;
	details: string;
	detailsHtml?: string | null;
	isRetrying?: boolean;
	onRetry?: (() => void) | undefined;
	onDismiss?: (() => void) | undefined;
	issueActionLabel?: string;
	onIssueAction?: (() => void) | undefined;
	retryLabel?: string;
}

let {
	title,
	summary,
	details,
	detailsHtml = null,
	isRetrying = false,
	onRetry,
	onDismiss,
	issueActionLabel = "Create issue",
	onIssueAction,
	retryLabel,
}: Props = $props();
</script>

<SharedAgentPanelErrorCard
	{title}
	{summary}
	{details}
	{detailsHtml}
	{isRetrying}
	{onRetry}
	{onDismiss}
	{issueActionLabel}
	{onIssueAction}
	{retryLabel}
/>
