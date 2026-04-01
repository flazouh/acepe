<script lang="ts">
	import type { AnyAgentEntry, AgentToolStatus } from "@acepe/ui/agent-panel";

	interface Props {
		description: string | null;
		prompt?: string | null;
		resultText?: string | null;
		children?: AnyAgentEntry[];
		status?: AgentToolStatus;
		showDoneIcon?: boolean;
	}

	let {
		description,
		prompt = null,
		resultText = null,
		children = [],
		status = "done",
		showDoneIcon = false,
	}: Props = $props();
</script>

<div
	data-testid="agent-tool-task"
	data-description={description ?? ""}
	data-prompt={prompt ?? ""}
	data-result-text={resultText ?? ""}
	data-status={status}
	data-show-done-icon={showDoneIcon ? "true" : "false"}
	data-children={JSON.stringify(children)}
></div>