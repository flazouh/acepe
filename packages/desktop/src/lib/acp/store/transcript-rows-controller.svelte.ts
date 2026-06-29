/**
 * TranscriptRowsController — rows-only session-store slice for the
 * DOM-authority transcript viewport. It owns per-session ordered rows and the
 * revision-driven request loop. It does not store pixels, scroll mode, offsets,
 * or viewport height; the WebView DOM owns those.
 */
import { SvelteMap } from "svelte/reactivity";
import type {
	SessionGraphRevision,
	SessionStateEnvelope,
	ViewportBufferDelta,
	ViewportBufferPush,
} from "../../services/acp-types.js";
import { createLogger } from "../utils/logger.js";
import { requestTranscriptViewportBuffer } from "../session-state/session-state-viewport-command-service.js";
import { TranscriptRowsStore } from "./transcript-rows-store.svelte.js";
import type { TranscriptRowsState } from "./transcript-rows-store.js";

const logger = createLogger({
	id: "transcript-rows-controller",
	name: "TranscriptRowsController",
});

export interface TranscriptRowsControllerDeps {
	readonly getGraphRevision: (sessionId: string) => SessionGraphRevision | undefined;
	readonly applySessionStateEnvelope: (sessionId: string, envelope: SessionStateEnvelope) => void;
}

export class TranscriptRowsController {
	readonly #rowsBySession = new SvelteMap<string, TranscriptRowsStore>();
	readonly #freshRowsRequestInFlight = new Set<string>();

	constructor(private readonly deps: TranscriptRowsControllerDeps) {}

	getRowsProjection(sessionId: string | null): TranscriptRowsState | null {
		if (sessionId === null) {
			return null;
		}
		return this.#rowsBySession.get(sessionId)?.state ?? null;
	}

	ensureRowsBootstrap(sessionId: string): void {
		if (this.#rowsBySession.has(sessionId)) {
			return;
		}
		this.requestFreshRows(sessionId);
	}

	applyBufferPush(push: ViewportBufferPush): void {
		const status = this.storeFor(push.sessionId).applyPush(push);
		if (status === "applied") {
			this.#freshRowsRequestInFlight.delete(push.sessionId);
			return;
		}
		logger.debug("Ignoring stale transcript rows push", {
			sessionId: push.sessionId,
			emissionSeq: push.emissionSeq,
		});
	}

	applyBufferDelta(delta: ViewportBufferDelta): void {
		const existingStore = this.#rowsBySession.get(delta.sessionId);
		if (existingStore === undefined) {
			this.requestFreshRows(delta.sessionId);
			return;
		}
		const status = existingStore.applyDelta(delta);
		if (status === "applied") {
			return;
		}
		if (status === "gap") {
			this.requestFreshRows(delta.sessionId);
			return;
		}
		logger.debug("Transcript rows delta not applied", {
			sessionId: delta.sessionId,
			status,
			emissionSeq: delta.emissionSeq,
		});
	}

	removeSession(sessionId: string): void {
		this.#rowsBySession.delete(sessionId);
		this.#freshRowsRequestInFlight.delete(sessionId);
	}

	private storeFor(sessionId: string): TranscriptRowsStore {
		const existing = this.#rowsBySession.get(sessionId);
		if (existing !== undefined) {
			return existing;
		}
		const store = new TranscriptRowsStore();
		this.#rowsBySession.set(sessionId, store);
		return store;
	}

	private requestFreshRows(sessionId: string): void {
		if (this.#freshRowsRequestInFlight.has(sessionId)) {
			return;
		}
		const revision = this.deps.getGraphRevision(sessionId);
		if (revision === undefined) {
			return;
		}
		this.#freshRowsRequestInFlight.add(sessionId);
		void requestTranscriptViewportBuffer({ sessionId, revision }).match(
			(envelope) => {
				if (envelope !== null) {
					this.deps.applySessionStateEnvelope(sessionId, envelope);
				}
				this.#freshRowsRequestInFlight.delete(sessionId);
			},
			() => {
				this.#freshRowsRequestInFlight.delete(sessionId);
			}
		);
	}
}
