<script lang="ts">
import { Skeleton } from "$lib/components/ui/skeleton/index.js";
import {
	AgentInputComposerRow,
	AgentInputFilePickerDropdown,
	AgentInputPastedTextOverlay,
	AgentInputSlashCommandDropdown,
	AgentInputVoiceRecordingOverlay,
	type AgentInputEnterBehavior,
	type AgentInputSlashCommand,
	type AgentInputSlashCommandWorkspaceMarkdownResult,
	type SlashPaletteItem,
	type SlashPaletteSection,
} from "@acepe/ui/agent-panel";
import type { Snippet } from "svelte";
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
	slashPaletteSections,
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
	onSlashPaletteItemSelect,
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
	enterBehavior,
	enterBehaviorMenuLabel,
	enterQueueLabel,
	enterQueueDescription,
	enterSteerLabel,
	enterSteerDescription,
	onEnterBehaviorChange,
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
	slashPaletteSections: readonly SlashPaletteSection[];
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
	onSlashPaletteItemSelect: (item: SlashPaletteItem) => void;
	loadSlashCommandWorkspaceMarkdown?: (input: {
		readonly command: AgentInputSlashCommand;
		readonly tokenType: "command" | "skill" | "mcp";
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
	enterBehavior: AgentInputEnterBehavior;
	enterBehaviorMenuLabel: string;
	enterQueueLabel: string;
	enterQueueDescription: string;
	enterSteerLabel: string;
	enterSteerDescription: string;
	onEnterBehaviorChange: (behavior: AgentInputEnterBehavior) => void;
	leadingControls?: Snippet;
	trailingControls?: Snippet;
} = $props();

const submitIntent = $derived(
	composerInteraction.primaryButtonIntent === "steer" || (isStreaming && !hasDraftInput)
		? "steer"
		: composerInteraction.primaryButtonIntent === "cancel"
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

{#if inputReady}
	<AgentInputComposerRow
		bind:editorRef
		placeholder={placeholderLabel}
		isEmpty={inputState.message.length === 0}
		ariaLabel={placeholderLabel}
		submitIntent={submitIntent}
		submitDisabled={composerInteraction.primaryButtonDisabled}
		submitAriaLabel={submitAriaLabel}
		onSubmit={onPrimaryButtonClick}
		{enterBehavior}
		{enterBehaviorMenuLabel}
		{enterQueueLabel}
		{enterQueueDescription}
		{enterSteerLabel}
		{enterSteerDescription}
		{onEnterBehaviorChange}
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
		editorArea={voiceState !== null && voiceOverlayActive ? voiceOverlayArea : undefined}
	/>

	{#snippet voiceOverlayArea()}
		<AgentInputVoiceRecordingOverlay
			phase={voiceOverlayPhase}
			errorMessage={voiceState?.errorMessage ?? null}
			defaultErrorMessage={voiceDefaultErrorMessage}
		/>
	{/snippet}
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
	{#if isSlashDropdownVisible}
		<AgentInputSlashCommandDropdown
			bind:this={inputState.slashDropdownRef}
			sections={slashPaletteSections}
			isOpen={true}
			query={inputState.slashQuery}
			position={inputState.slashPosition}
			noContentLabel={"Nothing available"}
			noResultsLabel={"No matching items"}
			startTypingLabel={"Start typing to filter"}
			selectHintLabel={"to select"}
			closeHintLabel={"to close"}
			loadWorkspaceMarkdown={loadSlashCommandWorkspaceMarkdown}
			onItemSelect={onSlashPaletteItemSelect}
			onClose={onSlashDropdownClose}
		/>
	{/if}
	{#if inputState.showFileDropdown}
		<AgentInputFilePickerDropdown
			bind:this={inputState.fileDropdownRef}
			files={inputState.availableFiles}
			isOpen={true}
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
	{/if}
