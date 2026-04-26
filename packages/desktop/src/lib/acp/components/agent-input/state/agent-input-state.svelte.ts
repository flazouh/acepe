import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { SvelteMap } from "svelte/reactivity";

import { getZoomService } from "$lib/services/zoom.svelte.js";
import { fileIndex } from "$lib/utils/tauri-client/file-index.js";
import { LOGGER_IDS } from "../../../constants/logger-ids.js";
import type { PanelStore } from "../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../store/session-store.svelte.js";
import { deriveSessionTitleFromUserInput } from "../../../store/session-title-policy.js";
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
	 * Project path associated with the current file picker cache.
	 */
	loadedProjectPath = $state<string | null>(null);

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
	private isDestroyed = false;

	/**
	 * Creates a new AgentInputState instance.
	 *
	 * @param store - Session store for managing sessions
	 * @param panelStore - Panel store for optimistic pending entry management
	 * @param projectPathGetter - Getter function that returns the current file picker root.
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
	 * Current file picker root path for lazy file loading.
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
		this.isDestroyed = false;
		// Focus textarea on mount
		setTimeout(() => {
			this.focusInput();
		}, 0);

		// Set up Tauri drag-drop event listeners
		this.setupTauriDragDropListeners();
	}

	/**
	 * Checks if a position is within the container element's bounds.
	 * Native Tauri drag coordinates are reported in logical window pixels, so
	 * the DOM rect must be scaled out of CSS pixels before hit-testing.
	 */
	private isPositionInBounds(position: { x: number; y: number }): boolean {
		if (!this.containerRef) return false;
		const rect = this.containerRef.getBoundingClientRect();
		const zoomLevel = getZoomService().zoomLevel;
		const normalizedZoomLevel = Number.isFinite(zoomLevel) && zoomLevel > 0 ? zoomLevel : 1;
		const left = rect.left * normalizedZoomLevel;
		const right = rect.right * normalizedZoomLevel;
		const top = rect.top * normalizedZoomLevel;
		const bottom = rect.bottom * normalizedZoomLevel;

		return position.x >= left && position.x <= right && position.y >= top && position.y <= bottom;
	}

	/**
	 * Sets up Tauri event listeners for file drag-drop.
	 * Tauri uses its own event system instead of browser drag events.
	 */
	private async setupTauriDragDropListeners(): Promise<void> {
		// Listen for file drop hover (drag over)
		const hoverUnlisten = await listen<{
			paths: string[];
			position: { x: number; y: number };
		}>("tauri://drag-over", (event) => {
			if (this.isDestroyed) return;
			// Always show drop zone when dragging in window
			this.isDragActive = true;
			// Highlight only when over this specific container
			this.isDragHovering = this.isPositionInBounds(event.payload.position);
		});
		this.registerResolvedDragDropListener("hover", hoverUnlisten);

		// Listen for file drop
		const dropUnlisten = await listen<{ paths: string[]; position: { x: number; y: number } }>(
			"tauri://drag-drop",
			async (event) => {
				if (this.isDestroyed) return;
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
						const content = await fileIndex.readImageAsBase64(filePath).match(
							(value) => value,
							() => undefined
						);

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
		this.registerResolvedDragDropListener("drop", dropUnlisten);

		// Listen for drag cancelled (drag leave)
		const leaveUnlisten = await listen("tauri://drag-leave", () => {
			if (this.isDestroyed) return;
			this.isDragActive = false;
			this.isDragHovering = false;
		});
		this.registerResolvedDragDropListener("leave", leaveUnlisten);
	}

	private registerResolvedDragDropListener(
		listenerKind: "hover" | "drop" | "leave",
		unlisten: UnlistenFn
	): void {
		const managedUnlisten = this.createManagedUnlisten(unlisten);

		if (this.isDestroyed) {
			this.runUnlisten(listenerKind, managedUnlisten);
			return;
		}

		if (listenerKind === "hover") {
			this.unlistenFileDropHover = managedUnlisten;
			return;
		}

		if (listenerKind === "drop") {
			this.unlistenFileDrop = managedUnlisten;
			return;
		}

		this.unlistenFileDropCancelled = managedUnlisten;
	}

	private createManagedUnlisten(unlisten: UnlistenFn): UnlistenFn {
		let isActive = true;

		return async () => {
			if (!isActive) {
				return;
			}

			isActive = false;
			await unlisten();
		};
	}

	private normalizeUnlistenError(error: unknown): Error {
		if (error instanceof Error) {
			return error;
		}

		return new Error(String(error));
	}

	private isMissingTauriListenerError(error: Error): boolean {
		return error.message.includes("listeners[eventId].handlerId");
	}

	private runUnlisten(listenerKind: string, unlisten: UnlistenFn): void {
		void Promise.resolve()
			.then(() => unlisten())
			.catch((rawError) => {
				const error = this.normalizeUnlistenError(rawError);
				if (this.isMissingTauriListenerError(error)) {
					this.logger.debug("Drag-drop listener already removed during teardown", {
						listenerKind,
						error,
					});
					return;
				}

				this.logger.warn("Failed to unregister drag-drop listener", {
					listenerKind,
					error,
				});
			});
	}

	private clearDragDropListener(listenerKind: "hover" | "drop" | "leave"): void {
		if (listenerKind === "hover") {
			const unlisten = this.unlistenFileDropHover;
			this.unlistenFileDropHover = null;
			if (unlisten) {
				this.runUnlisten(listenerKind, unlisten);
			}
			return;
		}

		if (listenerKind === "drop") {
			const unlisten = this.unlistenFileDrop;
			this.unlistenFileDrop = null;
			if (unlisten) {
				this.runUnlisten(listenerKind, unlisten);
			}
			return;
		}

		const unlisten = this.unlistenFileDropCancelled;
		this.unlistenFileDropCancelled = null;
		if (unlisten) {
			this.runUnlisten(listenerKind, unlisten);
		}
	}

	/**
	 * Cleans up resources including Tauri event listeners.
	 */
	destroy(): void {
		this.isDestroyed = true;
		// Clean up Tauri event listeners
		this.clearDragDropListener("drop");
		this.clearDragDropListener("hover");
		this.clearDragDropListener("leave");
	}

	// ============================================
	// FILE LOADING
	// ============================================

	/**
	 * Loads project files from the backend.
	 *
	 * @param projectPath - Path to the project
	 * @param options - Loading options
	 * @returns ResultAsync containing void on success
	 */
	loadProjectFiles(
		projectPath: string,
		options?: { refresh?: boolean }
	): ResultAsync<void, FileLoadError> {
		const refresh = Boolean(options?.refresh);
		const reuseLoadedFiles = this.filesLoaded && this.loadedProjectPath === projectPath && !refresh;

		this.logger.debug("[loadProjectFiles] Called", {
			projectPath,
			refresh,
			loadedProjectPath: this.loadedProjectPath,
			filesLoaded: this.filesLoaded,
			filesLoading: this.filesLoading,
		});

		if (!projectPath || this.filesLoading || reuseLoadedFiles) {
			this.logger.debug(
				"[loadProjectFiles] Skipping - no path, already loaded for this root, or loading"
			);
			return okAsync(undefined);
		}

		if (refresh || this.loadedProjectPath !== projectPath) {
			this.availableFiles = [];
			this.filesLoaded = false;
		}

		this.filesLoading = true;
		this.loadedProjectPath = projectPath;

		const invalidateCachedFiles = refresh
			? fileIndex
					.invalidateProjectFiles(projectPath)
					.mapErr(
						(err) =>
							new FileLoadError(projectPath, err instanceof Error ? err : new Error(String(err)))
					)
					.orElse((error) => {
						this.logger.warn("[loadProjectFiles] Failed to invalidate cached project files", {
							projectPath,
							error,
						});
						return okAsync(undefined);
					})
			: okAsync(undefined);

		return invalidateCachedFiles
			.andThen(() =>
				fileIndex
					.getProjectFiles(projectPath)
					.mapErr(
						(err) =>
							new FileLoadError(projectPath, err instanceof Error ? err : new Error(String(err)))
					)
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
		initialAutonomousEnabled?: boolean | null;
		initialModeId?: string | null;
		initialModelId?: string | null;
		selectedAgentId?: string | null;
		projectPath?: string | null;
		projectName?: string | null;
		onSessionCreated?: (sessionId: string, panelId?: string | null) => void;
		worktreePath?: string | null;
		launchToken?: string | null;
		imageAttachments?: readonly Attachment[];
	}): ResultAsync<void, SessionCreationError | MessageSendError> {
		const {
			content,
			panelId,
			sessionId,
			initialAutonomousEnabled,
			initialModeId,
			initialModelId,
			selectedAgentId,
			projectPath,
			projectName,
			onSessionCreated,
			worktreePath,
			launchToken,
			imageAttachments = [],
		} = options;
		// Use existing session or create new one
		const sendT0 = performance.now();
		if (sessionId) {
			return sendMessage(this.store, sessionId, content, imageAttachments).map(() => {
				this.logger.info("[PERF] sendMessage: fast-path resolved", {
					sessionId,
					elapsed_ms: Math.round(performance.now() - sendT0),
				});
				onSessionCreated?.(sessionId, panelId ?? null);
				this.focusInput();
			});
		}

		// Validate project and agent are set before session creation.
		if (!projectPath || projectPath.trim().length === 0) {
			return errAsync(
				new SessionCreationError(
					selectedAgentId ?? "unknown",
					"unknown",
					new Error("No project selected for this panel")
				)
			);
		}

		const effectiveProjectPath = projectPath;
		if (!selectedAgentId) {
			return errAsync(
				new SessionCreationError(
					"unknown",
					effectiveProjectPath,
					new Error("No agent selected for this panel")
				)
			);
		}

		// Create session and send message
		const effectiveProjectName = projectName || "Default Project";
		const initialSessionTitle = deriveSessionTitleFromUserInput(content);

		this.logger.info("[PERF] sendMessage: SLOW PATH (no eager session, creating new)", {
			agentId: selectedAgentId,
			elapsed_ms: Math.round(performance.now() - sendT0),
		});
		this.logger.info("[PERF] sendMessage: slow path (creating session)", {
			selectedAgentId,
			projectPath: effectiveProjectPath,
			worktreePath: worktreePath ?? null,
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
			initialAutonomousEnabled: initialAutonomousEnabled === true,
			initialModeId,
			initialModelId,
			projectPath: effectiveProjectPath,
			projectName: effectiveProjectName,
			title: initialSessionTitle,
			worktreePath: worktreePath ?? undefined,
			launchToken: launchToken ?? undefined,
		})
			.andThen((newSessionId) => {
				this.logger.info("[PERF] sendMessage: session created", {
					newSessionId,
					elapsed_ms: Math.round(performance.now() - sendT0),
				});
				// Notify parent with the canonical session ID
				onSessionCreated?.(newSessionId, panelId ?? null);
				return sendMessage(this.store, newSessionId, content, imageAttachments);
			})
			.map(() => {
				if (panelId) this.panelStore.clearPendingUserEntry(panelId);
				this.logger.info("[PERF] sendMessage: slow-path resolved", {
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
				if (this.projectPath) {
					this.loadProjectFiles(this.projectPath, {
						refresh: !this.showFileDropdown,
					}).mapErr(() => {
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

		if (this.projectPath) {
			this.loadProjectFiles(this.projectPath, { refresh: true }).mapErr(() => {
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
		const matches = tokenText.matchAll(/@\[text_ref:([^\]]+)\]/g);
		for (const match of matches) {
			const id = match[1];
			if (id) {
				this.inlineTextById.delete(id);
			}
		}
	}

	private isSkillCommand(command: AvailableCommand): boolean {
		const desc = command.description.toLowerCase();
		return desc.includes("skill") || command.name.includes("_");
	}
}
