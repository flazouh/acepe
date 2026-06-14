import { resolveVoiceStateLifecycle } from "../logic/voice-state-lifecycle.js";
import type { VoiceInputState } from "./voice-input-state.svelte.js";

export type VoiceInputStateFactory = (sessionId: string) => VoiceInputState;

export type VoiceSessionControllerDeps = {
	readonly getEffectiveVoiceSessionId: () => string | null;
	readonly getVoiceEnabled: () => boolean;
	readonly createVoiceInputState: VoiceInputStateFactory;
};

/**
 * Owns voice FSM lifecycle for one composer host: session flip detection,
 * async listener registration, and coordinated teardown. Keeps two race
 * mechanisms — a per-init generation token (cross-flip identity) and each
 * VoiceInputState instance's disposed flag (intra-instance late callbacks).
 */
export class VoiceSessionController {
	readonly #deps: VoiceSessionControllerDeps;

	voiceState = $state<VoiceInputState | null>(null);

	#managedSessionId = $state<string | null>(null);
	#pendingSessionId = $state<string | null>(null);
	#initGeneration = 0;

	readonly ready = $derived.by(() => {
		const targetSessionId = this.#deps.getEffectiveVoiceSessionId();
		if (!this.#deps.getVoiceEnabled() || targetSessionId === null) {
			return false;
		}
		return this.voiceState !== null && this.#managedSessionId === targetSessionId;
	});

	constructor(deps: VoiceSessionControllerDeps) {
		this.#deps = deps;
	}

	sync(): void {
		const effectiveSessionId = this.#deps.getEffectiveVoiceSessionId();
		const voiceEnabled = this.#deps.getVoiceEnabled();
		const currentManagedSessionId =
			this.#pendingSessionId !== null ? this.#pendingSessionId : this.#managedSessionId;
		const lifecycle = resolveVoiceStateLifecycle(
			currentManagedSessionId,
			effectiveSessionId,
			voiceEnabled
		);

		if (lifecycle === "noop") {
			return;
		}

		if (lifecycle === "dispose" || lifecycle === "replace") {
			this.#disposeVoiceState();
		}

		if ((lifecycle === "init" || lifecycle === "replace") && effectiveSessionId !== null) {
			void this.#initializeVoiceState(effectiveSessionId);
		}
	}

	dispose(): void {
		this.#disposeVoiceState();
	}

	async #initializeVoiceState(targetSessionId: string): Promise<void> {
		if (!this.#deps.getVoiceEnabled()) {
			return;
		}

		const generation = ++this.#initGeneration;
		this.#pendingSessionId = targetSessionId;
		const nextVoiceState = this.#deps.createVoiceInputState(targetSessionId);

		await nextVoiceState.registerListeners();
		if (
			generation !== this.#initGeneration ||
			!this.#deps.getVoiceEnabled() ||
			this.#deps.getEffectiveVoiceSessionId() !== targetSessionId
		) {
			nextVoiceState.dispose();
			if (generation === this.#initGeneration) {
				this.#pendingSessionId = null;
			}
			return;
		}

		this.voiceState = nextVoiceState;
		this.#managedSessionId = targetSessionId;
		this.#pendingSessionId = null;
	}

	#disposeVoiceState(): void {
		this.#initGeneration += 1;
		this.#pendingSessionId = null;
		this.#managedSessionId = null;
		this.voiceState?.dispose();
		this.voiceState = null;
	}
}
