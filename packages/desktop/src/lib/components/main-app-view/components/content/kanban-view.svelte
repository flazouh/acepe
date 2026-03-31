<script lang="ts">
	import {
		KanbanBoard,
		KanbanCard,
		KanbanPermissionFooter,
		KanbanQuestionFooter,
		type KanbanCardData,
		type KanbanColumnGroup,
		type KanbanPermissionData,
		type KanbanQuestionData,
	} from "@acepe/ui";
	import type { QueueItem } from "$lib/acp/store/queue/types.js";
	import type { QueueSectionId } from "$lib/acp/store/queue/queue-section-utils.js";
	import { getAgentIcon } from "$lib/acp/constants/thread-list-constants.js";
	import { normalizeTitleForDisplay } from "$lib/acp/store/session-title-policy.js";
	import { formatTimeAgo } from "$lib/acp/utils/time-utils.js";
	import { getToolCompactDisplayText } from "$lib/acp/registry/tool-kind-ui-registry.js";
	import {
		extractPermissionCommand,
		extractPermissionFilePath,
	} from "$lib/acp/components/tool-calls/permission-display.js";
	import { makeWorkspaceRelative } from "$lib/acp/utils/path-utils.js";
	import {
		getPanelStore,
		getPermissionStore,
		getQueueStore,
		getQuestionStore,
	} from "$lib/acp/store/index.js";
	import { getQuestionSelectionStore } from "$lib/acp/store/question-selection-store.svelte.js";
	import { useTheme } from "$lib/components/theme/context.svelte.js";
	import { getQueueItemToolDisplay } from "$lib/acp/components/queue/queue-item-display.js";
	import * as m from "$lib/paraglide/messages.js";

	const panelStore = getPanelStore();
	const queueStore = getQueueStore();
	const permissionStore = getPermissionStore();
	const questionStore = getQuestionStore();
	const selectionStore = getQuestionSelectionStore();
	const themeState = useTheme();

	const SECTION_LABELS: Record<QueueSectionId, () => string> = {
		answer_needed: () => m.queue_group_answer_needed(),
		planning: () => m.queue_group_planning(),
		working: () => m.queue_group_working(),
		finished: () => m.queue_group_finished(),
		error: () => m.queue_group_error(),
	};

	const SECTION_ORDER: readonly QueueSectionId[] = [
		"answer_needed",
		"planning",
		"working",
		"finished",
		"error",
	];

	// NOTE: SECTION_LABELS is also defined in queue-section.svelte. Both are
	// thin i18n wrappers that cannot be extracted without coupling the store
	// layer to Paraglide runtime. Duplication is acceptable here.

	function mapItemToCard(item: QueueItem): KanbanCardData {
		const toolDisplay = getQueueItemToolDisplay({
			activityKind: item.state.activity.kind,
			currentStreamingToolCall: item.currentStreamingToolCall,
			currentToolKind: item.currentToolKind,
			lastToolCall: item.lastToolCall,
			lastToolKind: item.lastToolKind,
		});

		const activityText: string | null = (() => {
			if (item.state.activity.kind === "thinking") return "Thinking…";
			if (toolDisplay) {
				return getToolCompactDisplayText(
					toolDisplay.toolKind,
					toolDisplay.toolCall,
					toolDisplay.turnState
				);
			}
			return null;
		})();

		const isStreaming =
			item.state.activity.kind === "streaming" || item.state.activity.kind === "thinking";
		const modeLabel: string | null = item.currentModeId === "plan" ? "Plan" : null;
		const normalizedTitle = normalizeTitleForDisplay(item.title ? item.title : "");
		const timeAgo = formatTimeAgo(item.lastActivityAt);

		return {
			id: item.sessionId,
			title: normalizedTitle ? normalizedTitle : null,
			agentIconSrc: getAgentIcon(item.agentId, themeState.effectiveTheme),
			agentLabel: item.agentId,
			projectName: item.projectName,
			projectColor: item.projectColor,
			timeAgo: timeAgo ? timeAgo : "",
			activityText,
			isStreaming,
			modeLabel,
			diffInsertions: item.insertions,
			diffDeletions: item.deletions,
			errorText: item.state.connection === "error" ? "Connection error" : null,
			todoProgress: item.todoProgress
				? { current: item.todoProgress.current, total: item.todoProgress.total }
				: null,
		};
	}

	function getPermissionData(item: QueueItem): KanbanPermissionData | null {
		if (item.state.pendingInput.kind !== "permission") return null;
		const req = item.state.pendingInput.request;
		const command = extractPermissionCommand(req);
		const rawPath = extractPermissionFilePath(req);
		const filePath = rawPath ? makeWorkspaceRelative(rawPath, item.projectPath) : null;
		const parts = req.permission.split(" ");
		const verb = command || filePath ? (parts[0] ? parts[0] : req.permission) : req.permission;
		return { label: verb, command, filePath };
	}

	function getQuestionData(item: QueueItem): KanbanQuestionData | null {
		if (item.state.pendingInput.kind !== "question" || !item.pendingQuestion) return null;
		// TODO: support multi-question flows once the UI supports more than questions[0]
		const q = item.pendingQuestion.questions[0];
		if (!q) return null;
		const callId = item.pendingQuestion.tool?.callID;
		const questionId = callId ? callId : item.pendingQuestion.id ? item.pendingQuestion.id : "";
		const rawOptions = q.options;
		const options = (rawOptions ? rawOptions : []).map((opt) => ({
			label: opt.label,
			selected: selectionStore.isOptionSelected(questionId, 0, opt.label),
		}));
		const hasSelections = selectionStore.hasSelections(questionId, 0);
		return {
			questionText: q.question,
			options,
			canSubmit: hasSelections,
		};
	}

	const groups = $derived.by((): readonly KanbanColumnGroup[] => {
		return SECTION_ORDER.map((sectionId) => {
			const section = queueStore.sections.find((section) => section.id === sectionId);
			return {
				id: sectionId,
				label: SECTION_LABELS[sectionId](),
				items: section ? section.items.map(mapItemToCard) : [],
			};
		});
	});

	const itemLookup = $derived.by(() => {
		const map = new Map<string, QueueItem>();
		for (const section of queueStore.sections) {
			for (const item of section.items) {
				map.set(item.sessionId, item);
			}
		}
		return map;
	});

	function handleCardClick(cardId: string) {
		const item = itemLookup.get(cardId);
		if (!item || !item.panelId) return;
		if (item.projectPath) {
			panelStore.setFocusedViewProjectPath(item.projectPath);
		}
		panelStore.movePanelToFront(item.panelId);
		panelStore.setViewMode("single");
		panelStore.focusAndSwitchToPanel(item.panelId);
	}

	function handleApprovePermission(sessionId: string) {
		const item = itemLookup.get(sessionId);
		if (!item || item.state.pendingInput.kind !== "permission") return;
		const req = item.state.pendingInput.request;
		permissionStore.reply(req.id, "once");
	}

	function handleRejectPermission(sessionId: string) {
		const item = itemLookup.get(sessionId);
		if (!item || item.state.pendingInput.kind !== "permission") return;
		const req = item.state.pendingInput.request;
		permissionStore.reply(req.id, "reject");
	}

	function resolveQuestionId(pq: NonNullable<QueueItem["pendingQuestion"]>): string {
		const callId = pq.tool?.callID;
		return callId ? callId : pq.id ? pq.id : "";
	}

	function handleSelectOption(sessionId: string, optionIndex: number) {
		const item = itemLookup.get(sessionId);
		if (!item || !item.pendingQuestion) return;
		const q = item.pendingQuestion.questions[0];
		if (!q) return;
		const opts = q.options;
		const opt = opts ? opts[optionIndex] : undefined;
		if (!opt) return;
		const questionId = resolveQuestionId(item.pendingQuestion);
		if (q.multiSelect) {
			selectionStore.toggleOption(questionId, 0, opt.label);
			return;
		}
		selectionStore.setSingleOption(questionId, 0, opt.label);
	}

	function handleSubmitQuestion(sessionId: string) {
		const item = itemLookup.get(sessionId);
		if (!item || !item.pendingQuestion) return;
		const q = item.pendingQuestion.questions[0];
		if (!q) return;
		const questionId = resolveQuestionId(item.pendingQuestion);
		const answers = selectionStore.getAnswers(questionId, 0, q.multiSelect);
		if (answers.length === 0) return;
		questionStore.reply(
			item.pendingQuestion.id,
			[{ questionIndex: 0, answers }],
			item.pendingQuestion.questions
		);
	}
</script>

<KanbanBoard {groups} emptyHint="No sessions">
	{#snippet cardRenderer(card)}
		{@const item = itemLookup.get(card.id)}
		<KanbanCard {card} onclick={() => handleCardClick(card.id)}>
			{#snippet footer()}
				{#if item}
					{@const permData = getPermissionData(item)}
					{@const questData = getQuestionData(item)}
					{#if permData}
						<KanbanPermissionFooter
							permission={permData}
							onApprove={() => handleApprovePermission(card.id)}
							onReject={() => handleRejectPermission(card.id)}
						/>
					{:else if questData}
						<KanbanQuestionFooter
							question={questData}
							onSelectOption={(i) => handleSelectOption(card.id, i)}
							onSubmit={() => handleSubmitQuestion(card.id)}
						/>
					{/if}
				{/if}
			{/snippet}
		</KanbanCard>
	{/snippet}
</KanbanBoard>