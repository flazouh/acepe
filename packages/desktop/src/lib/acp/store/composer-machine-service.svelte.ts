/**
 * Hosts per-session composer policy actors with reactive snapshot caching (SvelteMap).
 * Mirrors SessionConnectionService patterns.
 */

import { SvelteMap } from "svelte/reactivity";
import { createActor } from "xstate";

import { type ComposerMachineEvent, composerMachine } from "../logic/composer-machine.js";
import type { ComposerMachineSnapshot } from "../logic/composer-ui-state.js";
import { createLogger } from "../utils/logger.js";
import type { SessionHotState } from "./types.js";

const logger = createLogger({ id: "composer-machine-service", name: "ComposerMachineService" });

type ComposerActor = ReturnType<typeof createActor<typeof composerMachine>>;

export class ComposerMachineService {
	private readonly actors = new SvelteMap<string, ComposerActor>();
	private readonly snapshotCache = new SvelteMap<string, ComposerMachineSnapshot>();
	private readonly actorSubscriptions = new SvelteMap<string, () => void>();

	constructor(private readonly getHotState: (sessionId: string) => SessionHotState) {}

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
	 * Re-seeds committed config from canonical hot state and clears ephemeral composer state.
	 * Call when the composer binds to a session (including reopen / panel switch).
	 * Skipped while dispatching so an in-flight send is not torn down by SESSION_BOUND.
	 */
	bindSession(sessionId: string): void {
		const actor = this.createOrGetActor(sessionId);
		if (actor.getSnapshot().value === "dispatching") {
			logger.debug("bindSession skipped while dispatching", { sessionId });
			return;
		}
		const hot = this.getHotState(sessionId);
		actor.send({
			type: "SESSION_BOUND",
			committedModeId: hot.currentMode?.id ?? null,
			committedModelId: hot.currentModel?.id ?? null,
			committedAutonomousEnabled: hot.autonomousEnabled,
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

	completeConfigSuccess(sessionId: string): void {
		const hot = this.getHotState(sessionId);
		this.send(sessionId, {
			type: "CONFIG_BLOCK_SUCCESS",
			committedModeId: hot.currentMode?.id ?? null,
			committedModelId: hot.currentModel?.id ?? null,
			committedAutonomousEnabled: hot.autonomousEnabled,
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
				this.completeConfigSuccess(sessionId);
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
