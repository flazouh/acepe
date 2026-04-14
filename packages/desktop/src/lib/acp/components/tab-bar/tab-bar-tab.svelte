<script lang="ts">
import { BuildIcon, PlanIcon, ProjectLetterBadge } from "@acepe/ui";
import { IconAlertTriangle } from "@tabler/icons-svelte";
import { IconX } from "@tabler/icons-svelte";
import { HandPalmIcon } from "phosphor-svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/messages.js";
import { normalizeTitleForDisplay } from "../../store/session-title-policy.js";
import type { TabBarTab } from "../../store/tab-bar-store.svelte.js";
import { CanonicalModeId } from "../../types/canonical-mode-id.js";
import { Colors } from "../../utils/colors.js";
import AgentIcon from "../agent-icon.svelte";

interface Props {
	tab: TabBarTab;
	onSelect: () => void;
	onClose: () => void;
	/** When true, suppress per-tab project badge (shown by group card instead) */
	hideProjectBadge?: boolean;
}

let { tab, onSelect, onClose, hideProjectBadge = false }: Props = $props();

// Derive UI-relevant state from the unified state model
const isStreaming = $derived(tab.state.activity.kind === "streaming");
const isConnecting = $derived(tab.state.connection === "connecting");
const hasError = $derived(tab.state.connection === "error");
const hasPendingQuestion = $derived(
	tab.state.pendingInput.kind === "question" || tab.state.pendingInput.kind === "plan_approval"
);
const isUnseen = $derived(
	tab.state.activity.kind === "idle" && tab.state.attention.hasUnseenCompletion
);

// State for hover and truncation detection
let isHovered = $state(false);
let isTruncated = $state(false);
let containerElement: HTMLSpanElement | undefined = $state();
let textElement: HTMLSpanElement | undefined = $state();

const displayTitle = $derived(
	normalizeTitleForDisplay(tab.title ?? "") || m.agent_panel_new_thread()
);
const hasTurns = $derived(tab.conversationPreview.length > 0);

// ARIA label for state icon
const stateAriaLabel = $derived.by(() => {
	if (hasError) return "Agent error";
	if (hasPendingQuestion) return "Agent has a question";
	if (isStreaming || isConnecting) return "Agent is working";
	if (isUnseen) return "New response available";
	return undefined;
});

function handleMouseEnter() {
	isHovered = true;
	if (textElement && containerElement) {
		isTruncated = textElement.scrollWidth > containerElement.clientWidth;
	}
}

function handleMouseLeave() {
	isHovered = false;
}

function handleClose(e: MouseEvent) {
	e.stopPropagation();
	onClose();
}
</script>

<Tooltip.Root delayDuration={0}>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<div
				{...props}
				class="relative group"
				role="tab"
				tabindex={0}
				aria-selected={tab.isFocused}
				onmouseenter={handleMouseEnter}
				onmouseleave={handleMouseLeave}
			>
				<Button
					variant="ghost"
					size="sm"
					class="flex items-center gap-1 px-2 py-1 h-auto min-w-0 {tab.isFocused
						? 'bg-accent'
						: ''}"
					onclick={onSelect}
				>
					<!-- 1. Project letter badge (hidden when inside a project group card) -->
					{#if !hideProjectBadge && tab.projectName && tab.projectColor}
						<ProjectLetterBadge
							name={tab.projectName}
							color={tab.projectColor}
							iconSrc={tab.projectIconSrc}
							size={14}
							class="shrink-0"
						/>
					{/if}

					<!-- 2. Agent icon -->
					{#if tab.agentId}
						<AgentIcon agentId={tab.agentId} size={14} class="shrink-0" />
					{/if}

					<!-- 3. Mode icon -->
					{#if tab.currentModeId === CanonicalModeId.PLAN}
						<span class="shrink-0 flex items-center justify-center" style="color: {Colors.orange}">
							<PlanIcon size="sm" />
						</span>
					{:else if tab.currentModeId}
						<span class="shrink-0 flex items-center justify-center text-success">
							<BuildIcon size="sm" />
						</span>
					{/if}

					<!-- 4. State icon (error/question/streaming/unseen) -->
					{#if hasError || hasPendingQuestion || isStreaming || isConnecting || isUnseen}
						<span
							class="shrink-0 w-4 h-4 flex items-center justify-center"
							aria-label={stateAriaLabel}
						>
							{#if hasError}
								<IconAlertTriangle class="size-3 text-destructive" />
							{:else if hasPendingQuestion}
								<HandPalmIcon class="size-3 text-primary" weight="fill" />
							{:else if isStreaming || isConnecting}
								<Spinner class="size-3" />
							{:else if isUnseen}
								<span class="w-2 h-2 rounded-full bg-yellow-500"></span>
							{/if}
						</span>
					{/if}

					<!-- 5. Title - scrolls on hover if truncated -->
					<span bind:this={containerElement} class="max-w-[80px] overflow-hidden">
						<span
							bind:this={textElement}
							class="text-xs leading-tight text-left whitespace-nowrap inline-block"
							class:scroll-text={isHovered && isTruncated}
						>
							{displayTitle}
						</span>
					</span>

					<!-- 6. Close button -->
					<button
						type="button"
						class="shrink-0 h-5 w-5 p-0 rounded-sm hover:bg-destructive/20 flex items-center justify-center"
						onclick={handleClose}
					>
						<IconX class="h-3 w-3" />
						<span class="sr-only">{m.common_close()}</span>
					</button>
				</Button>
			</div>
		{/snippet}
	</Tooltip.Trigger>
	{#if hasTurns}
		{@const firstTurn = tab.conversationPreview[0]}
		<Tooltip.Content
			side="bottom"
			sideOffset={4}
			class="max-w-[320px] z-[10005] transition-none duration-0"
		>
			<p class="text-xs leading-snug text-foreground">{firstTurn.text}</p>
		</Tooltip.Content>
	{/if}
</Tooltip.Root>

<style>
	@keyframes scroll-text {
		0%,
		20% {
			transform: translateX(0);
		}
		80%,
		100% {
			transform: translateX(calc(-100% + 80px));
		}
	}

	.scroll-text {
		animation: scroll-text 15s ease-in-out infinite alternate;
	}
</style>
