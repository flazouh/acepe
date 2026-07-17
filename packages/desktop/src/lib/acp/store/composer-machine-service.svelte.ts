/**
 * Hosts per-session composer policy actors with reactive snapshot caching (SvelteMap).
 * Mirrors SessionConnectionService patterns.
 */

import { SvelteMap } from "svelte/reactivity";
import { createActor } from "xstate";

import { type ComposerMachineEvent, composerMachine } from "../logic/composer-machine.js";
import type { ComposerMachineSnapshot } from "../logic/composer-ui-state.js";
import { deriveStoreComposerState, type StoreComposerState } from "../logic/composer-ui-state.js";
import type { LiveSessionLifecyclePresentation } from "./live-session-work.js";
import type { SessionTransientProjectionStore } from "./session-transient-projection-store.svelte.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger({ id: "composer-machine-service", name: "ComposerMachineService" });

type ComposerActor = ReturnType<typeof createActor<typeof composerMachine>>;

export interface ComposerSessionCommitState {
	readonly modeId: string | null;
	readonly modelId: string | null;
	readonly autonomousEnabled: boolean | null;
}

export type ComposerMachineServiceDeps = {
	readonly getCommitState: (sessionId: string) => ComposerSessionCommitState;
	readonly transientProjectionStore: SessionTransientProjectionStore;
	readonly getSessionLifecyclePresentation: (
		sessionId: string
	) => LiveSessionLifecyclePresentation;
};

export class ComposerMachineService {
	private readonly deps: ComposerMachineServiceDeps;

	constructor(deps: ComposerMachineServiceDeps) {
		this.deps = deps;
	}

	private readonly actors = new SvelteMap<string, ComposerActor>();
	private readonly snapshotCache = new SvelteMap<string, ComposerMachineSnapshot>();
	private readonly actorSubscriptions = new SvelteMap<string, () => void>();

	getStoreComposerState(sessionId: string): StoreComposerState | null {
		this.deps.transientProjectionStore.getTransientProjection(sessionId);
		const snapshot = this.getState(sessionId);
		if (!snapshot) {
			return null;
		}
		const lifecyclePresentation = this.deps.getSessionLifecyclePresentation(sessionId);
		return deriveStoreComposerState({
			machineSnapshot: snapshot,
			sessionSubmitPolicy: {
				canSubmit: lifecyclePresentation.canSubmit,
			},
		});
	}

	createOrGetActor(sessionId: string): ComposerActor {
		let actor = this.actors.get(sessionId);
		if (!actor) {
			actor = createActor(composerMachine, { input: { sessionId } });
			const sub = actor.subscribe((snapshot) => {
				this.snapshotCache.set(sessionId, snapshot);
			});
			this.actorSubscriptions.set(sessionId, sub.unsubscribe);
			actor.start();
			this.actors.set(sessionId, actor);
			logger.debug("Created composer machine", { sessionId });
		}
		return actor;
	}

	/**
	 * Reactive snapshot read — use inside $derived like SessionConnectionService.getState.
	 */
	getState(sessionId: string): ComposerMachineSnapshot | null {
		return this.snapshotCache.get(sessionId) ?? null;
	}

	removeMachine(sessionId: string): void {
		const unsub = this.actorSubscriptions.get(sessionId);
		if (unsub) {
			unsub();
			this.actorSubscriptions.delete(sessionId);
		}
		const actor = this.actors.get(sessionId);
		if (actor) {
			actor.stop();
			this.actors.delete(sessionId);
			logger.debug("Removed composer machine", { sessionId });
		}
		this.snapshotCache.delete(sessionId);
	}

	send(sessionId: string, event: ComposerMachineEvent): void {
		const actor = this.createOrGetActor(sessionId);
		actor.send(event);
	}

	/**
	 * Re-seeds committed config from canonical session projection and clears ephemeral composer state.
	 * Call when the composer binds to a session (including reopen / panel switch).
	 * Skipped while dispatching so an in-flight send is not torn down by SESSION_BOUND.
	 */
	bindSession(sessionId: string): void {
		const actor = this.createOrGetActor(sessionId);
		if (actor.getSnapshot().value === "dispatching") {
			logger.debug("bindSession skipped while dispatching", { sessionId });
			return;
		}
		const canonical = this.deps.getCommitState(sessionId);
		actor.send({
			type: "SESSION_BOUND",
			committedModeId: canonical.modeId,
			committedModelId: canonical.modelId,
			committedAutonomousEnabled: canonical.autonomousEnabled,
		});
	}

	beginDispatch(sessionId: string): void {
		const actor = this.createOrGetActor(sessionId);
		if (actor.getSnapshot().value !== "interactive") {
			logger.debug("beginDispatch skipped: not interactive", {
				sessionId,
				value: actor.getSnapshot().value,
			});
			return;
		}
		actor.send({ type: "DISPATCH_BEGIN" });
	}

	endDispatch(sessionId: string): void {
		const actor = this.actors.get(sessionId);
		if (!actor) {
			return;
		}
		if (actor.getSnapshot().value !== "dispatching") {
			return;
		}
		actor.send({ type: "DISPATCH_END" });
	}

	completeConfigSuccess(
		sessionId: string,
		acceptedState: ComposerSessionCommitState
	): void {
		this.send(sessionId, {
			type: "CONFIG_BLOCK_SUCCESS",
			committedModeId: acceptedState.modeId,
			committedModelId: acceptedState.modelId,
			committedAutonomousEnabled: acceptedState.autonomousEnabled,
		});
	}

	completeConfigFail(sessionId: string): void {
		this.send(sessionId, { type: "CONFIG_BLOCK_FAIL" });
	}

	/**
	 * Runs a config mutation with CONFIG_BLOCK_BEGIN / success|fail, invalidating stale results after SESSION_BOUND.
	 */
	async runConfigOperation(
		sessionId: string,
		beginPayload: Omit<Extract<ComposerMachineEvent, { type: "CONFIG_BLOCK_BEGIN" }>, "type">,
		operation: () => Promise<boolean>
	): Promise<boolean> {
		const actor = this.createOrGetActor(sessionId);
		const genStart = actor.getSnapshot().context.boundGeneration;
		this.send(sessionId, { type: "CONFIG_BLOCK_BEGIN", ...beginPayload });
		const afterBegin = actor.getSnapshot();
		if (afterBegin.value !== "configBlocking") {
			logger.warn("CONFIG_BLOCK_BEGIN did not enter configBlocking", {
				sessionId,
				value: afterBegin.value,
			});
			return false;
		}
		try {
			const ok = await operation();
			if (actor.getSnapshot().context.boundGeneration !== genStart) {
				return false;
			}
			if (ok) {
				this.completeConfigSuccess(sessionId, {
					modeId:
						beginPayload.provisionalModeId !== undefined
							? beginPayload.provisionalModeId
							: afterBegin.context.committedModeId,
					modelId:
						beginPayload.provisionalModelId !== undefined
							? beginPayload.provisionalModelId
							: afterBegin.context.committedModelId,
					autonomousEnabled:
						beginPayload.provisionalAutonomousEnabled !== undefined
							? beginPayload.provisionalAutonomousEnabled
							: afterBegin.context.committedAutonomousEnabled,
				});
			} else {
				this.completeConfigFail(sessionId);
			}
			return ok;
		} catch (error) {
			logger.warn("runConfigOperation failed", { sessionId, error });
			if (actor.getSnapshot().context.boundGeneration !== genStart) {
				return false;
			}
			this.completeConfigFail(sessionId);
			return false;
		}
	}
}
