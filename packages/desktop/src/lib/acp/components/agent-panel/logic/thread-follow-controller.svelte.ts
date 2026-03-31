export const THREAD_FOLLOW_CONTROLLER_CONTEXT = Symbol("thread-follow-controller");

const REVEAL_SETTLE_FRAME_BUDGET = 3;

export interface ThreadRevealTargetHandle {
	reveal(force?: boolean): boolean;
	isMounted(): boolean;
}

type FollowControllerOptions = {
	isFollowing(): boolean;
	isNearBottom(): boolean;
	revealListBottom(force?: boolean): boolean;
	getLatestTargetKey(): string | null;
	getLatestUserTargetKey(): string | null;
};

export class ThreadFollowController {
	private readonly options: FollowControllerOptions;
	private readonly targets = new Map<string, ThreadRevealTargetHandle>();
	private pendingTargetKey: string | null = null;
	private pendingForce = false;
	private pendingRequireLatest = true;
	private pendingNextLatestForce = false;
	private pendingNextUserForce = false;
	private revealFramesRemaining = 0;
	private revealRafId: number | null = null;
	/** Incremented on reset() so stale RAF callbacks become no-ops. */
	private generation = 0;

	constructor(options: FollowControllerOptions) {
		this.options = options;
	}

	registerTarget(targetKey: string, handle: ThreadRevealTargetHandle): () => void {
		this.targets.set(targetKey, handle);
		if (targetKey === this.options.getLatestTargetKey()) {
			const force = this.pendingNextLatestForce;
			this.pendingNextLatestForce = false;
			this.scheduleReveal(targetKey, force);
		}
		if (targetKey === this.options.getLatestUserTargetKey()) {
			const force = this.pendingNextUserForce;
			this.pendingNextUserForce = false;
			if (force) {
				this.scheduleReveal(targetKey, true, { requireLatest: false });
			}
		}
		return () => {
			const currentHandle = this.targets.get(targetKey);
			if (currentHandle === handle) {
				this.targets.delete(targetKey);
			}
		};
	}

	requestReveal(targetKey: string, options?: { force?: boolean }): void {
		if (targetKey !== this.options.getLatestTargetKey()) {
			return;
		}
		this.scheduleReveal(targetKey, options?.force ?? false);
	}

	requestLatestReveal(options?: { force?: boolean }): void {
		this.scheduleReveal(this.options.getLatestTargetKey(), options?.force ?? false);
	}

	prepareForNextLatestReveal(options?: { force?: boolean }): void {
		this.pendingNextLatestForce = this.pendingNextLatestForce || (options?.force ?? false);
	}

	prepareForNextUserReveal(options?: { force?: boolean }): void {
		this.pendingNextUserForce = this.pendingNextUserForce || (options?.force ?? false);
	}

	reset(): void {
		this.generation += 1;

		if (this.revealRafId !== null) {
			cancelAnimationFrame(this.revealRafId);
			this.revealRafId = null;
		}

		this.pendingTargetKey = null;
		this.pendingForce = false;
		this.pendingRequireLatest = true;
		this.pendingNextLatestForce = false;
		this.pendingNextUserForce = false;
		this.revealFramesRemaining = 0;
		this.targets.clear();
	}

	private scheduleReveal(
		targetKey: string | null,
		force: boolean,
		options?: { requireLatest?: boolean }
	): void {
		const requireLatest = options?.requireLatest ?? true;
		const hasPendingForcedExplicitTarget =
			this.pendingTargetKey !== null && this.pendingForce && !this.pendingRequireLatest;

		// Preserve an explicit forced target, such as the next user turn after send,
		// against later non-forced latest-target registrations in the same frame.
		if (hasPendingForcedExplicitTarget && !force) {
			this.revealFramesRemaining = REVEAL_SETTLE_FRAME_BUDGET;
			if (this.revealRafId === null) {
				this.requestRevealFrame();
			}
			return;
		}

		this.pendingTargetKey = targetKey;
		this.pendingForce = this.pendingForce || force;
		this.pendingRequireLatest = requireLatest;
		this.revealFramesRemaining = REVEAL_SETTLE_FRAME_BUDGET;
		if (this.revealRafId !== null) return;
		this.requestRevealFrame();
	}

	private requestRevealFrame(): void {
		// Guard against synchronous rAF execution (test environments).
		// If the callback already ran, avoid storing a stale RAF ID that would
		// block future requests via the `revealRafId !== null` coalescing guard.
		let ranSynchronously = false;
		const requestId = requestAnimationFrame(() => {
			ranSynchronously = true;
			this.revealRafId = null;
			this.flushReveal();
		});
		this.revealRafId = ranSynchronously ? null : requestId;
	}

	private flushReveal(): void {
		const gen = this.generation;
		const force = this.pendingForce;
		const targetKey = this.pendingTargetKey;
		const requireLatest = this.pendingRequireLatest;

		this.pendingForce = false;
		this.pendingTargetKey = null;
		this.pendingRequireLatest = true;

		if (!force && !this.options.isFollowing()) {
			this.revealFramesRemaining = 0;
			return;
		}

		const latestTargetKey = this.options.getLatestTargetKey();
		const targetHandle = targetKey === null ? undefined : this.targets.get(targetKey);
		const targetMounted = targetHandle?.isMounted() ?? false;
		const shouldRevealTarget =
			targetKey !== null && targetMounted && (!requireLatest || targetKey === latestTargetKey);
		const revealed = shouldRevealTarget
			? (targetHandle?.reveal(force) ?? false)
			: this.options.revealListBottom(force);

		if (gen !== this.generation) {
			this.revealFramesRemaining = 0;
			return;
		}

		if (!revealed) {
			if (this.revealFramesRemaining <= 0) {
				this.revealFramesRemaining = 0;
				return;
			}

			this.revealFramesRemaining -= 1;
			this.pendingTargetKey = targetKey;
			this.pendingForce = force;
			this.pendingRequireLatest = requireLatest;
			this.requestRevealFrame();
			return;
		}

		if (!this.options.isFollowing()) {
			this.revealFramesRemaining = 0;
			return;
		}

		if (this.options.isNearBottom() || this.revealFramesRemaining <= 0) {
			return;
		}

		this.revealFramesRemaining -= 1;
		this.pendingTargetKey = targetKey;
		this.pendingRequireLatest = requireLatest;
		this.requestRevealFrame();
	}
}
