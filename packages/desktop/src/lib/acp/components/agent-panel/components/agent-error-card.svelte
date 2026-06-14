<script lang="ts">
import { AgentPanelErrorCard as SharedAgentPanelErrorCard } from "@acepe/ui/agent-panel";

interface Props {
	title: string;
	summary: string;
	details: string;
	isRetrying?: boolean;
	onRetry?: (() => void) | undefined;
	onDismiss?: (() => void) | undefined;
	issueActionLabel?: string;
	onIssueAction?: (() => void) | undefined;
}

let {
	title,
	summary,
	details,
	isRetrying = false,
	onRetry,
	onDismiss,
	issueActionLabel = "Create issue",
	onIssueAction,
}: Props = $props();
</script>

<SharedAgentPanelErrorCard
	{title}
	{summary}
	{details}
	{isRetrying}
	{onRetry}
	{onDismiss}
	{issueActionLabel}
	{onIssueAction}
/>
