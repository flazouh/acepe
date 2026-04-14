/**
 * Chat Preferences Store - Persisted preferences for chat/conversation UI.
 *
 * - Thinking block: whether to show the thinking block collapsed by default.
 * Persisted via tauriClient.settings.
 */

import { getContext, setContext } from "svelte";
import type { UserSettingKey } from "$lib/services/converted-session-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import {
	DEFAULT_STREAMING_ANIMATION_MODE,
	normalizeStreamingAnimationMode,
	type StreamingAnimationMode,
} from "../types/streaming-animation-mode.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger({ id: "chat-preferences", name: "ChatPreferencesStore" });

const THINKING_BLOCK_COLLAPSED_KEY: UserSettingKey = "chat_thinking_block_collapsed_by_default";
const STREAMING_ANIMATION_KEY: UserSettingKey = "streaming_animation";

const STORE_KEY = Symbol("chat-preferences-store");

export class ChatPreferencesStore {
	/** When true, thinking blocks in assistant messages start collapsed. */
	thinkingBlockCollapsedByDefault = $state(false);
	streamingAnimationMode = $state<StreamingAnimationMode>(DEFAULT_STREAMING_ANIMATION_MODE);
	isReady = $state(false);

	private initialized = false;

	async initialize(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;

		const thinkingResult = await tauriClient.settings.get<boolean>(THINKING_BLOCK_COLLAPSED_KEY);
		if (thinkingResult.isOk() && thinkingResult.value === true) {
			this.thinkingBlockCollapsedByDefault = true;
		}

		const streamingAnimationResult = await tauriClient.settings.get<string>(STREAMING_ANIMATION_KEY);
		if (streamingAnimationResult.isOk()) {
			this.streamingAnimationMode = normalizeStreamingAnimationMode(
				streamingAnimationResult.value
			);
		}

		this.isReady = true;
	}

	async setThinkingBlockCollapsedByDefault(value: boolean): Promise<void> {
		this.thinkingBlockCollapsedByDefault = value;
		tauriClient.settings.set(THINKING_BLOCK_COLLAPSED_KEY, value).mapErr((err) => {
			logger.warn("Failed to persist thinking block preference", { error: err });
		});
	}

	async setStreamingAnimationMode(value: StreamingAnimationMode): Promise<void> {
		this.streamingAnimationMode = value;
		tauriClient.settings.set(STREAMING_ANIMATION_KEY, value).mapErr((err) => {
			logger.warn("Failed to persist streaming animation preference", { error: err });
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
