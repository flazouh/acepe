<script lang="ts">
import { Skeleton } from "$lib/components/ui/skeleton/index.js";
import {
	AgentInputArtefactBadge,
	AgentInputComposerRow,
	AgentInputFilePickerDropdown,
	AgentInputPastedTextOverlay,
	AgentInputSlashCommandDropdown,
	AgentInputVoiceRecordingOverlay,
	type AgentInputSlashCommandWorkspaceMarkdownResult,
} from "@acepe/ui/agent-panel";
import type { Snippet } from "svelte";
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
	slashCommandTokenType,
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
	loadSlashCommandWorkspaceMarkdown,
	onFileSelect,
	onSlashDropdownClose,
	onFileDropdownClose,
	placeholderLabel,
	voiceOverlayPhase,
	voiceDefaultErrorMessage,
	primarySrQueue,
	primarySrSend,
	primarySrInterrupt,
	leadingControls,
	trailingControls,
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
	slashCommandTokenType: "command" | "skill";
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
	loadSlashCommandWorkspaceMarkdown?: (input: {
		readonly command: AvailableCommand;
		readonly tokenType: "command" | "skill";
	}) => Promise<AgentInputSlashCommandWorkspaceMarkdownResult>;
	onFileSelect: (file: { path: string }) => void;
	onSlashDropdownClose: () => void;
	onFileDropdownClose: () => void;
	placeholderLabel: string;
	voiceOverlayPhase: "checking_permission" | "recording" | "error";
	voiceDefaultErrorMessage: string;
	primarySrQueue: string;
	primarySrSend: string;
	primarySrInterrupt: string;
	leadingControls?: Snippet;
	trailingControls?: Snippet;
} = $props();

const submitIntent = $derived(
	composerInteraction.primaryButtonIntent === "steer" || (isStreaming && !hasDraftInput)
		? "steer"
		: composerInteraction.primaryButtonIntent === "stop"
			? "stop"
			: "send"
);

const submitAriaLabel = $derived(
	composerInteraction.primaryButtonIntent === "steer" || (isStreaming && !hasDraftInput)
		? primarySrInterrupt
		: isAgentBusy
			? primarySrQueue
			: primarySrSend
);
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
		<div class="flex flex-wrap gap-1.5 mb-1.5">
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
	<AgentInputComposerRow
		bind:editorRef
		placeholder={placeholderLabel}
		isEmpty={inputState.message.length === 0}
		ariaLabel={placeholderLabel}
		submitIntent={submitIntent}
		submitDisabled={composerInteraction.primaryButtonDisabled}
		submitAriaLabel={submitAriaLabel}
		onSubmit={onPrimaryButtonClick}
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
		leading={leadingControls}
		trailing={trailingControls}
	/>
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
	headerLabel={"Commands"}
	noCommandsLabel={"No commands available"}
	noResultsLabel={"No commands found"}
	startTypingLabel={"Start typing to search commands..."}
	selectHintLabel={"to select"}
	closeHintLabel={"to close"}
	tokenType={slashCommandTokenType}
	loadWorkspaceMarkdown={loadSlashCommandWorkspaceMarkdown}
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
	headerLabel={"Add file context"}
	noResultsLabel={"No matching files"}
	selectHintLabel={"to select"}
	closeHintLabel={"to close"}
	onSelect={(file) => onFileSelect(file)}
	onClose={onFileDropdownClose}
>
	{#snippet preview(file)}
		<FilePreview file={file} projectPath={filePickerProjectPath ? filePickerProjectPath : ""} />
	{/snippet}
</AgentInputFilePickerDropdown>
