<script lang="ts">
	import type { AgentPanelQuestionSelectEvent } from "./types.js";
	import AgentToolQuestion from "./agent-tool-question.svelte";
	import {
		createQuestionOtherSubmitEvent,
		getQuestionOtherText,
		updateQuestionOtherText,
		type AgentToolEntry,
		type QuestionOtherTextByEntry,
	} from "./agent-panel-conversation-entry-model.js";

	import type { ToolDurationTiming } from "./tool-duration.js";

	interface Props {
		entry: AgentToolEntry;
		durationTiming?: ToolDurationTiming;
		onQuestionSelect?: (event: AgentPanelQuestionSelectEvent) => void;
	}

	let { entry, durationTiming, onQuestionSelect }: Props = $props();

	let otherTextByEntry = $state<QuestionOtherTextByEntry>({});

	function otherText(toolEntry: AgentToolEntry): Record<number, string> {
		return getQuestionOtherText(otherTextByEntry, toolEntry.id);
	}

	function handleOtherInput(questionIndex: number, text: string): void {
		otherTextByEntry = updateQuestionOtherText({
			state: otherTextByEntry,
			entryId: entry.id,
			questionIndex,
			text,
		});
	}

	function handleOtherKeydown(
		questionIndex: number,
		key: string,
		multiSelect?: boolean
	): void {
		const event = createQuestionOtherSubmitEvent({
			state: otherTextByEntry,
			toolEntry: entry,
			questionIndex,
			key,
			multiSelect,
		});
		if (event === null) {
			return;
		}
		onQuestionSelect?.(event);
	}
</script>

{#if entry.question}
	<AgentToolQuestion
		questions={[entry.question]}
		status={entry.status}
		isInteractive={entry.status === "running"}
		otherText={otherText(entry)}
		{durationTiming}
		onSelect={(questionIndex, label, multiSelect) =>
			onQuestionSelect?.({
				entryId: entry.id,
				interactionId: entry.interactionId,
				questionIndex,
				label,
				multiSelect,
			})}
		onOtherInput={(questionIndex, text) => handleOtherInput(questionIndex, text)}
		onOtherKeydown={(questionIndex, key, multiSelect) =>
			handleOtherKeydown(questionIndex, key, multiSelect)}
	/>
{/if}
