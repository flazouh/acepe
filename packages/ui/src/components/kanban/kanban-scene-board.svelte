<script lang="ts">
	import type { Snippet } from "svelte";

	import { AttentionQueueQuestionCard } from "../attention-queue/index.js";

	import KanbanBoard from "./kanban-board.svelte";
	import KanbanCard from "./kanban-card.svelte";
	import KanbanPermissionFooter from "./kanban-permission-footer.svelte";
	import KanbanSceneMenu from "./kanban-scene-menu.svelte";
	import KanbanScenePlanApprovalFooter from "./kanban-scene-plan-approval-footer.svelte";

	import type { KanbanCardData } from "./types.js";
	import type {
		KanbanSceneCardData,
		KanbanSceneColumnGroup,
		KanbanScenePermissionFooterData,
		KanbanScenePlanApprovalFooterData,
		KanbanSceneQuestionFooterData,
	} from "./kanban-scene-types.js";

	interface Props {
		groups: readonly KanbanSceneColumnGroup[];
		emptyHint?: string;
		todoSectionRenderer?: Snippet<[KanbanSceneCardData]>;
		onCardClick?: (cardId: string) => void;
		onCardClose?: (cardId: string) => void;
		onMenuAction?: (cardId: string, actionId: string) => void;
		onPermissionApprove?: (cardId: string) => void;
		onPermissionReject?: (cardId: string) => void;
		onPermissionAllowAlways?: (cardId: string) => void;
		onQuestionOptionSelect?: (cardId: string, currentQuestionIndex: number, optionLabel: string) => void;
		onQuestionOtherInput?: (cardId: string, currentQuestionIndex: number, value: string) => void;
		onQuestionOtherKeydown?: (cardId: string, currentQuestionIndex: number, key: string) => void;
		onQuestionSubmit?: (cardId: string) => void;
		onQuestionPrev?: (cardId: string, currentQuestionIndex: number) => void;
		onQuestionNext?: (cardId: string, currentQuestionIndex: number, totalQuestions: number) => void;
		onPlanApprove?: (cardId: string) => void;
		onPlanReject?: (cardId: string) => void;
	}

	let {
		groups,
		emptyHint,
		todoSectionRenderer,
		onCardClick,
		onCardClose,
		onMenuAction = () => {},
		onPermissionApprove = () => {},
		onPermissionReject = () => {},
		onPermissionAllowAlways = () => {},
		onQuestionOptionSelect = () => {},
		onQuestionOtherInput = () => {},
		onQuestionOtherKeydown = () => {},
		onQuestionSubmit = () => {},
		onQuestionPrev = () => {},
		onQuestionNext = () => {},
		onPlanApprove = () => {},
		onPlanReject = () => {},
	}: Props = $props();

	function resolveSceneCard(card: KanbanCardData): KanbanSceneCardData | null {
		if (
			!("footer" in card) ||
			!("menuActions" in card) ||
			!("showCloseAction" in card) ||
			!("hideBody" in card) ||
			!("flushFooter" in card)
		) {
			return null;
		}

		return card;
	}

	function resolveQuestionFooter(card: KanbanSceneCardData): KanbanSceneQuestionFooterData | null {
		if (!card.footer || card.footer.kind !== "question") {
			return null;
		}

		return card.footer;
	}

	function resolvePermissionFooter(card: KanbanSceneCardData): KanbanScenePermissionFooterData | null {
		if (!card.footer || card.footer.kind !== "permission") {
			return null;
		}

		return card.footer;
	}

	function resolvePlanApprovalFooter(card: KanbanSceneCardData): KanbanScenePlanApprovalFooterData | null {
		if (!card.footer || card.footer.kind !== "plan_approval") {
			return null;
		}

		return card.footer;
	}
</script>

<KanbanBoard {groups} {emptyHint}>
	{#snippet cardRenderer(card: KanbanCardData)}
		{@const sceneCard = resolveSceneCard(card)}
		{#if sceneCard}
			{@const questionFooterData = resolveQuestionFooter(sceneCard)}
			{@const permissionFooterData = resolvePermissionFooter(sceneCard)}
			{@const planApprovalFooterData = resolvePlanApprovalFooter(sceneCard)}
			<KanbanCard
				card={sceneCard}
				onclick={onCardClick ? () => onCardClick(sceneCard.id) : undefined}
				onClose={sceneCard.showCloseAction && onCardClose ? () => onCardClose(sceneCard.id) : undefined}
				showFooter={sceneCard.footer !== null}
				flushFooter={sceneCard.flushFooter}
				hideBody={sceneCard.hideBody}
			>
				{#if todoSectionRenderer}
					{#snippet todoSection()}
						{@render todoSectionRenderer(sceneCard)}
					{/snippet}
				{/if}

				{#if sceneCard.menuActions.length > 0}
					{#snippet menu()}
						<KanbanSceneMenu
							menuActions={sceneCard.menuActions}
							onMenuAction={(actionId: string) => onMenuAction(sceneCard.id, actionId)}
						/>
					{/snippet}
				{/if}

				{#if sceneCard.footer}
					{#snippet footer()}
						{#if questionFooterData}
							<AttentionQueueQuestionCard
								currentQuestion={questionFooterData.currentQuestion}
								totalQuestions={questionFooterData.totalQuestions}
								hasMultipleQuestions={questionFooterData.hasMultipleQuestions}
								currentQuestionIndex={questionFooterData.currentQuestionIndex}
								questionId={questionFooterData.questionId}
								questionProgress={questionFooterData.questionProgress}
								currentQuestionAnswered={questionFooterData.currentQuestionAnswered}
								currentQuestionOptions={questionFooterData.currentQuestionOptions}
								otherText={questionFooterData.otherText}
								otherPlaceholder={questionFooterData.otherPlaceholder}
								showOtherInput={questionFooterData.showOtherInput}
								showSubmitButton={questionFooterData.showSubmitButton}
								canSubmit={questionFooterData.canSubmit}
								submitLabel={questionFooterData.submitLabel}
								onOptionSelect={(optionLabel: string) =>
									onQuestionOptionSelect(sceneCard.id, questionFooterData.currentQuestionIndex, optionLabel)}
								onOtherInput={(value: string) =>
									onQuestionOtherInput(sceneCard.id, questionFooterData.currentQuestionIndex, value)}
								onOtherKeydown={(key: string) =>
									onQuestionOtherKeydown(sceneCard.id, questionFooterData.currentQuestionIndex, key)}
								onSubmitAll={() => onQuestionSubmit(sceneCard.id)}
								onPrevQuestion={() => onQuestionPrev(sceneCard.id, questionFooterData.currentQuestionIndex)}
								onNextQuestion={() =>
									onQuestionNext(sceneCard.id, questionFooterData.currentQuestionIndex, questionFooterData.totalQuestions)}
							/>
						{:else if permissionFooterData}
							<KanbanPermissionFooter
								permission={{
									label: permissionFooterData.label,
									command: permissionFooterData.command ? permissionFooterData.command : undefined,
									filePath: permissionFooterData.filePath ? permissionFooterData.filePath : undefined,
									toolKind: permissionFooterData.toolKind,
									progress: permissionFooterData.progress,
									allowAlwaysLabel: permissionFooterData.allowAlwaysLabel,
									approveLabel: permissionFooterData.approveLabel,
									rejectLabel: permissionFooterData.rejectLabel,
								}}
								onApprove={() => onPermissionApprove(sceneCard.id)}
								onAllowAlways={() => onPermissionAllowAlways(sceneCard.id)}
								onReject={() => onPermissionReject(sceneCard.id)}
							/>
						{:else if planApprovalFooterData}
							<KanbanScenePlanApprovalFooter
								prompt={planApprovalFooterData.prompt}
								approveLabel={planApprovalFooterData.approveLabel}
								rejectLabel={planApprovalFooterData.rejectLabel}
								onApprove={() => onPlanApprove(sceneCard.id)}
								onReject={() => onPlanReject(sceneCard.id)}
							/>
						{/if}
					{/snippet}
				{/if}
			</KanbanCard>
		{/if}
	{/snippet}
</KanbanBoard>
