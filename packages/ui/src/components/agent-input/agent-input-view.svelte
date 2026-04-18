<!--
  AgentInputView — Presentational shell for the agent input composer.

  Captures the visual layout of the real desktop composer without any
  Tauri, store, or IO dependency. Renders textarea area, toolbar row
  with pill chips, action buttons (attach, voice, expand, send).

  Created for Unit 4 of the landing-view-showcase-fidelity plan.
-->
<script lang="ts">
	import { IconArrowUp } from "@tabler/icons-svelte";
	import {
		ArrowsOut,
		CircleNotch,
		Microphone,
		Paperclip,
		Stop,
		X,
	} from "phosphor-svelte";

	import { Button } from "../button/index.js";
	import { InputContainer } from "../input-container/index.js";
	import type { AgentInputContextPillItem, AgentInputPillItem } from "./types.js";

	interface Props {
		placeholder?: string;
		value?: string;
		isExpanded?: boolean;
		agentPills?: readonly AgentInputPillItem[];
		contextPills?: readonly AgentInputContextPillItem[];
		showAttachButton?: boolean;
		showVoiceButton?: boolean;
		showExpandButton?: boolean;
		isSending?: boolean;
		disabled?: boolean;
		onSend?: () => void;
		onAttach?: () => void;
		onVoice?: () => void;
		onExpand?: () => void;
		onInput?: (value: string) => void;
		onRemoveAgentPill?: (id: string) => void;
		onRemoveContextPill?: (id: string) => void;
	}

	let {
		placeholder = "What do you want to build?",
		value = "",
		isExpanded = false,
		agentPills = [],
		contextPills = [],
		showAttachButton = false,
		showVoiceButton = false,
		showExpandButton = false,
		isSending = false,
		disabled = false,
		onSend,
		onAttach,
		onVoice,
		onExpand,
		onInput,
		onRemoveAgentPill,
		onRemoveContextPill,
	}: Props = $props();

	const isEmpty = $derived(value.length === 0);
	const submitDisabled = $derived(disabled || isSending || isEmpty);

	function handleInput(event: Event): void {
		if (!(event.currentTarget instanceof HTMLTextAreaElement)) {
			return;
		}
		onInput?.(event.currentTarget.value);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === "Enter" && !event.shiftKey && !submitDisabled) {
			event.preventDefault();
			onSend?.();
		}
	}
</script>

<div
	class="flex flex-col"
	data-testid="agent-input-view"
>
	<InputContainer
		class="flex-shrink-0 border border-border bg-input/30"
		contentClass="p-1.5"
	>
		{#snippet content()}
			<!-- Context pills row -->
			{#if contextPills.length > 0}
				<div class="flex flex-wrap gap-1.5 mb-1.5">
					{#each contextPills as pill (pill.id)}
						<span
							class="inline-flex items-center gap-1 rounded-md border border-border bg-muted p-1 text-xs"
							data-testid="context-pill"
						>
							{#if pill.iconSrc}
								<img src={pill.iconSrc} alt="" class="h-3.5 w-3.5 shrink-0" />
							{/if}
							<span class="max-w-[120px] truncate font-mono text-foreground">{pill.label}</span>
							{#if onRemoveContextPill}
								<button
									type="button"
									class="ml-0.5 cursor-pointer rounded p-0.5 transition-colors hover:bg-destructive/20 hover:text-destructive"
									aria-label="Remove {pill.label}"
									onclick={() => onRemoveContextPill?.(pill.id)}
									{disabled}
								>
									<X class="h-3 w-3" />
								</button>
							{/if}
						</span>
					{/each}
				</div>
			{/if}

			<!-- Editor + submit row -->
			<div class="flex gap-1.5 min-w-0">
				<div class="relative flex-1 min-w-0">
					<textarea
						class="min-h-7 w-full resize-none overflow-y-auto whitespace-pre-wrap break-words bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground {isExpanded ? 'max-h-[600px]' : 'max-h-[400px]'}"
						{placeholder}
						{value}
						{disabled}
						oninput={handleInput}
						onkeydown={handleKeydown}
						rows={1}
						aria-label={placeholder}
						data-testid="agent-input-textarea"
					></textarea>
				</div>

				<!-- Submit button -->
				<div class="flex items-end shrink-0">
					{#if isSending}
						<Button
							type="button"
							size="icon"
							onclick={onSend}
							disabled={disabled}
							class="h-7 w-7 cursor-pointer shrink-0 rounded-full bg-muted-foreground text-background hover:bg-muted-foreground/80"
							data-testid="agent-input-stop-button"
						>
							<Stop weight="fill" class="h-3.5 w-3.5" />
							<span class="sr-only">Stop</span>
						</Button>
					{:else}
						<Button
							type="button"
							size="icon"
							onclick={onSend}
							disabled={submitDisabled}
							class="h-7 w-7 cursor-pointer shrink-0 rounded-full bg-foreground text-background hover:bg-foreground/85"
							data-testid="agent-input-send-button"
						>
							<IconArrowUp class="h-3.5 w-3.5" />
							<span class="sr-only">Send</span>
						</Button>
					{/if}
				</div>
			</div>
		{/snippet}

		{#snippet footer()}
			<!-- Toolbar: agent pills + action buttons -->
			<div class="flex items-center h-7 w-full" data-testid="agent-input-toolbar">
				<!-- Left: agent pills -->
				{#if agentPills.length > 0}
					<div class="flex items-center h-full min-w-0 gap-0.5">
						{#each agentPills as pill (pill.id)}
							<span
								class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground"
								data-testid="agent-pill"
							>
								<img src={pill.iconSrc} alt="" class="h-3.5 w-3.5 shrink-0 rounded" />
								<span class="truncate max-w-[80px]">{pill.name}</span>
								{#if onRemoveAgentPill}
									<button
										type="button"
										class="ml-0.5 cursor-pointer rounded p-0.5 transition-colors hover:bg-destructive/20 hover:text-destructive"
										aria-label="Remove {pill.name}"
										onclick={() => onRemoveAgentPill?.(pill.id)}
										{disabled}
									>
										<X class="h-2.5 w-2.5" />
									</button>
								{/if}
							</span>
							<div class="h-full w-px bg-border/50"></div>
						{/each}
					</div>
				{/if}

				<!-- Right: action buttons -->
				<div class="flex items-center gap-1 ml-auto px-1">
					{#if isSending}
						<CircleNotch class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
					{/if}
					{#if showAttachButton}
						<button
							type="button"
							class="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground {disabled ? 'pointer-events-none opacity-40' : 'cursor-pointer'}"
							aria-label="Attach file"
							onclick={onAttach}
							{disabled}
							data-testid="agent-input-attach-button"
						>
							<Paperclip class="h-3.5 w-3.5" />
						</button>
					{/if}
					{#if showVoiceButton}
						<button
							type="button"
							class="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground {disabled ? 'pointer-events-none opacity-40' : 'cursor-pointer'}"
							aria-label="Voice input"
							onclick={onVoice}
							{disabled}
							data-testid="agent-input-voice-button"
						>
							<Microphone class="h-3.5 w-3.5" />
						</button>
					{/if}
					{#if showExpandButton}
						<button
							type="button"
							class="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground {disabled ? 'pointer-events-none opacity-40' : 'cursor-pointer'}"
							aria-label="Expand editor"
							onclick={onExpand}
							{disabled}
							data-testid="agent-input-expand-button"
						>
							<ArrowsOut class="h-3.5 w-3.5" />
						</button>
					{/if}
				</div>
			</div>
		{/snippet}
	</InputContainer>
</div>
