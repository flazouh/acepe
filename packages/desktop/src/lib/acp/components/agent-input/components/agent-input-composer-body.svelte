<script lang="ts">
import { IconArrowUp } from "@tabler/icons-svelte";
import { Stop } from "phosphor-svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { Kbd, KbdGroup } from "$lib/components/ui/kbd/index.js";
import { Skeleton } from "$lib/components/ui/skeleton/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import {
	AgentInputArtefactBadge,
	AgentInputFilePickerDropdown,
	AgentInputPastedTextOverlay,
	AgentInputSlashCommandDropdown,
	AgentInputVoiceRecordingOverlay,
} from "@acepe/ui/agent-panel";
import type { AvailableCommand } from "../../../types/available-command.js";
import type { ComposerInteractionState } from "../../../logic/composer-ui-state.js";
import FilePreview from "../../file-picker/file-preview.svelte";
import type { AgentInputState } from "../state/agent-input-state.svelte.js";
import type { VoiceInputState } from "../state/voice-input-state.svelte.js";

let {
	voiceState,
	voiceOverlayActive,
	inputReady,
	inputState,
	editorRef = $bindable<HTMLDivElement | null>(null),
	overlayMode,
	overlayRefId,
	overlayAnchorRect,
	composerInteraction,
	isStreaming,
	hasDraftInput,
	isAgentBusy,
	effectiveAvailableCommands,
	isSlashDropdownVisible,
	filePickerProjectPath,
	onEditorBeforeInput,
	onEditorInput,
	onEditorKeyDown,
	onEditorKeyUp,
	onEditorFocus,
	onEditorBlur,
	onEditorClick,
	onEditorMouseOver,
	onEditorMouseOut,
	onEditorPaste,
	onEditorCut,
	onOverlaySave,
	onOverlayClose,
	onOverlayMouseEnterCancel,
	onPrimaryButtonClick,
	onCommandSelect,
	onFileSelect,
	onSlashDropdownClose,
	onFileDropdownClose,
	placeholderLabel,
	voiceOverlayPhase,
	voiceDefaultErrorMessage,
	primarySrQueue,
	primarySrSend,
	primarySrInterrupt,
	tooltipQueueRowLabel,
	tooltipInterruptShiftRowLabel,
	tooltipStopStreaming,
	tooltipSend,
	slashLabels,
	filePickerLabels,
}: {
	voiceState: VoiceInputState | null;
	voiceOverlayActive: boolean;
	inputReady: boolean;
	inputState: AgentInputState;
	editorRef?: HTMLDivElement | null;
	overlayMode: "preview" | "edit" | null;
	overlayRefId: string | null;
	overlayAnchorRect: DOMRect | null;
	composerInteraction: ComposerInteractionState;
	isStreaming: boolean;
	hasDraftInput: boolean;
	isAgentBusy: boolean;
	effectiveAvailableCommands: readonly AvailableCommand[];
	isSlashDropdownVisible: boolean;
	filePickerProjectPath: string | null;
	onEditorBeforeInput: (e: InputEvent) => void;
	onEditorInput: () => void;
	onEditorKeyDown: (e: KeyboardEvent) => void;
	onEditorKeyUp: (e: KeyboardEvent) => void;
	onEditorFocus: () => void;
	onEditorBlur: () => void;
	onEditorClick: (e: MouseEvent) => void;
	onEditorMouseOver: (e: MouseEvent) => void;
	onEditorMouseOut: (e: MouseEvent) => void;
	onEditorPaste: (e: ClipboardEvent) => void | Promise<void>;
	onEditorCut: (e: ClipboardEvent) => void;
	onOverlaySave: (refId: string, text: string) => void;
	onOverlayClose: () => void;
	onOverlayMouseEnterCancel: () => void;
	onPrimaryButtonClick: () => void;
	onCommandSelect: (cmd: AvailableCommand) => void;
	onFileSelect: (file: { path: string }) => void;
	onSlashDropdownClose: () => void;
	onFileDropdownClose: () => void;
	placeholderLabel: string;
	voiceOverlayPhase: "checking_permission" | "recording" | "error";
	voiceDefaultErrorMessage: string;
	primarySrQueue: string;
	primarySrSend: string;
	primarySrInterrupt: string;
	tooltipQueueRowLabel: string;
	tooltipInterruptShiftRowLabel: string;
	tooltipStopStreaming: string;
	tooltipSend: string;
	slashLabels: {
		header: string;
		noCommands: string;
		noResults: string;
		startTyping: string;
		selectHint: string;
		closeHint: string;
	};
	filePickerLabels: {
		header: string;
		noResults: string;
		selectHint: string;
		closeHint: string;
	};
} = $props();
</script>

{#if voiceState !== null && voiceOverlayActive}
	<AgentInputVoiceRecordingOverlay
		phase={voiceOverlayPhase}
		meterLevels={voiceState.waveform.meterLevels}
		barCount={voiceState.waveform.barCount}
		errorMessage={voiceState.errorMessage}
		defaultErrorMessage={voiceDefaultErrorMessage}
	/>
{:else if inputReady}
	{#if inputState.attachments.length > 0}
		<div class="flex flex-wrap gap-1.5">
			{#each inputState.attachments as attachment (attachment.id)}
				<AgentInputArtefactBadge
					displayName={attachment.displayName}
					extension={attachment.extension ?? null}
					kind={attachment.type === "image" ? "image" : "file"}
					onRemove={() => inputState.removeAttachment(attachment.id)}
				/>
			{/each}
		</div>
	{/if}
	<div class="flex gap-1.5 min-w-0">
		<div class="relative flex-1 min-w-0">
			<!-- svelte-ignore a11y_mouse_events_have_key_events -->
			<div
				bind:this={editorRef}
				role="textbox"
				aria-multiline="true"
				aria-label={placeholderLabel}
				tabindex="0"
				contenteditable="true"
				autocapitalize="off"
				spellcheck={false}
				class="min-h-7 max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground outline-none"
				onbeforeinput={onEditorBeforeInput}
				oninput={() => onEditorInput()}
				onkeydown={onEditorKeyDown}
				onkeyup={onEditorKeyUp}
				onfocus={onEditorFocus}
				onblur={onEditorBlur}
				onclick={onEditorClick}
				onmouseover={onEditorMouseOver}
				onmouseout={onEditorMouseOut}
				onpaste={(event) => onEditorPaste(event)}
				oncut={onEditorCut}
			></div>
			{#if overlayMode && overlayRefId && overlayAnchorRect}
				{@const overlayText = inputState.getInlineTextReferenceContent(overlayRefId) ?? ""}
				<AgentInputPastedTextOverlay
					mode={overlayMode}
					refId={overlayRefId}
					anchorRect={overlayAnchorRect}
					textContent={overlayText}
					onSave={onOverlaySave}
					onClose={onOverlayClose}
					onMouseEnter={onOverlayMouseEnterCancel}
				/>
			{/if}
			{#if inputState.message.length === 0}
				<div
					class="pointer-events-none absolute left-0 top-0 text-sm leading-relaxed text-muted-foreground select-none"
				>
					{placeholderLabel}
				</div>
			{/if}
		</div>
		<div class="flex items-end shrink-0">
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props: triggerProps })}
						<Button
							{...triggerProps}
							type="button"
							size="icon"
							onclick={onPrimaryButtonClick}
							disabled={composerInteraction.primaryButtonDisabled}
							class="h-7 w-7 cursor-pointer shrink-0 rounded-full bg-foreground text-background hover:bg-foreground/85"
						>
							{#if composerInteraction.primaryButtonIntent === "steer" || (isStreaming && !hasDraftInput)}
								<Stop weight="fill" class="h-3.5 w-3.5" />
								<span class="sr-only">{primarySrInterrupt}</span>
							{:else}
								<IconArrowUp class="h-3.5 w-3.5" />
								<span class="sr-only">{isAgentBusy ? primarySrQueue : primarySrSend}</span>
							{/if}
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>
					{#if isAgentBusy && hasDraftInput}
						<div class="flex items-center gap-3">
							<div class="flex items-center gap-1.5">
								<span>{tooltipQueueRowLabel}</span>
								<KbdGroup><Kbd>Enter</Kbd></KbdGroup>
							</div>
							<div class="flex items-center gap-1.5">
								<span>{tooltipInterruptShiftRowLabel}</span>
								<KbdGroup><Kbd>Shift</Kbd><Kbd>Enter</Kbd></KbdGroup>
							</div>
						</div>
					{:else}
						<div class="flex items-center gap-2">
							<span>{isStreaming ? tooltipStopStreaming : tooltipSend}</span>
							{#if !isStreaming}
								<KbdGroup><Kbd>Enter</Kbd></KbdGroup>
							{/if}
						</div>
					{/if}
				</Tooltip.Content>
			</Tooltip.Root>
		</div>
	</div>
{:else}
	<div class="flex items-center gap-2">
		<div class="flex-1 flex flex-col gap-2">
			<Skeleton class="h-4 w-3/4" />
			<Skeleton class="h-4 w-1/2" />
		</div>
		<Skeleton class="h-8 w-8 rounded-full shrink-0" />
	</div>
{/if}
<AgentInputSlashCommandDropdown
	bind:this={inputState.slashDropdownRef}
	commands={effectiveAvailableCommands}
	isOpen={isSlashDropdownVisible}
	query={inputState.slashQuery}
	position={inputState.slashPosition}
	headerLabel={slashLabels.header}
	noCommandsLabel={slashLabels.noCommands}
	noResultsLabel={slashLabels.noResults}
	startTypingLabel={slashLabels.startTyping}
	selectHintLabel={slashLabels.selectHint}
	closeHintLabel={slashLabels.closeHint}
	onSelect={(cmd: AvailableCommand) => onCommandSelect(cmd)}
	onClose={onSlashDropdownClose}
/>
<AgentInputFilePickerDropdown
	bind:this={inputState.fileDropdownRef}
	files={inputState.availableFiles}
	isOpen={inputState.showFileDropdown}
	isLoading={inputState.filesLoading}
	query={inputState.fileQuery}
	position={inputState.filePosition}
	headerLabel={filePickerLabels.header}
	noResultsLabel={filePickerLabels.noResults}
	selectHintLabel={filePickerLabels.selectHint}
	closeHintLabel={filePickerLabels.closeHint}
	onSelect={(file) => onFileSelect(file)}
	onClose={onFileDropdownClose}
>
	{#snippet preview(file)}
		<FilePreview file={file} projectPath={filePickerProjectPath ? filePickerProjectPath : ""} />
	{/snippet}
</AgentInputFilePickerDropdown>
