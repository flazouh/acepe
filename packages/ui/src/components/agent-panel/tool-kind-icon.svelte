<script lang="ts">
import { LoadingIcon, RoundedIcon, type RoundedIconName } from "../icons/index.js";
import type { AgentToolKind, AgentToolStatus } from "./types.js";

interface Props {
	kind: AgentToolKind;
	status?: AgentToolStatus;
	size?: number;
	class?: string;
}

let {
	kind,
	status = "done",
	size = 12,
	class: className = "shrink-0",
}: Props = $props();
const isPending = $derived(status === "pending" || status === "running");

const roundedIconByKind: Record<AgentToolKind, RoundedIconName> = {
	read: "tool-read",
	read_lints: "tool-task",
	review: "tool-edit",
	edit: "tool-edit",
	delete: "trash",
	write: "tool-edit",
	execute: "terminal",
	search: "tool-search",
	fetch: "tool-web",
	web_search: "tool-web",
	think: "tool-think",
	skill: "tool-skill",
	task: "tool-task",
	task_output: "tool-task",
	enter_plan_mode: "tool-plan",
	exit_plan_mode: "tool-plan",
	create_plan: "tool-plan",
	browser: "tool-browser",
	sql: "tool-sql",
	unclassified: "question",
	other: "question",
};

const roundedIcon = $derived(roundedIconByKind[kind]);
</script>

{#if isPending}
	<LoadingIcon class={className} {size} aria-label="Loading" />
{:else if roundedIcon}
	<RoundedIcon
		name={roundedIcon}
		class="text-muted-foreground {className}"
		style="width: {size}px; height: {size}px"
		data-testid={`tool-kind-icon-${kind}`}
	/>
{/if}
