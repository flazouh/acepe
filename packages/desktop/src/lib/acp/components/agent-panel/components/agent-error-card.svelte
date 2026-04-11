<script lang="ts">
import { AgentPanelErrorCard as SharedAgentPanelErrorCard } from "@acepe/ui/agent-panel";

interface Props {
	title: string;
	summary: string;
	details: string;
	onRetry: () => void;
	onDismiss: () => void;
	onCreateIssue: () => void;
}

let { title, summary, details, onRetry, onDismiss, onCreateIssue }: Props = $props();
</script>

<SharedAgentPanelErrorCard {title} {summary} {details} {onRetry} {onDismiss} {onCreateIssue} />
