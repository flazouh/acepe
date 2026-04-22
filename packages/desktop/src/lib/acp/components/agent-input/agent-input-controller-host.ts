import type { ComposerInteractionState } from "../../logic/composer-ui-state.js";
import type { getConnectionStore } from "../../store/connection-store.svelte.js";
import type { getMessageQueueStore } from "../../store/message-queue/message-queue-store.svelte.js";
import type { getPanelStore } from "../../store/panel-store.svelte.js";
import type { getSessionStore } from "../../store/session-store.svelte.js";
import type { Logger } from "../../utils/logger.js";
import type { AgentInputState } from "./state/agent-input-state.svelte.js";
import type { AgentInputProps } from "./types/agent-input-props.js";

/**
 * Dependency surface for {@link createAgentInputController}. The Svelte component
 * implements this with getters so each call sees current rune/store state.
 */
export interface AgentInputControllerHost {
	getProps: () => AgentInputProps;
	inputState: AgentInputState;
	getComposerInteraction: () => ComposerInteractionState;
	getAutonomousToggleActive: () => boolean;
	getProvisionalModeId: () => string | null;
	getProvisionalModelId: () => string | null;
	getIsStreaming: () => boolean;
	sessionStore: ReturnType<typeof getSessionStore>;
	panelStore: ReturnType<typeof getPanelStore>;
	connectionStore: ReturnType<typeof getConnectionStore>;
	messageQueueStore: ReturnType<typeof getMessageQueueStore>;
	logger: Logger;
	syncEditorFromMessage: (nextCursor?: number | null) => void;
	getEditorRef: () => HTMLDivElement | null;
	getLastDraftValue: () => string;
	setLastDraftValue: (v: string) => void;
	getDraftDebounceTimer: () => ReturnType<typeof setTimeout> | null;
	setDraftDebounceTimer: (t: ReturnType<typeof setTimeout> | null) => void;
	handleCancel: () => void | Promise<void>;
}
