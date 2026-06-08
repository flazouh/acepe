/**
 * PrCardController — owns the agent panel's PR/git-card reactive state
 * (create/merge progress, fetched PR details, streaming ship-card preview, and
 * the render-key + fetch-target dedupe), hoisted out of the `agent-panel.svelte`
 * god controller so it is independently unit-testable.
 *
 * The async workflows (runCreatePrWorkflow/runMergePrWorkflow) and the PR-detail
 * fetch stay in the component (they depend on stores + Tauri); they drive this
 * controller through its mutator methods — the same callback shape the workflows
 * already expect. The PR-fetch $effect calls syncFetchTarget so the dedupe +
 * reset logic is testable in isolation. (Continues plan 2026-05-29-002.)
 */
import type { PrDetails } from "$lib/utils/tauri-client/git.js";
import type { ShipCardData } from "../../ship-card/ship-card-parser.js";
import { hasStreamingPreviewContent } from "../components/agent-panel-pure-helpers.js";

export interface PrFetchTarget {
	sessionId: string;
	projectPath: string;
	prNumber: number;
}

export class PrCardController {
	#createRunning = $state(false);
	#createLabel = $state<string | null>(null);
	#mergeRunning = $state(false);
	#details = $state<PrDetails | null>(null);
	#fetchError = $state<string | null>(null);
	#streamingShipData = $state<ShipCardData | null>(null);
	#renderKey = $state(0);
	#lastFetchedTargetKey = $state<string | null>(null);

	get createRunning(): boolean {
		return this.#createRunning;
	}
	get createLabel(): string | null {
		return this.#createLabel;
	}
	get mergeRunning(): boolean {
		return this.#mergeRunning;
	}
	get details(): PrDetails | null {
		return this.#details;
	}
	get fetchError(): string | null {
		return this.#fetchError;
	}
	get streamingShipData(): ShipCardData | null {
		return this.#streamingShipData;
	}
	get renderKey(): number {
		return this.#renderKey;
	}

	setCreateRunning(running: boolean): void {
		this.#createRunning = running;
	}

	setCreateLabel(label: string | null): void {
		this.#createLabel = label;
	}

	setMergeRunning(running: boolean): void {
		this.#mergeRunning = running;
	}

	resetStream(): void {
		this.#streamingShipData = null;
	}

	/**
	 * Apply a streaming ship-card update. Bumps the render key on the
	 * no-preview → preview transition so the card remounts cleanly (verbatim from
	 * the original onStreamUpdate callback).
	 */
	applyStreamUpdate(data: ShipCardData | null): void {
		const hadPreviewContent = hasStreamingPreviewContent(this.#streamingShipData);
		const hasPreviewContent = hasStreamingPreviewContent(data);
		if (!hadPreviewContent && hasPreviewContent) {
			this.#renderKey += 1;
		}
		this.#streamingShipData = data;
	}

	/** Clear fetched PR details + error (before a refetch). */
	resetDetails(): void {
		this.#details = null;
		this.#fetchError = null;
	}

	setDetails(details: PrDetails | null): void {
		this.#details = details;
	}

	/**
	 * Drive the PR-detail fetch from a reactive target. No target → clear details
	 * + dedupe key. Same target as last fetch → no-op. New target → record key and
	 * invoke the injected fetch. Mirrors the original $effect verbatim.
	 */
	syncFetchTarget(target: PrFetchTarget | null, fetch: (target: PrFetchTarget) => void): void {
		if (!target) {
			this.#details = null;
			this.#fetchError = null;
			this.#lastFetchedTargetKey = null;
			return;
		}

		const targetKey = `${target.sessionId}:${target.projectPath}:${target.prNumber}`;
		if (targetKey === this.#lastFetchedTargetKey) {
			return;
		}

		this.#lastFetchedTargetKey = targetKey;
		fetch(target);
	}
}
