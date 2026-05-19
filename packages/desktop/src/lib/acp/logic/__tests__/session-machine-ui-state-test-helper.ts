import type { SessionMachineSnapshot } from "../session-machine";
import { ConnectionState, ContentState } from "../session-machine";

export interface SessionUIState {
	readonly showContentLoading: boolean;
	readonly showConnecting: boolean;
	readonly showThinking: boolean;
	readonly showStreaming: boolean;
	readonly showConversation: boolean;
	readonly showReady: boolean;
	readonly showError: boolean;
	readonly inputEnabled: boolean;
	readonly isReadOnly: boolean;
}

export function deriveSessionUIState(state: SessionMachineSnapshot): SessionUIState {
	const content = state.content;
	const connection = state.connection;

	return {
		showContentLoading: content === ContentState.LOADING,
		showConnecting:
			connection === ConnectionState.CONNECTING || connection === ConnectionState.WARMING_UP,
		showThinking: connection === ConnectionState.AWAITING_RESPONSE,
		showStreaming: connection === ConnectionState.STREAMING,
		showConversation: content === ContentState.LOADED,
		showReady: content !== ContentState.LOADED && connection === ConnectionState.READY,
		showError: content === ContentState.ERROR || connection === ConnectionState.ERROR,
		inputEnabled: connection === ConnectionState.READY,
		isReadOnly: connection === ConnectionState.DISCONNECTED,
	};
}
