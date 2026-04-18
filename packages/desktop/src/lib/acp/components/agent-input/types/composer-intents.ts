/**
 * Product intents for the composer (submit, steer, mode/model changes).
 * Implemented by `agent-input-ui.svelte` and delegated to stores / session workflows.
 */
export type ComposerSurfaceIntents = {
	readonly requestSubmitOrQueue: () => void | Promise<void>;
	readonly requestSteer: () => void;
	readonly requestCancelStream: () => void | Promise<void>;
};
