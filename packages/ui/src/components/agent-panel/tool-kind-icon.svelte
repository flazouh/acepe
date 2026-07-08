<script lang="ts">
import { LoadingIcon, RoundedIcon, type RoundedIconName } from "../icons/index.js";
import { Colors } from "../../lib/colors.js";
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
	read: "file-text",
	read_lints: "tasks",
	review: "code",
	edit: "edit",
	delete: "trash",
	write: "edit",
	execute: "terminal",
	search: "search",
	fetch: "globe",
	web_search: "globe",
	think: "brain",
	skill: "skills",
	task: "tasks",
	task_output: "tasks",
	enter_plan_mode: "tasks",
	exit_plan_mode: "tasks",
	create_plan: "edit",
	browser: "app-window",
	sql: "app-window",
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
		class={className}
		style="width: {size}px; height: {size}px; color: {Colors.purple}"
		data-testid={kind === "review" ? "tool-kind-review-code-icon" : undefined}
	/>
{/if}
