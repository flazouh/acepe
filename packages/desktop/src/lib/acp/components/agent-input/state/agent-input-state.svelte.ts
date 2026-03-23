import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { okAsync, ResultAsync } from "neverthrow";
import { SvelteMap } from "svelte/reactivity";

import type { ProjectIndex } from "../../../../services/converted-session-types.js";
import { LOGGER_IDS } from "../../../constants/logger-ids.js";
import type { PanelStore } from "../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../store/session-store.svelte.js";
import type { AvailableCommand } from "../../../types/available-command.js";
import type { FilePickerEntry } from "../../../types/file-picker-entry.js";
import { createLogger } from "../../../utils/logger.js";

import {
	FileLoadError,
	type MessageSendError,
	SessionCreationError,
} from "../errors/agent-input-error.js";
import { calculateDropdownPosition } from "../logic/dropdown-trigger.js";
import { createImageAttachment, isImageMimeType } from "../logic/image-attachment.js";
import { findInlineArtefactRangeAtPosition } from "../logic/inline-artefact-segments.js";
import { parseFilePickerTrigger, parseSlashCommandTrigger } from "../logic/input-parser.js";
import { createPendingUserEntry } from "../logic/pending-user-entry.js";
import { createSession, sendMessage } from "../logic/session-manager.js";
import type { Attachment } from "../types/attachment.js";
import type { DropdownPosition } from "../types/dropdown-position.js";

/**
 * Type for slash command dropdown component instance.
 */
interface SlashCommandDropdownInstance {
	handleKeyDown(event: KeyboardEvent): boolean;
}

/**
 * Type for file picker dropdown component instance.
 */
interface FilePickerDropdownInstance {
	handleKeyDown(event: KeyboardEvent): boolean;
}

/**
 * Agent Input State Manager
 *
 * Manages local UI state for the agent input component.
 * Follows idiomatic Svelte 5 pattern: classes manage local state, not props.
 *
 * Props and derived values belong in the component.
 * This class only handles:
 * - Local UI state (message, dropdowns, refs)
 * - Event handlers that modify local state
 * - Async operations returning ResultAsync
 *
 * @example
 * ```ts
 * const state = new AgentInputState(store, panelStore, () => props.projectPath);
 * state.message = "Hello";
 * await state.sendMessage();
 * ```
 */
export class AgentInputState {
	// ============================================
	// LOCAL UI STATE
	// ============================================

	/**
	 * Logger for debugging input handling.
	 */
	private readonly logger = createLogger({
		id: LOGGER_IDS.AGENT_INPUT,
		name: "AgentInput",
	});

	/**
	 * Current message text in the input.
	 */
	message = $state("");

	/**
	 * Textarea element reference.
	 */
	textareaRef = $state<HTMLTextAreaElement | null>(null);

	/**
	 * Rich editor reference used by inline artefact composer.
	 */
	editorRef = $state<HTMLDivElement | null>(null);

	/**
	 * Whether slash command dropdown is visible.
	 */
	showSlashDropdown = $state(false);

	/**
	 * Position of slash command dropdown.
	 */
	slashPosition = $state<DropdownPosition>({ top: 0, left: 0 });

	/**
	 * Current query text for slash command filtering.
	 */
	slashQuery = $state("");

	/**
	 * Start index of slash command trigger in message.
	 */
	slashStartIndex = $state(0);

	/**
	 * Slash command dropdown component reference.
	 */
	slashDropdownRef = $state<SlashCommandDropdownInstance | null>(null);

	/**
	 * Available files for file picker.
	 */
	availableFiles = $state<FilePickerEntry[]>([]);

	/**
	 * Whether file picker dropdown is visible.
	 */
	showFileDropdown = $state(false);

	/**
	 * Position of file picker dropdown.
	 */
	filePosition = $state<DropdownPosition>({ top: 0, left: 0 });

	/**
	 * Current query text for file picker filtering.
	 */
	fileQuery = $state("");

	/**
	 * Start index of file picker trigger in message.
	 */
	fileStartIndex = $state(0);

	/**
	 * File picker dropdown component reference.
	 */
	fileDropdownRef = $state<FilePickerDropdownInstance | null>(null);

	/**
	 * Whether project files have been loaded.
	 */
	filesLoaded = $state(false);

	/**
	 * Whether project files are currently being loaded.
	 */
	filesLoading = $state(false);

	// ============================================
	// ATTACHMENT STATE
	// ============================================

	/**
	 * Current attachments (files and images) added to the message.
	 * Displayed as badges above the textarea.
	 */
	attachments = $state<Attachment[]>([]);

	/**
	 * Whether a drag operation is active anywhere in the window.
	 * Used to show the drop zone UI.
	 */
	isDragActive = $state(false);

	/**
	 * Whether the drag cursor is currently hovering over THIS specific input.
	 * Used for highlighting the drop zone.
	 */
	isDragHovering = $state(false);

	/**
	 * Combined state for template convenience.
	 * True when drag is active anywhere in the window.
	 */
	get isDragOver(): boolean {
		return this.isDragActive;
	}

	/**
	 * Reference to the container element for bounds checking.
	 */
	containerRef = $state<HTMLElement | null>(null);

	// ============================================
	// PRIVATE STATE
	// ============================================

	private readonly store: SessionStore;
	private readonly panelStore: PanelStore;
	private readonly projectPathGetter: () => string | null;
	private readonly inlineTextById = new SvelteMap<string, string>();

	/**
	 * Unlisten functions for Tauri drag-drop events.
	 */
	private unlistenFileDrop: UnlistenFn | null = null;
	private unlistenFileDropHover: UnlistenFn | null = null;
	private unlistenFileDropCancelled: UnlistenFn | null = null;

	/**
	 * Creates a new AgentInputState instance.
	 *
	 * @param store - Session store for managing sessions
	 * @param panelStore - Panel store for optimistic pending entry management
	 * @param projectPathGetter - Getter function that returns the current project path.
	 *                            Called on-demand when files need to be loaded.
	 */
	constructor(
		store: SessionStore,
		panelStore: PanelStore,
		projectPathGetter: () => string | null = () => null
	) {
		this.store = store;
		this.panelStore = panelStore;
		this.projectPathGetter = projectPathGetter;
	}

	/**
	 * Current project path for lazy file loading.
	 * Delegates to the getter function passed to constructor.
	 */
	get projectPath(): string | null {
		return this.projectPathGetter();
	}

	// ============================================
	// INITIALIZATION
	// ============================================

	/**
	 * Initializes the state manager.
	 * Focuses the textarea on mount and sets up Tauri drag-drop listeners.
	 */
	initialize(): void {
		// Focus textarea on mount
		setTimeout(() => {
			this.focusInput();
		}, 0);

		// Set up Tauri drag-drop event listeners
		this.setupTauriDragDropListeners();
	}

	/**
	 * Checks if a position is within the container element's bounds.
	 * Uses generous padding to handle any coordinate system offsets.
	 */
	private isPositionInBounds(position: { x: number; y: number }): boolean {
		if (!this.containerRef) return false;
		const rect = this.containerRef.getBoundingClientRect();
		// Add padding to be more forgiving with coordinate mismatches
		const padding = 50;
		return (
			position.x >= rect.left - padding &&
			position.x <= rect.right + padding &&
			position.y >= rect.top - padding &&
			position.y <= rect.bottom + padding
		);
	}

	/**
	 * Sets up Tauri event listeners for file drag-drop.
	 * Tauri uses its own event system instead of browser drag events.
	 */
	private async setupTauriDragDropListeners(): Promise<void> {
		// Listen for file drop hover (drag over)
		this.unlistenFileDropHover = await listen<{
			paths: string[];
			position: { x: number; y: number };
		}>("tauri://drag-over", (event) => {
			// Always show drop zone when dragging in window
			this.isDragActive = true;
			// Highlight only when over this specific container
			this.isDragHovering = this.isPositionInBounds(event.payload.position);
		});

		// Listen for file drop
		this.unlistenFileDrop = await listen<{ paths: string[]; position: { x: number; y: number } }>(
			"tauri://drag-drop",
			async (event) => {
				const wasHovering = this.isDragHovering;
				this.isDragActive = false;
				this.isDragHovering = false;

				// Only process if we were the hovered drop target
				if (!wasHovering) {
					return;
				}

				const paths = event.payload.paths;

				for (const filePath of paths) {
					const fileName = filePath.split("/").pop() ?? filePath;
					const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

					// Check if it's an image based on extension
					const imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"];
					if (imageExtensions.includes(extension)) {
						// Read image as base64 for preview
						const content = await invoke<string>("read_image_as_base64", {
							filePath,
						}).catch(() => undefined);

						this.addAttachment({
							type: "image",
							path: filePath,
							displayName: fileName,
							extension,
							content,
						});
					}
				}

				// Refocus textarea after drop
				this.textareaRef?.focus();
			}
		);

		// Listen for drag cancelled (drag leave)
		this.unlistenFileDropCancelled = await listen("tauri://drag-leave", () => {
			this.isDragActive = false;
			this.isDragHovering = false;
		});
	}

	/**
	 * Cleans up resources including Tauri event listeners.
	 */
	destroy(): void {
		// Clean up Tauri event listeners
		if (this.unlistenFileDrop) {
			this.unlistenFileDrop();
			this.unlistenFileDrop = null;
		}
		if (this.unlistenFileDropHover) {
			this.unlistenFileDropHover();
			this.unlistenFileDropHover = null;
		}
		if (this.unlistenFileDropCancelled) {
			this.unlistenFileDropCancelled();
			this.unlistenFileDropCancelled = null;
		}
	}

	// ============================================
	// FILE LOADING
	// ============================================

	/**
	 * Loads project files from the backend.
	 *
	 * @param projectPath - Path to the project
	 * @returns ResultAsync containing void on success
	 */
	loadProjectFiles(projectPath: string): ResultAsync<void, FileLoadError> {
		this.logger.debug("[loadProjectFiles] Called", {
			projectPath,
			filesLoaded: this.filesLoaded,
			filesLoading: this.filesLoading,
		});

		if (!projectPath || this.filesLoaded || this.filesLoading) {
			this.logger.debug("[loadProjectFiles] Skipping - no path, already loaded, or loading");
			return okAsync(undefined);
		}

		this.filesLoading = true;

		return ResultAsync.fromPromise(
			invoke<ProjectIndex>("get_project_files", { projectPath }),
			(err) => new FileLoadError(projectPath, err instanceof Error ? err : new Error(String(err)))
		)
			.map((index) => {
				// Files arrive pre-sorted from Rust (modified files first, then alphabetically)
				// with gitStatus already merged into each file object
				this.availableFiles = index.files.map((file) => ({
					path: file.path,
					extension: file.extension,
					lineCount: file.lineCount,
					gitStatus: file.gitStatus ?? null,
				}));

				this.filesLoaded = true;
				this.filesLoading = false;

				this.logger.info("[loadProjectFiles] Files loaded", {
					filesCount: this.availableFiles.length,
					projectPath,
				});
			})
			.mapErr((err) => {
				this.filesLoading = false;
				this.logger.error("[loadProjectFiles] Failed to load files", {
					projectPath,
					error: err.message,
				});
				return err;
			});
	}

	// ============================================
	// MESSAGE HANDLING
	// ============================================

	/**
	 * Send a pre-prepared message to the given session, or create a new session first.
	 * Callers must prepare the content via `prepareMessageForSend()` before calling this.
	 */
	sendPreparedMessage(options: {
		content: string;
		panelId?: string;
		sessionId?: string | null;
		selectedAgentId?: string | null;
		projectPath?: string | null;
		projectName?: string | null;
		onSessionCreated?: (sessionId: string) => void;
		worktreePath?: string | null;
		imageAttachments?: readonly Attachment[];
	}): ResultAsync<void, SessionCreationError | MessageSendError> {
		const {
			content,
			panelId,
			sessionId,
			selectedAgentId,
			projectPath,
			projectName,
			onSessionCreated,
			worktreePath,
			imageAttachments = [],
		} = options;
		this.logger.info("[first-send-trace] sendPreparedMessage entered", {
			panelId: panelId ?? null,
			sessionId: sessionId ?? null,
			projectPath: projectPath ?? null,
			worktreePath: worktreePath ?? null,
			selectedAgentId: selectedAgentId ?? null,
			contentLength: content.length,
		});

		// Use existing session or create new one
		const sendT0 = performance.now();
		if (sessionId) {
			this.logger.info("[PERF] sendMessage: FAST PATH (eager session ready)", {
				sessionId,
				elapsed_ms: Math.round(performance.now() - sendT0),
			});
			return sendMessage(this.store, sessionId, content, imageAttachments).map(() => {
				this.logger.info("[PERF] sendMessage: fast-path IPC resolved, calling onSessionCreated", {
					elapsed_ms: Math.round(performance.now() - sendT0),
				});
				onSessionCreated?.(sessionId);
				this.logger.info("[PERF] sendMessage: onSessionCreated done (panel should be open)", {
					elapsed_ms: Math.round(performance.now() - sendT0),
				});
				this.focusInput();
			});
		}

		// Validate project and agent are set before session creation.
		if (!projectPath || projectPath.trim().length === 0) {
			throw new SessionCreationError(
				selectedAgentId ?? "unknown",
				"unknown",
				new Error("No project selected for this panel")
			);
		}

		const effectiveProjectPath = projectPath;
		if (!selectedAgentId) {
			throw new SessionCreationError(
				"unknown",
				effectiveProjectPath,
				new Error("No agent selected for this panel")
			);
		}

		// Create session and send message
		const effectiveProjectName = projectName || "Default Project";

		this.logger.info("[PERF] sendMessage: SLOW PATH (no eager session, creating new)", {
			agentId: selectedAgentId,
			elapsed_ms: Math.round(performance.now() - sendT0),
		});
		this.logger.info("[worktree-flow] createSession (slow path)", {
			projectPath: effectiveProjectPath,
			worktreePath: worktreePath ?? undefined,
		});
		this.logger.info("[first-send-trace] createSession starting", {
			panelId: panelId ?? null,
			projectPath: effectiveProjectPath,
			worktreePath: worktreePath ?? null,
			selectedAgentId,
		});

		// Build optimistic pending entry if the UI has not already done so.
		if (panelId) {
			const pendingEntry = this.panelStore.getHotState(panelId).pendingUserEntry;
			if (!pendingEntry) {
				this.panelStore.setPendingUserEntry(panelId, createPendingUserEntry(content));
			}
		}

		return createSession(this.store, {
			agentId: selectedAgentId,
			projectPath: effectiveProjectPath,
			projectName: effectiveProjectName,
			worktreePath: worktreePath ?? undefined,
		})
			.andThen((newSessionId) => {
				this.logger.info("[first-send-trace] createSession resolved", {
					panelId: panelId ?? null,
					newSessionId,
					projectPath: effectiveProjectPath,
					worktreePath: worktreePath ?? null,
				});
				this.logger.info(
					"[PERF] sendMessage: slow-path session created, calling onSessionCreated",
					{
						newSessionId,
						elapsed_ms: Math.round(performance.now() - sendT0),
					}
				);
				this.logger.info("[worktree-flow] onSessionCreated called", {
					sessionId: newSessionId,
				});
				// Notify parent with the canonical session ID
				onSessionCreated?.(newSessionId);
				// Clear pending entry BEFORE sendMessage adds the real one.
				// Both are synchronous SvelteMap.set() calls — batched into one render.
				if (panelId) this.panelStore.clearPendingUserEntry(panelId);
				return sendMessage(this.store, newSessionId, content, imageAttachments);
			})
			.map(() => {
				this.logger.info("[PERF] sendMessage: slow-path fully resolved", {
					elapsed_ms: Math.round(performance.now() - sendT0),
				});
				this.focusInput();
			})
			.mapErr((error) => {
				// Rollback: remove optimistic pending entry on session creation or send failure
				if (panelId) this.panelStore.clearPendingUserEntry(panelId);
				return error;
			});
	}

	// ============================================
	// INPUT HANDLING
	// ============================================

	/**
	 * Handles input changes in the textarea.
	 * Detects triggers for file picker and slash commands.
	 * Triggers lazy file loading when @ is typed.
	 */
	handleInput(): void {
		if (!this.textareaRef) {
			return;
		}

		const textarea = this.textareaRef;
		const maxHeight = 400;

		textarea.style.height = "auto";
		const newHeight = Math.min(textarea.scrollHeight, maxHeight);
		textarea.style.height = `${newHeight}px`;
		textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";

		const cursorPos = this.textareaRef.selectionStart;

		// Check for file picker trigger
		const fileTriggerResult = parseFilePickerTrigger(this.message, cursorPos);

		if (fileTriggerResult.isOk() && fileTriggerResult.value) {
			const trigger = fileTriggerResult.value;
			const positionResult = calculateDropdownPosition(this.textareaRef, trigger.startIndex);

			if (positionResult.isOk()) {
				// Lazy load files when @ is triggered and files aren't loaded yet
				if (!this.filesLoaded && !this.filesLoading && this.projectPath) {
					this.loadProjectFiles(this.projectPath).mapErr(() => {
						// Error is logged in loadProjectFiles
					});
				}

				this.showFileDropdown = true;
				this.fileStartIndex = trigger.startIndex;
				this.fileQuery = trigger.query;
				this.filePosition = positionResult.value;
				// Close slash dropdown if open
				this.showSlashDropdown = false;
				this.slashQuery = "";
				return;
			}
		}

		this.showFileDropdown = false;
		this.fileQuery = "";

		// Check for slash command trigger
		const slashTriggerResult = parseSlashCommandTrigger(this.message, cursorPos);

		if (slashTriggerResult.isOk() && slashTriggerResult.value) {
			const trigger = slashTriggerResult.value;
			const positionResult = calculateDropdownPosition(this.textareaRef, trigger.startIndex);

			if (positionResult.isOk()) {
				this.showSlashDropdown = true;
				this.slashStartIndex = trigger.startIndex;
				this.slashQuery = trigger.query;
				this.slashPosition = positionResult.value;
				return;
			}
		}

		this.showSlashDropdown = false;
		this.slashQuery = "";
	}

	/**
	 * Handles keyboard events.
	 *
	 * @param event - Keyboard event
	 * @param effectiveAvailableModes - Available modes for mode switching
	 * @param effectiveCurrentModeId - Current mode ID
	 * @param onModeChange - Callback to change mode
	 * @param onSend - Callback to send message
	 * @returns True if the event was handled
	 */
	handleKeyDown(
		event: KeyboardEvent,
		effectiveAvailableModes: readonly { id: string }[],
		effectiveCurrentModeId: string | null,
		onModeChange: (modeId: string) => void,
		onSend: () => void,
		onSteer?: () => void
	): boolean {
		// If file dropdown is open, let it handle navigation keys
		if (this.showFileDropdown && this.fileDropdownRef) {
			const handled = this.fileDropdownRef.handleKeyDown(event);
			if (handled) {
				return true;
			}
		}

		// If slash dropdown is open, let it handle navigation keys
		if (this.showSlashDropdown && this.slashDropdownRef) {
			const handled = this.slashDropdownRef.handleKeyDown(event);
			if (handled) {
				return true;
			}
		}

		// Note: We don't intercept / or @ keypresses here.
		// Let the character be typed naturally, then handleInput() will detect
		// the trigger and open the appropriate dropdown. This ensures:
		// 1. The character appears in the input
		// 2. Backspace removes it and closes the dropdown via handleInput()

		// Handle Tab to cycle through modes
		if (event.key === "Tab" && !event.shiftKey && effectiveAvailableModes.length > 0) {
			event.preventDefault();
			const currentIndex = effectiveAvailableModes.findIndex(
				(m) => m.id === effectiveCurrentModeId
			);
			const nextIndex =
				currentIndex === -1
					? 1 % effectiveAvailableModes.length
					: (currentIndex + 1) % effectiveAvailableModes.length;
			const nextMode = effectiveAvailableModes[nextIndex];
			if (nextMode && nextMode.id !== effectiveCurrentModeId) {
				onModeChange(nextMode.id);
			}
			return true;
		}

		// Handle ⌘Enter to steer (cancel + send immediately)
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			event.stopPropagation();
			onSteer?.();
			return true;
		}

		// Handle Enter to send message (or queue when agent is busy)
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			onSend();
			return true;
		}

		// Delete whole inline artefact token when backspacing/deleting inside it.
		if (event.key === "Backspace" || event.key === "Delete") {
			const textarea = this.textareaRef;
			if (!textarea) {
				return false;
			}

			const selectionStart = textarea.selectionStart;
			const selectionEnd = textarea.selectionEnd;
			if (selectionStart !== selectionEnd) {
				return false;
			}

			const probePosition = event.key === "Backspace" ? selectionStart - 1 : selectionStart;
			const range = findInlineArtefactRangeAtPosition(this.message, probePosition);
			if (!range) {
				return false;
			}

			event.preventDefault();
			this.removeInlineTokenRange(range.start, range.end);
			return true;
		}

		return false;
	}

	removeInlineTokenRange(start: number, end: number): void {
		if (start < 0 || end < start || end > this.message.length) {
			return;
		}

		const removed = this.message.slice(start, end);
		this.cleanupInlineReferenceToken(removed);
		this.message = this.message.slice(0, start) + this.message.slice(end);
		if (this.textareaRef) {
			const nextPos = Math.min(start, this.message.length);
			this.textareaRef.setSelectionRange(nextPos, nextPos);
		}
		this.focusInput();
	}

	createInlineTextReferenceToken(text: string): string {
		const refId = crypto.randomUUID();
		this.inlineTextById.set(refId, text);
		return `@[text_ref:${refId}]`;
	}

	getInlineTextReferenceContent(refId: string): string | undefined {
		return this.inlineTextById.get(refId);
	}

	get inlineTextMap(): ReadonlyMap<string, string> {
		return this.inlineTextById;
	}

	updateInlineText(refId: string, newText: string): void {
		this.inlineTextById.set(refId, newText);
	}

	clearInlineTextMap(): void {
		this.inlineTextById.clear();
	}

	insertInlineTokenAtOffsets(token: string, start: number, end: number): number {
		const safeStart = Math.max(0, Math.min(start, this.message.length));
		const safeEnd = Math.max(safeStart, Math.min(end, this.message.length));
		const before = this.message.slice(0, safeStart);
		const after = this.message.slice(safeEnd);
		const separator = after.startsWith(" ") || after.length === 0 ? "" : " ";
		this.message = `${before}${token}${separator}${after}`;
		return safeStart + token.length + separator.length;
	}

	insertPlainTextAtOffsets(text: string, start: number, end: number): void {
		const safeStart = Math.max(0, Math.min(start, this.message.length));
		const safeEnd = Math.max(safeStart, Math.min(end, this.message.length));
		const before = this.message.slice(0, safeStart);
		const after = this.message.slice(safeEnd);
		const sanitized = text.replaceAll("@[", "@\u200B[");
		this.message = `${before}${sanitized}${after}`;
	}

	private focusInput(): void {
		if (this.editorRef) {
			this.editorRef.focus();
			return;
		}
		this.textareaRef?.focus();
	}

	insertInlineTokenAtCursor(token: string): void {
		const textarea = this.textareaRef;
		if (!textarea) {
			this.message = `${this.message}${token}`;
			return;
		}

		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const before = this.message.slice(0, start);
		const after = this.message.slice(end);
		const separator = after.startsWith(" ") || after.length === 0 ? "" : " ";
		const insertion = `${token}${separator}`;
		this.message = `${before}${insertion}${after}`;

		const nextPos = before.length + insertion.length;
		textarea.setSelectionRange(nextPos, nextPos);
		textarea.focus();
	}

	// ============================================
	// DROPDOWN SHORTCUTS
	// ============================================

	/**
	 * Opens the slash command dropdown at the current cursor position.
	 */
	openSlashCommandDropdown(): void {
		if (!this.textareaRef) {
			return;
		}

		const cursorPos = this.textareaRef.selectionStart;
		const positionResult = calculateDropdownPosition(this.textareaRef, cursorPos);

		if (positionResult.isOk()) {
			this.showSlashDropdown = true;
			this.slashStartIndex = cursorPos;
			this.slashQuery = "";
			this.slashPosition = positionResult.value;
			// Close file dropdown if open
			this.showFileDropdown = false;
			this.fileQuery = "";
		}
	}

	/**
	 * Opens the file picker dropdown at the current cursor position.
	 */
	openFilePickerDropdown(): void {
		if (!this.textareaRef) {
			return;
		}

		// Lazy load files if not already loaded
		if (!this.filesLoaded && !this.filesLoading && this.projectPath) {
			this.loadProjectFiles(this.projectPath).mapErr(() => {
				// Error is logged in loadProjectFiles
			});
		}

		const cursorPos = this.textareaRef.selectionStart;
		const positionResult = calculateDropdownPosition(this.textareaRef, cursorPos);

		if (positionResult.isOk()) {
			this.showFileDropdown = true;
			this.fileStartIndex = cursorPos;
			this.fileQuery = "";
			this.filePosition = positionResult.value;
			// Close slash dropdown if open
			this.showSlashDropdown = false;
			this.slashQuery = "";
		}
	}

	// ============================================
	// DROPDOWN HANDLERS
	// ============================================

	/**
	 * Handles selection of a slash command.
	 *
	 * @param command - The selected command
	 */
	handleCommandSelect(command: AvailableCommand): void {
		// Replace "/partial" with an inline command token.
		const before = this.message.substring(0, this.slashStartIndex);
		const cursorPos = this.textareaRef?.selectionStart ?? this.message.length;
		const after = this.message.substring(cursorPos);
		const tokenType = this.isSkillCommand(command) ? "skill" : "command";
		this.message = `${before}@[${tokenType}:/${command.name}] ${after}`;
		this.showSlashDropdown = false;
		this.slashQuery = "";

		this.focusInput();
	}

	/**
	 * Closes the slash command dropdown.
	 */
	handleDropdownClose(): void {
		this.showSlashDropdown = false;
		this.slashQuery = "";
	}

	/**
	 * Handles selection of a file.
	 * Adds the file as an attachment badge instead of inserting text.
	 *
	 * @param file - The selected file
	 */
	handleFileSelect(file: FilePickerEntry): void {
		// Replace "@query" trigger text with an inline file token in the input.
		const before = this.message.substring(0, this.fileStartIndex);
		const cursorPos = this.textareaRef?.selectionStart ?? this.message.length;
		const after = this.message.substring(cursorPos);
		this.message = `${before}@[file:${file.path}] ${after}`;

		this.showFileDropdown = false;
		this.fileQuery = "";

		this.focusInput();
	}

	/**
	 * Closes the file picker dropdown.
	 */
	handleFileDropdownClose(): void {
		this.showFileDropdown = false;
		this.fileQuery = "";
	}

	// ============================================
	// ATTACHMENT MANAGEMENT
	// ============================================

	/**
	 * Adds an attachment to the current message.
	 * Generates a unique ID for the attachment.
	 *
	 * @param attachment - Attachment data without ID
	 */
	addAttachment(attachment: Omit<Attachment, "id">): void {
		const id = crypto.randomUUID();
		this.attachments = [...this.attachments, { ...attachment, id }];
		this.logger.debug("[addAttachment] Added attachment", {
			id,
			type: attachment.type,
			path: attachment.path,
		});
	}

	/**
	 * Removes an attachment by its ID.
	 *
	 * @param id - The attachment ID to remove
	 */
	removeAttachment(id: string): void {
		this.attachments = this.attachments.filter((a) => a.id !== id);
		this.logger.debug("[removeAttachment] Removed attachment", { id });
	}

	/**
	 * Clears all attachments.
	 */
	clearAttachments(): void {
		this.attachments = [];
	}

	// ============================================
	// DRAG AND DROP HANDLERS
	// ============================================

	/**
	 * Handles drag over events for visual feedback.
	 *
	 * @param event - The drag event
	 */
	handleDragOver(event: DragEvent): void {
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = "copy";
		}
		this.isDragActive = true;
		this.isDragHovering = true;
	}

	/**
	 * Handles drag leave events.
	 */
	handleDragLeave(): void {
		this.isDragActive = false;
		this.isDragHovering = false;
	}

	/**
	 * Handles drop events for images.
	 * Creates attachment badges for dropped image files.
	 * Supports both file drops and image data drops (e.g., screenshots).
	 * Note: File drops from Finder are handled by Tauri events, not DOM events.
	 *
	 * @param event - The drop event
	 */
	handleDrop(event: DragEvent): void {
		event.preventDefault();
		this.isDragActive = false;
		this.isDragHovering = false;

		const dataTransfer = event.dataTransfer;
		if (!dataTransfer) return;

		let imageAdded = false;

		// Process image files from DOM drop (in-browser drags, not Finder drops)
		// Finder drops are handled by Tauri events via setupTauriDragDropListeners

		// First, try to get files
		const files = dataTransfer.files;
		for (const file of files) {
			if (isImageMimeType(file.type)) {
				createImageAttachment(file, file.type).map((a) => this.addAttachment(a));
				imageAdded = true;
			}
		}

		// If no files found, check items for image data (works for screenshot drops)
		if (!imageAdded && dataTransfer.items) {
			for (const item of dataTransfer.items) {
				if (isImageMimeType(item.type)) {
					const file = item.getAsFile();
					if (file) {
						createImageAttachment(file, item.type).map((a) => this.addAttachment(a));
						imageAdded = true;
					}
				}
			}
		}

		// Refocus textarea after drop
		this.textareaRef?.focus();
	}

	private cleanupInlineReferenceToken(tokenText: string): void {
		const match = tokenText.match(/^@\[text_ref:([^\]]+)\]$/);
		if (!match) return;
		const id = match[1];
		this.inlineTextById.delete(id);
	}

	private isSkillCommand(command: AvailableCommand): boolean {
		const desc = command.description.toLowerCase();
		return desc.includes("skill") || command.name.includes("_");
	}
}
