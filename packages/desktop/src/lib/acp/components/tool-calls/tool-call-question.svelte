<script lang="ts">
import { AgentToolQuestion } from "@acepe/ui/agent-panel";
import { onMount } from "svelte";
import * as m from "$lib/paraglide/messages.js";
import { useSessionContext } from "../../hooks/use-session-context.js";
import { getInteractionStore } from "../../store/interaction-store.svelte.js";
import { getQuestionSelectionStore } from "../../store/question-selection-store.svelte.js";
import { getSessionStore } from "../../store/session-store.svelte.js";
import type { AnsweredQuestion } from "../../types/question.js";

import {
	findPendingQuestionForToolCall,
	resolveDisplayQuestions,
} from "../../store/question-selectors.js";
import { getQuestionStore } from "../../store/question-store.svelte.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";
import { ToolCallThinkState } from "./tool-call-think/state/tool-call-think-state.svelte.js";

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
}

let { toolCall, turnState, elapsedLabel }: Props = $props();

const interactionStore = getInteractionStore();
const questionStore = getQuestionStore();
const selectionStore = getQuestionSelectionStore();
const sessionStore = getSessionStore();
const sessionContext = useSessionContext();
const toolStatus = $derived(getToolStatus(toolCall, turnState));

// Create state manager for question data extraction
const thinkState = new ToolCallThinkState(
	() => toolCall,
	() => turnState
);

// Get the question ID for selection store (use toolCall.id as the key)
const questionId = $derived(toolCall.id);

// Find the matching pending question from the store
const pendingQuestion = $derived.by(() => {
	const sessionId = sessionContext?.sessionId;
	if (sessionId) {
		const operation = sessionStore.getOperationStore().getByToolCallId(sessionId, toolCall.id);
		if (operation) {
			const matchedQuestion = questionStore.getForOperation(operation);
			if (matchedQuestion) {
				return matchedQuestion;
			}
		}
	}

	return findPendingQuestionForToolCall(interactionStore.questionsPending.values(), toolCall.id);
});

const displayQuestions = $derived.by(() => {
	return (
		resolveDisplayQuestions(thinkState.questions, pendingQuestion) ??
		answeredQuestion?.questions ??
		null
	);
});

// Check if question has been answered (either from store or from history)
const answeredQuestionFromStore = $derived.by(() => {
	return questionStore.getAnswered(toolCall.id);
});

const answeredQuestionFromInteractions = $derived.by(() => {
	return interactionStore.answeredQuestions.get(toolCall.id);
});

// Convert history questionAnswer to AnsweredQuestion format if needed
const answeredQuestionFromHistory = $derived.by((): AnsweredQuestion | undefined => {
	const historyAnswer = toolCall.questionAnswer;
	if (!historyAnswer) return undefined;

	const answers: Record<string, string | string[]> = {};
	for (const [key, value] of Object.entries(historyAnswer.answers)) {
		if (typeof value === "string") {
			answers[key] = value;
		} else if (Array.isArray(value)) {
			answers[key] = value.filter((v): v is string => typeof v === "string");
		}
	}

	return {
		questions: historyAnswer.questions,
		answers,
		answeredAt: 0,
	};
});

// Prefer store (fresher) over history
const answeredQuestion = $derived(
	answeredQuestionFromInteractions ?? answeredQuestionFromStore ?? answeredQuestionFromHistory
);

// Determine if we're in interactive mode (question is pending in the store)
const isInteractive = $derived(pendingQuestion !== undefined);

// Check if question is answered (and not interactive)
const isAnswered = $derived(answeredQuestion !== undefined && !isInteractive);
const isCancelled = $derived(isAnswered && (answeredQuestion?.cancelled ?? false));

// For single question with single-select, we submit immediately on selection
const isSingleQuestionSingleSelect = $derived.by(() => {
	if (!displayQuestions?.[0]) return false;
	return displayQuestions.length === 1 && !displayQuestions[0].multiSelect;
});

// Convert displayQuestions to AgentQuestion format
const agentQuestions = $derived.by(() => {
	if (!displayQuestions) return null;
	return displayQuestions.map((q) => ({
		question: q.question,
		header: q.header ?? null,
		options:
			q.options?.map((o) => ({
				label: o.label,
				description: o.description ?? null,
			})) ?? null,
		multiSelect: q.multiSelect ?? false,
	}));
});

// Build selectedLabels map from selection store
const selectedLabels = $derived.by(() => {
	if (!displayQuestions) return {};
	const result: Record<number, string[]> = {};
	for (let i = 0; i < displayQuestions.length; i++) {
		const q = displayQuestions[i];
		if (!q) continue;
		const selections = selectionStore.getAnswers(questionId, i, q.multiSelect);
		if (selections.length > 0) result[i] = selections;
	}
	return result;
});

// Build otherText map from selection store
const otherText = $derived.by(() => {
	if (!displayQuestions) return {};
	const result: Record<number, string> = {};
	for (let i = 0; i < displayQuestions.length; i++) {
		const text = selectionStore.getOtherText(questionId, i);
		if (text) result[i] = text;
	}
	return result;
});

// Build answeredLabels map from answeredQuestion
const answeredLabels = $derived.by(() => {
	if (!answeredQuestion || !displayQuestions) return {};
	const result: Record<number, string[]> = {};
	for (let i = 0; i < displayQuestions.length; i++) {
		const q = displayQuestions[i];
		if (!q) continue;
		const answer = answeredQuestion.answers[q.question];
		if (typeof answer === "string") result[i] = [answer];
		else if (Array.isArray(answer)) result[i] = answer;
	}
	return result;
});

// Check if any answers are selected or "Other" text provided
const hasSelections = $derived.by(() => {
	if (!displayQuestions) return false;
	for (let i = 0; i < displayQuestions.length; i++) {
		if (selectionStore.hasSelections(questionId, i)) return true;
	}
	return false;
});

// Map tool status to AgentToolStatus
const agentStatus = $derived.by(() => {
	if (toolStatus.isPending) return "running" as const;
	if (toolStatus.isError) return "error" as const;
	return "done" as const;
});

function handleSelect(questionIndex: number, label: string, multiSelect?: boolean) {
	if (multiSelect) {
		selectionStore.toggleOption(questionId, questionIndex, label);
	} else {
		selectionStore.setSingleOption(questionId, questionIndex, label);
	}

	// For single question with single select, submit immediately
	if (isSingleQuestionSingleSelect && !multiSelect) {
		requestAnimationFrame(() => {
			if (!pendingQuestion || !displayQuestions) return;
			const answers = [{ questionIndex: 0, answers: [label] }];
			selectionStore.clearQuestion(questionId);
			questionStore.reply(pendingQuestion.id, answers, displayQuestions);
		});
	}
}

function handleOtherInput(questionIndex: number, text: string, multiSelect?: boolean) {
	selectionStore.setOtherText(questionId, questionIndex, text);

	if (text.trim() && !selectionStore.isOtherActive(questionId, questionIndex)) {
		selectionStore.setOtherModeActive(questionId, questionIndex, true);
		if (!multiSelect) {
			selectionStore.clearSelections(questionId, questionIndex);
		}
	}

	if (!text.trim() && selectionStore.isOtherActive(questionId, questionIndex)) {
		selectionStore.setOtherModeActive(questionId, questionIndex, false);
	}
}

function handleOtherKeydown(questionIndex: number, key: string) {
	if (key !== "Enter" || !pendingQuestion || !displayQuestions) {
		return;
	}

	const otherValue = selectionStore.getOtherText(questionId, questionIndex).trim();
	if (!otherValue) {
		return;
	}

	handleSubmit();
}

function handleSubmit() {
	if (!pendingQuestion || !displayQuestions) return;

	const answers = displayQuestions.map((q, index) => ({
		questionIndex: index,
		answers: selectionStore.getAnswers(questionId, index, q.multiSelect),
	}));

	selectionStore.clearQuestion(questionId);
	questionStore.reply(pendingQuestion.id, answers, displayQuestions);
}

function handleCancel() {
	if (pendingQuestion) {
		selectionStore.clearQuestion(questionId);
		questionStore.cancel(pendingQuestion.id);
	}
}

// Keyboard shortcuts for question options
onMount(() => {
	if (!isInteractive || !displayQuestions?.[0]?.options) return;

	const firstQuestion = displayQuestions[0];
	const handleKeyPress = (e: KeyboardEvent) => {
		const target = e.target as HTMLElement;
		if (
			target.tagName === "INPUT" ||
			target.tagName === "TEXTAREA" ||
			target.isContentEditable ||
			e.ctrlKey ||
			e.altKey ||
			e.metaKey
		) {
			return;
		}

		const num = parseInt(e.key, 10);
		if (firstQuestion.options && num >= 1 && num <= firstQuestion.options.length) {
			const option = firstQuestion.options[num - 1];
			if (option) handleSelect(0, option.label, firstQuestion.multiSelect);
		}
	};

	window.addEventListener("keydown", handleKeyPress);
	return () => window.removeEventListener("keydown", handleKeyPress);
});
</script>

<AgentToolQuestion
	questions={agentQuestions}
	{isInteractive}
	{isAnswered}
	{isCancelled}
	{answeredLabels}
	{selectedLabels}
	{otherText}
	status={agentStatus}
	durationLabel={elapsedLabel ?? undefined}
	onSelect={handleSelect}
	onOtherInput={handleOtherInput}
	onOtherKeydown={handleOtherKeydown}
	onSubmit={handleSubmit}
	onCancel={handleCancel}
	{hasSelections}
	waitingLabel={m.tool_question_waiting()}
	questionLabel={m.tool_question_label()}
	cancelledLabel={m.tool_question_cancelled_label()}
	cancelledDescription={m.tool_question_cancelled_description()}
	noAnswerLabel={m.tool_question_no_answer()}
	otherPlaceholder={m.tool_question_other_placeholder()}
	cancelLabel={m.tool_question_cancel()}
	submitLabel={m.tool_question_submit()}
/>
