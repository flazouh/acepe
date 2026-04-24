<script lang="ts">
	import type { Snippet } from "svelte";

	import { AttentionQueueQuestionCard } from "../attention-queue/index.js";

	import {
		buildKanbanBoardLayout,
		type KanbanBoardColumnLayout,
		buildKanbanSceneModelFromGroups,
	} from "./kanban-board-layout.js";
	import KanbanBoard from "./kanban-board.svelte";
	import KanbanCard from "./kanban-card.svelte";
	import KanbanSceneMenu from "./kanban-scene-menu.svelte";
	import KanbanScenePlanApprovalFooter from "./kanban-scene-plan-approval-footer.svelte";
	import KanbanScenePrFooter from "./kanban-scene-pr-footer.svelte";

	import type {
		KanbanSceneCardData,
		KanbanSceneColumnGroup,
		KanbanSceneModel,
		KanbanScenePermissionFooterData,
		KanbanScenePlanApprovalFooterData,
		KanbanScenePrFooterData,
		KanbanSceneQuestionFooterData,
	} from "./kanban-scene-types.js";

interface Props {
	model?: KanbanSceneModel;
	groups?: readonly KanbanSceneColumnGroup[];
	emptyHint?: string;
	columnHeaderActions?: Snippet<[KanbanBoardColumnLayout["columnId"]]>;
	todoSectionRenderer?: Snippet<[KanbanSceneCardData]>;
	permissionFooterRenderer?: Snippet<[KanbanSceneCardData, KanbanScenePermissionFooterData]>;
	onCardClick?: (cardId: string) => void;
	onCardClose?: (cardId: string) => void;
	onMenuAction?: (cardId: string, actionId: string) => void;
	onQuestionOptionSelect?: (
		cardId: string,
		currentQuestionIndex: number,
		optionLabel: string
	) => void;
	onQuestionOtherInput?: (cardId: string, currentQuestionIndex: number, value: string) => void;
	onQuestionOtherKeydown?: (cardId: string, currentQuestionIndex: number, key: string) => void;
	onQuestionSubmit?: (cardId: string) => void;
	onQuestionPrev?: (cardId: string, currentQuestionIndex: number) => void;
	onQuestionNext?: (cardId: string, currentQuestionIndex: number, totalQuestions: number) => void;
	onPlanApprove?: (cardId: string) => void;
	onPlanReject?: (cardId: string) => void;
	onPrFooterOpen?: (cardId: string) => void;
	onPrFooterOpenExternal?: (cardId: string) => void;
}

let {
	model,
	groups,
	emptyHint,
	columnHeaderActions,
	todoSectionRenderer,
	permissionFooterRenderer,
	onCardClick,
	onCardClose,
	onMenuAction = () => {},
	onQuestionOptionSelect = () => {},
	onQuestionOtherInput = () => {},
	onQuestionOtherKeydown = () => {},
	onQuestionSubmit = () => {},
	onQuestionPrev = () => {},
	onQuestionNext = () => {},
	onPlanApprove = () => {},
	onPlanReject = () => {},
	onPrFooterOpen = () => {},
	onPrFooterOpenExternal = () => {},
}: Props = $props();

const sceneModel = $derived.by((): KanbanSceneModel => {
	if (model) {
		return model;
	}

	return buildKanbanSceneModelFromGroups(groups ? groups : []);
});

const boardLayout = $derived.by(() => {
	return buildKanbanBoardLayout(sceneModel);
});

function resolveQuestionFooter(card: KanbanSceneCardData): KanbanSceneQuestionFooterData | null {
	if (!card.footer || card.footer.kind !== "question") {
		return null;
	}

	return card.footer;
}

function resolvePermissionFooter(
	card: KanbanSceneCardData
): KanbanScenePermissionFooterData | null {
	if (!card.footer || card.footer.kind !== "permission") {
		return null;
	}

	return card.footer;
}

function resolvePlanApprovalFooter(
	card: KanbanSceneCardData
): KanbanScenePlanApprovalFooterData | null {
	if (!card.footer || card.footer.kind !== "plan_approval") {
		return null;
	}

	return card.footer;
}

function resolvePrFooter(card: KanbanSceneCardData): KanbanScenePrFooterData | null {
	return card.prFooter;
}
</script>

<KanbanBoard layout={boardLayout} {emptyHint} {columnHeaderActions}>
	{#snippet cardRenderer(sceneCard: KanbanSceneCardData)}
		{@const questionFooterData = resolveQuestionFooter(sceneCard)}
		{@const permissionFooterData = resolvePermissionFooter(sceneCard)}
		{@const planApprovalFooterData = resolvePlanApprovalFooter(sceneCard)}
		{@const prFooterData = resolvePrFooter(sceneCard)}
		<KanbanCard
			card={sceneCard}
			onclick={onCardClick ? () => onCardClick(sceneCard.id) : undefined}
			onClose={sceneCard.showCloseAction && onCardClose ? () => onCardClose(sceneCard.id) : undefined}
			showMenu={sceneCard.menuActions.length > 0}
			showFooter={sceneCard.footer !== null}
			flushFooter={sceneCard.flushFooter}
			hideBody={sceneCard.hideBody}
		>
			{#if todoSectionRenderer}
				{#snippet todoSection()}
					{@render todoSectionRenderer(sceneCard)}
				{/snippet}
			{/if}

			{#snippet menu()}
				{#if sceneCard.menuActions.length > 0}
					<KanbanSceneMenu
						menuActions={sceneCard.menuActions}
						onMenuAction={(actionId: string) => onMenuAction(sceneCard.id, actionId)}
					/>
				{/if}
			{/snippet}

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
					{#if permissionFooterRenderer}
						{@render permissionFooterRenderer(sceneCard, permissionFooterData)}
					{/if}
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

			{#snippet bottomFooter()}
				{#if prFooterData}
					<KanbanScenePrFooter
						prNumber={prFooterData.prNumber}
						prState={prFooterData.state}
						title={prFooterData.title}
						url={prFooterData.url}
						additions={prFooterData.additions}
						deletions={prFooterData.deletions}
						isLoading={prFooterData.isLoading}
						hasResolvedDetails={prFooterData.hasResolvedDetails}
						checks={prFooterData.checks}
						isChecksLoading={prFooterData.isChecksLoading}
						hasResolvedChecks={prFooterData.hasResolvedChecks}
						onOpenCheck={prFooterData.onOpenCheck}
						onOpen={() => onPrFooterOpen(sceneCard.id)}
						onOpenExternal={() => onPrFooterOpenExternal(sceneCard.id)}
					/>
				{/if}
			{/snippet}
		</KanbanCard>
	{/snippet}
	{#snippet ghostRenderer(sceneCard: KanbanSceneCardData)}
		<KanbanCard
			card={sceneCard}
			showFooter={false}
			flushFooter={sceneCard.flushFooter}
			hideBody={sceneCard.hideBody}
			presentationMode="ghost"
		>
			{#if todoSectionRenderer}
				{#snippet todoSection()}
					{@render todoSectionRenderer(sceneCard)}
				{/snippet}
			{/if}
		</KanbanCard>
	{/snippet}
</KanbanBoard>
