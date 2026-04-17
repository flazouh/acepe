<script lang="ts">
import { AgentPanelErrorCard as SharedAgentPanelErrorCard } from "@acepe/ui/agent-panel";

interface Props {
	title: string;
	summary: string;
	details: string;
	referenceId?: string | null;
	referenceSearchable?: boolean;
	onRetry?: (() => void) | undefined;
	onDismiss?: (() => void) | undefined;
	onCopyReferenceId?: (() => void) | undefined;
	issueActionLabel?: string;
	onIssueAction?: (() => void) | undefined;
}

let {
	title,
	summary,
	details,
	referenceId = null,
	referenceSearchable = false,
	onRetry,
	onDismiss,
	onCopyReferenceId,
	issueActionLabel = "Create issue",
	onIssueAction,
}: Props = $props();
</script>

<SharedAgentPanelErrorCard
	{title}
	{summary}
	{details}
	referenceId={referenceId ?? undefined}
	{referenceSearchable}
	searchableReferenceLabel="Searchable in Sentry"
	localOnlyReferenceLabel="Local only"
	{onRetry}
	{onDismiss}
	{onCopyReferenceId}
	{issueActionLabel}
	{onIssueAction}
/>
