/**
 * Chat Preferences Store - Persisted preferences for chat/conversation UI.
 *
 * - Thinking block: whether to show the thinking block collapsed by default.
 * Persisted via tauriClient.settings.
 */

import type { RevealMode } from "@acepe/ui/streaming-reveal";
import { getContext, setContext } from "svelte";
import type { UserSettingKey } from "$lib/services/user-settings-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger({ id: "chat-preferences", name: "ChatPreferencesStore" });

const THINKING_BLOCK_COLLAPSED_KEY: UserSettingKey = "chat_thinking_block_collapsed_by_default";
const STREAMING_REVEAL_MODE_KEY: UserSettingKey = "chat_streaming_reveal_mode";

const VALID_REVEAL_MODES: RevealMode[] = ["instant", "buffer", "buffer-fade", "block-fade"];

const STORE_KEY = Symbol("chat-preferences-store");

export class ChatPreferencesStore {
	/** When true, thinking blocks in assistant messages start collapsed. */
	thinkingBlockCollapsedByDefault = $state(false);
	/** How assistant replies animate as they stream in. */
	streamingRevealMode = $state<RevealMode>("buffer");
	isReady = $state(false);

	private initialized = false;

	async initialize(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;

		const thinkingResult = await tauriClient.settings.get<boolean>(THINKING_BLOCK_COLLAPSED_KEY);
		if (thinkingResult.isOk() && thinkingResult.value === true) {
			this.thinkingBlockCollapsedByDefault = true;
		}

		const revealModeResult = await tauriClient.settings.get<string>(STREAMING_REVEAL_MODE_KEY);
		if (revealModeResult.isOk() && revealModeResult.value !== null) {
			const loadedMode = revealModeResult.value;
			if (VALID_REVEAL_MODES.includes(loadedMode as RevealMode)) {
				this.streamingRevealMode = loadedMode as RevealMode;
			}
		}

		this.isReady = true;
	}

	async setThinkingBlockCollapsedByDefault(value: boolean): Promise<void> {
		this.thinkingBlockCollapsedByDefault = value;
		tauriClient.settings.set(THINKING_BLOCK_COLLAPSED_KEY, value).mapErr((err) => {
			logger.warn("Failed to persist thinking block preference", { error: err });
		});
	}

	setStreamingRevealMode(mode: RevealMode): void {
		this.streamingRevealMode = mode;
		tauriClient.settings.set(STREAMING_REVEAL_MODE_KEY, mode).mapErr((err) => {
			logger.warn("Failed to persist streaming reveal mode preference", { error: err });
		});
	}
}

export function createChatPreferencesStore(): ChatPreferencesStore {
	const store = new ChatPreferencesStore();
	setContext(STORE_KEY, store);
	return store;
}

export function getChatPreferencesStore(): ChatPreferencesStore | undefined {
	return getContext<ChatPreferencesStore>(STORE_KEY);
}
