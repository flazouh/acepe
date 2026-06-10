/**
 * PrLinkStateStore — owns the PR-link cache and refresh state of the session
 * store (see docs/adr/0002). Owns the per-project:prNumber cache Maps for PR
 * details and checks, the inflight dedupe Maps, the polling timer Maps, and the
 * link-update sequence Map. Exposes public methods for linking, unlinking,
 * refreshing, and subscribing to PR state.
 *
 * The parent `SessionStore` holds one instance and delegates its PR-link
 * public methods here. Callers that need per-project PR methods
 * (refreshSessionPrState, invalidatePrDetails, etc.) route through the store
 * facade unchanged.
 */
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import type { AppError } from "../errors/app-error.js";
import { SessionNotFoundError } from "../errors/app-error.js";
import { createLogger } from "../utils/logger.js";
import type { GitStackedPrStep, PrChecks, PrDetails } from "../../utils/tauri-client/git.js";
import { tauriClient } from "../../utils/tauri-client.js";
import type {
	SessionCold,
	SessionIdentity,
	SessionLinkedPr,
	SessionMetadata,
	SessionPrLinkMode,
} from "./types.js";
import type { SessionMutableColdUpdates } from "./types.js";
import { buildPartialSessionLinkedPr } from "../application/dto/session-linked-pr.js";
import { resolveAutomaticSessionPrNumberFromShipWorkflow } from "./services/session-pr-link-attribution.js";

const logger = createLogger({ id: "pr-link-state-store", name: "PrLinkStateStore" });

const PR_CHECKS_POLL_INTERVAL_MS = 10_000;
const PR_STATE_CACHE_TTL_MS = 60_000;
const PR_CHECKS_CACHE_TTL_MS = 10_000;

interface CachedPrDetails {
	details: PrDetails;
	fetchedAt: number;
}

interface CachedPrChecks {
	checks: PrChecks;
	fetchedAt: number;
}

interface SessionPrLinkRef {
	readonly sessionId: string;
	readonly projectPath: string;
	readonly prNumber: number;
	readonly prState: SessionMetadata["prState"];
	readonly linkedPr: SessionMetadata["linkedPr"];
}

function buildResolvedSessionLinkedPr(details: PrDetails): SessionLinkedPr {
	return {
		prNumber: details.number,
		state: details.state,
		url: details.url,
		title: details.title,
		additions: details.additions,
		deletions: details.deletions,
		isDraft: details.isDraft,
		isLoading: false,
		hasResolvedDetails: true,
		checksHeadSha: null,
		checks: [],
		isChecksLoading: true,
		hasResolvedChecks: false,
	};
}

function buildResolvedSessionPrChecks(
	checks: PrChecks
): Pick<SessionLinkedPr, "checksHeadSha" | "checks" | "isChecksLoading" | "hasResolvedChecks"> {
	return {
		checksHeadSha: checks.headSha,
		checks: checks.checkRuns.map((checkRun) => ({
			name: checkRun.name,
			status: checkRun.status,
			conclusion: checkRun.conclusion,
			detailsUrl: checkRun.detailsUrl,
			startedAt: checkRun.startedAt,
			completedAt: checkRun.completedAt,
			workflowName: checkRun.workflowName,
		})),
		isChecksLoading: false,
		hasResolvedChecks: true,
	};
}

function hasActivePrChecks(checks: SessionLinkedPr["checks"]): boolean {
	return checks.some((checkRun) => checkRun.status !== "COMPLETED");
}

export interface PrLinkStateDeps {
	getSessionMetadata: (sessionId: string) => SessionMetadata | undefined;
	getSessionIdentity: (sessionId: string) => SessionIdentity | undefined;
	getSessions: () => SessionCold[];
	getSessionsByProject: (projectPath: string) => SessionCold[] | undefined;
	updateSession: (
		id: string,
		updates: SessionMutableColdUpdates,
		options?: { touchUpdatedAt?: boolean }
	) => void;
}

export class PrLinkStateStore {
	readonly #deps: PrLinkStateDeps;

	// Cache/dedupe Maps
	private readonly prDetailsCache = new Map<string, CachedPrDetails>();
	private readonly prDetailsInflight = new Map<string, ResultAsync<PrDetails | null, never>>();
	private readonly prChecksCache = new Map<string, CachedPrChecks>();
	private readonly prChecksInflight = new Map<string, ResultAsync<PrChecks | null, never>>();
	private readonly prChecksVisibleSurfaces = new Map<string, Set<string>>();
	private readonly prChecksPollTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly prLinkUpdateSequence = new Map<string, number>();

	constructor(deps: PrLinkStateDeps) {
		this.#deps = deps;
	}

	updateSessionPrLink(
		sessionId: string,
		projectPath: string,
		prNumber: number | null,
		prLinkMode: SessionPrLinkMode
	): ResultAsync<void, AppError> {
		const sessionMetadata = this.#deps.getSessionMetadata(sessionId);
		if (!sessionMetadata) {
			return errAsync(new SessionNotFoundError(sessionId));
		}

		const nextLinkedPr =
			prNumber == null
				? undefined
				: sessionMetadata.linkedPr?.prNumber === prNumber
					? {
							prNumber: sessionMetadata.linkedPr.prNumber,
							state: sessionMetadata.linkedPr.state,
							url: sessionMetadata.linkedPr.url,
							title: sessionMetadata.linkedPr.title,
							additions: sessionMetadata.linkedPr.additions,
							deletions: sessionMetadata.linkedPr.deletions,
							isDraft: sessionMetadata.linkedPr.isDraft,
							isLoading: sessionMetadata.linkedPr.isLoading,
							hasResolvedDetails: sessionMetadata.linkedPr.hasResolvedDetails,
							checksHeadSha: sessionMetadata.linkedPr.checksHeadSha,
							checks: sessionMetadata.linkedPr.checks,
							isChecksLoading: sessionMetadata.linkedPr.isChecksLoading,
							hasResolvedChecks: sessionMetadata.linkedPr.hasResolvedChecks,
						}
					: buildPartialSessionLinkedPr(prNumber, sessionMetadata.prState);
		const nextPrState =
			prNumber == null ? undefined : nextLinkedPr ? nextLinkedPr.state : sessionMetadata.prState;

		this.#deps.updateSession(
			sessionId,
			{
				prNumber: prNumber ?? undefined,
				prState: nextPrState,
				prLinkMode,
				linkedPr: nextLinkedPr,
			},
			{ touchUpdatedAt: false }
		);

		if (prNumber != null) {
			this.setLinkedPrLoading(projectPath, prNumber, true);
			void this.refreshSessionPrState(sessionId, projectPath, prNumber);
		}

		return tauriClient.history.setSessionPrNumber(sessionId, prNumber, prLinkMode);
	}

	restoreAutomaticSessionPrLink(sessionId: string, projectPath: string): ResultAsync<void, AppError> {
		return this.updateSessionPrLink(sessionId, projectPath, null, "automatic");
	}

	applyAutomaticPrLinkFromShipWorkflow(
		sessionId: string,
		projectPath: string,
		pr: GitStackedPrStep
	): ResultAsync<number | null, never> {
		const nextSequence = (this.prLinkUpdateSequence.get(sessionId) ?? 0) + 1;
		this.prLinkUpdateSequence.set(sessionId, nextSequence);

		return resolveAutomaticSessionPrNumberFromShipWorkflow(projectPath, pr).andThen((prNumber) => {
			if (this.prLinkUpdateSequence.get(sessionId) !== nextSequence) {
				return okAsync<number | null, never>(null);
			}

			if (prNumber == null) {
				return okAsync<number | null, never>(null);
			}

			const sessionMetadata = this.#deps.getSessionMetadata(sessionId);
			if (!sessionMetadata || sessionMetadata.prLinkMode === "manual") {
				return okAsync<number | null, never>(null);
			}

			return this.updateSessionPrLink(sessionId, projectPath, prNumber, "automatic")
				.map(() => prNumber)
				.orElse(() => okAsync<number | null, never>(null));
		});
	}

	invalidatePrDetails(projectPath: string, prNumber: number): void {
		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		this.prDetailsCache.delete(cacheKey);
	}

	invalidatePrChecks(projectPath: string, prNumber: number): void {
		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		this.prChecksCache.delete(cacheKey);
	}

	registerVisiblePrChecksSurface(
		projectPath: string,
		prNumber: number,
		surfaceId: string
	): () => void {
		if (prNumber <= 0 || surfaceId.trim().length === 0) {
			return () => {};
		}

		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		const currentSurfaces = this.prChecksVisibleSurfaces.get(cacheKey) ?? new Set<string>();
		currentSurfaces.add(surfaceId);
		this.prChecksVisibleSurfaces.set(cacheKey, currentSurfaces);
		this.ensurePrChecksPolling(projectPath, prNumber);

		return () => {
			const nextSurfaces = this.prChecksVisibleSurfaces.get(cacheKey);
			if (!nextSurfaces) {
				return;
			}
			nextSurfaces.delete(surfaceId);
			if (nextSurfaces.size === 0) {
				this.prChecksVisibleSurfaces.delete(cacheKey);
				this.stopPrChecksPolling(cacheKey);
				return;
			}
			this.prChecksVisibleSurfaces.set(cacheKey, nextSurfaces);
		};
	}

	refreshSessionPrChecks(
		sessionId: string,
		projectPath: string,
		prNumber: number,
		options?: { force?: boolean }
	): ResultAsync<PrChecks | null, never> {
		if (prNumber <= 0) {
			return okAsync<PrChecks | null, never>(null);
		}

		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		const cachedChecks = options?.force ? null : this.getFreshCachedPrChecks(cacheKey);
		if (cachedChecks) {
			this.applyPrChecksToSessions(projectPath, prNumber, cachedChecks);
			this.updatePrChecksPollingState(projectPath, prNumber, cachedChecks);
			return okAsync<PrChecks | null, never>(cachedChecks);
		}

		this.setLinkedPrChecksLoading(projectPath, prNumber, true);

		const inflightRequest = this.prChecksInflight.get(cacheKey);
		if (inflightRequest) {
			return inflightRequest;
		}

		const request = tauriClient.git
			.prChecks(projectPath, prNumber)
			.map((checks): PrChecks | null => {
				this.prChecksCache.set(cacheKey, {
					checks,
					fetchedAt: Date.now(),
				});
				this.prChecksInflight.delete(cacheKey);
				this.applyPrChecksToSessions(projectPath, prNumber, checks);
				this.updatePrChecksPollingState(projectPath, prNumber, checks);
				return checks;
			})
			.orElse((err) => {
				this.prChecksInflight.delete(cacheKey);
				logger.warn("Failed to fetch PR checks", {
					sessionId,
					prNumber,
					error: err.message,
				});
				this.setLinkedPrChecksLoading(projectPath, prNumber, false);
				this.updatePrChecksPollingState(projectPath, prNumber, null);
				return okAsync<PrChecks | null, never>(null);
			});

		this.prChecksInflight.set(cacheKey, request);
		return request;
	}

	refreshSessionPrState(
		sessionId: string,
		projectPath: string,
		prNumber: number
	): ResultAsync<PrDetails | null, never> {
		if (prNumber <= 0) {
			return okAsync<PrDetails | null, never>(null);
		}

		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		const cachedDetails = this.getFreshCachedPrDetails(cacheKey);
		if (cachedDetails) {
			this.applyPrDetailsToSessions(projectPath, prNumber, cachedDetails);
			return okAsync<PrDetails | null, never>(cachedDetails);
		}

		this.setLinkedPrLoading(projectPath, prNumber, true);

		const inflightRequest = this.prDetailsInflight.get(cacheKey);
		if (inflightRequest) {
			return inflightRequest;
		}

		logger.debug("refreshSessionPrState: calling prDetails", { sessionId, projectPath, prNumber });
		const request = tauriClient.git
			.prDetails(projectPath, prNumber)
			.map((details): PrDetails | null => {
				this.prDetailsCache.set(cacheKey, {
					details,
					fetchedAt: Date.now(),
				});
				this.prDetailsInflight.delete(cacheKey);
				logger.info("refreshSessionPrState: got details", {
					sessionId,
					detailsState: details.state,
				});
				this.applyPrDetailsToSessions(projectPath, prNumber, details);
				return details;
			})
			.orElse((err) => {
				this.prDetailsInflight.delete(cacheKey);
				logger.warn("Failed to fetch PR details", {
					sessionId,
					prNumber,
					error: err.message,
				});
				this.setLinkedPrLoading(projectPath, prNumber, false);
				return okAsync<PrDetails | null, never>(null);
			});

		this.prDetailsInflight.set(cacheKey, request);
		return request;
	}

	refreshAllPrStates(): void {
		const sessions = this.#deps.getSessions();
		for (const session of sessions) {
			const sessionIdentity = this.#deps.getSessionIdentity(session.id);
			const sessionMetadata = this.#deps.getSessionMetadata(session.id);
			if (!sessionIdentity || !sessionMetadata) {
				continue;
			}
			const prNumber = sessionMetadata.prNumber;
			if (prNumber == null) {
				continue;
			}
			void this.refreshSessionPrState(sessionIdentity.id, sessionIdentity.projectPath, prNumber);
		}
	}

	private ensurePrChecksPolling(projectPath: string, prNumber: number): void {
		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		if ((this.prChecksVisibleSurfaces.get(cacheKey)?.size ?? 0) === 0) {
			return;
		}
		if (this.prChecksPollTimers.has(cacheKey)) {
			return;
		}
		void this.refreshSessionPrChecks(cacheKey, projectPath, prNumber, { force: true });
	}

	private schedulePrChecksPoll(projectPath: string, prNumber: number): void {
		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		this.stopPrChecksPolling(cacheKey);
		if ((this.prChecksVisibleSurfaces.get(cacheKey)?.size ?? 0) === 0) {
			return;
		}
		const timerId = setTimeout(() => {
			this.prChecksPollTimers.delete(cacheKey);
			void this.refreshSessionPrChecks(cacheKey, projectPath, prNumber, { force: true });
		}, PR_CHECKS_POLL_INTERVAL_MS);
		this.prChecksPollTimers.set(cacheKey, timerId);
	}

	private stopPrChecksPolling(cacheKey: string): void {
		const timerId = this.prChecksPollTimers.get(cacheKey);
		if (timerId != null) {
			clearTimeout(timerId);
			this.prChecksPollTimers.delete(cacheKey);
		}
	}

	private updatePrChecksPollingState(
		projectPath: string,
		prNumber: number,
		checks: PrChecks | null
	): void {
		const cacheKey = this.getPrDetailsCacheKey(projectPath, prNumber);
		if ((this.prChecksVisibleSurfaces.get(cacheKey)?.size ?? 0) === 0) {
			this.stopPrChecksPolling(cacheKey);
			return;
		}

		const shouldContinuePolling =
			checks === null ||
			checks.checkRuns.length === 0 ||
			hasActivePrChecks(
				checks.checkRuns.map((checkRun) => ({
					name: checkRun.name,
					status: checkRun.status,
					conclusion: checkRun.conclusion,
					detailsUrl: checkRun.detailsUrl,
					startedAt: checkRun.startedAt,
					completedAt: checkRun.completedAt,
					workflowName: checkRun.workflowName,
				}))
			);

		if (shouldContinuePolling) {
			this.schedulePrChecksPoll(projectPath, prNumber);
			return;
		}

		this.stopPrChecksPolling(cacheKey);
	}

	private getPrDetailsCacheKey(projectPath: string, prNumber: number): string {
		return `${projectPath}::${prNumber}`;
	}

	private getFreshCachedPrDetails(cacheKey: string): PrDetails | null {
		const cachedEntry = this.prDetailsCache.get(cacheKey);
		if (!cachedEntry) {
			return null;
		}

		if (Date.now() - cachedEntry.fetchedAt > PR_STATE_CACHE_TTL_MS) {
			this.prDetailsCache.delete(cacheKey);
			return null;
		}

		return cachedEntry.details;
	}

	private getFreshCachedPrChecks(cacheKey: string): PrChecks | null {
		const cachedEntry = this.prChecksCache.get(cacheKey);
		if (!cachedEntry) {
			return null;
		}

		if (Date.now() - cachedEntry.fetchedAt > PR_CHECKS_CACHE_TTL_MS) {
			this.prChecksCache.delete(cacheKey);
			return null;
		}

		return cachedEntry.checks;
	}

	private getSessionPrLinkRefs(projectPath: string, prNumber: number): SessionPrLinkRef[] {
		const sessions = this.#deps.getSessionsByProject(projectPath) ?? [];
		const refs: SessionPrLinkRef[] = [];
		for (const session of sessions) {
			const sessionIdentity = this.#deps.getSessionIdentity(session.id);
			const sessionMetadata = this.#deps.getSessionMetadata(session.id);
			if (!sessionIdentity || !sessionMetadata) {
				continue;
			}
			if (sessionMetadata.prNumber !== prNumber) {
				continue;
			}
			refs.push({
				sessionId: sessionIdentity.id,
				projectPath: sessionIdentity.projectPath,
				prNumber: sessionMetadata.prNumber,
				prState: sessionMetadata.prState,
				linkedPr: sessionMetadata.linkedPr,
			});
		}
		return refs;
	}

	private applyPrDetailsToSessions(projectPath: string, prNumber: number, details: PrDetails): void {
		const matchingSessions = this.getSessionPrLinkRefs(projectPath, prNumber);

		if (matchingSessions.length === 0) {
			logger.warn("refreshSessionPrState: session not found", { projectPath, prNumber });
			return;
		}

		for (const session of matchingSessions) {
			const resolvedLinkedPr = buildResolvedSessionLinkedPr(details);
			const nextLinkedPr = {
				prNumber: resolvedLinkedPr.prNumber,
				state: resolvedLinkedPr.state,
				url: resolvedLinkedPr.url,
				title: resolvedLinkedPr.title,
				additions: resolvedLinkedPr.additions,
				deletions: resolvedLinkedPr.deletions,
				isDraft: resolvedLinkedPr.isDraft,
				isLoading: resolvedLinkedPr.isLoading,
				hasResolvedDetails: resolvedLinkedPr.hasResolvedDetails,
				checksHeadSha: session.linkedPr?.checksHeadSha ?? resolvedLinkedPr.checksHeadSha,
				checks: session.linkedPr?.checks ?? resolvedLinkedPr.checks,
				isChecksLoading: session.linkedPr?.isChecksLoading ?? resolvedLinkedPr.isChecksLoading,
				hasResolvedChecks:
					session.linkedPr?.hasResolvedChecks ?? resolvedLinkedPr.hasResolvedChecks,
			};
			const linkedPrChanged =
				session.linkedPr?.state !== nextLinkedPr.state ||
				session.linkedPr?.url !== nextLinkedPr.url ||
				session.linkedPr?.title !== nextLinkedPr.title ||
				session.linkedPr?.additions !== nextLinkedPr.additions ||
				session.linkedPr?.deletions !== nextLinkedPr.deletions ||
				session.linkedPr?.isDraft !== nextLinkedPr.isDraft ||
				session.linkedPr?.isLoading !== nextLinkedPr.isLoading ||
				session.linkedPr?.hasResolvedDetails !== nextLinkedPr.hasResolvedDetails ||
				session.linkedPr?.checksHeadSha !== nextLinkedPr.checksHeadSha ||
				session.linkedPr?.isChecksLoading !== nextLinkedPr.isChecksLoading ||
				session.linkedPr?.hasResolvedChecks !== nextLinkedPr.hasResolvedChecks ||
				JSON.stringify(session.linkedPr?.checks ?? []) !== JSON.stringify(nextLinkedPr.checks);

			if (details.state !== session.prState || linkedPrChanged) {
				logger.info("refreshSessionPrState: updating session linked PR", {
					sessionId: session.sessionId,
					oldState: session.prState,
					newState: details.state,
				});
				this.#deps.updateSession(
					session.sessionId,
					{
						prState: details.state,
						linkedPr: nextLinkedPr,
					},
					{ touchUpdatedAt: false }
				);
			}
		}
	}

	private applyPrChecksToSessions(
		projectPath: string,
		prNumber: number,
		checks: PrChecks
	): void {
		const matchingSessions = this.getSessionPrLinkRefs(projectPath, prNumber);

		for (const session of matchingSessions) {
			const nextChecks = buildResolvedSessionPrChecks(checks);
			const linkedPr = session.linkedPr ?? buildPartialSessionLinkedPr(prNumber, session.prState);
			const checksChanged =
				session.linkedPr?.checksHeadSha !== nextChecks.checksHeadSha ||
				session.linkedPr?.isChecksLoading !== nextChecks.isChecksLoading ||
				session.linkedPr?.hasResolvedChecks !== nextChecks.hasResolvedChecks ||
				JSON.stringify(session.linkedPr?.checks ?? []) !== JSON.stringify(nextChecks.checks);

			if (!checksChanged) {
				continue;
			}

			this.#deps.updateSession(
				session.sessionId,
				{
					linkedPr: {
						prNumber: linkedPr.prNumber,
						state: linkedPr.state,
						url: linkedPr.url,
						title: linkedPr.title,
						additions: linkedPr.additions,
						deletions: linkedPr.deletions,
						isDraft: linkedPr.isDraft,
						isLoading: linkedPr.isLoading,
						hasResolvedDetails: linkedPr.hasResolvedDetails,
						checksHeadSha: nextChecks.checksHeadSha,
						checks: nextChecks.checks,
						isChecksLoading: nextChecks.isChecksLoading,
						hasResolvedChecks: nextChecks.hasResolvedChecks,
					},
				},
				{ touchUpdatedAt: false }
			);
		}
	}

	private setLinkedPrLoading(projectPath: string, prNumber: number, isLoading: boolean): void {
		const matchingSessions = this.getSessionPrLinkRefs(projectPath, prNumber);

		for (const session of matchingSessions) {
			const nextLinkedPr = session.linkedPr
				? {
						prNumber: session.linkedPr.prNumber,
						state: session.linkedPr.state,
						url: session.linkedPr.url,
						title: session.linkedPr.title,
						additions: session.linkedPr.additions,
						deletions: session.linkedPr.deletions,
						isDraft: session.linkedPr.isDraft,
						isLoading,
						hasResolvedDetails: session.linkedPr.hasResolvedDetails,
						checksHeadSha: session.linkedPr.checksHeadSha,
						checks: session.linkedPr.checks,
						isChecksLoading: session.linkedPr.isChecksLoading,
						hasResolvedChecks: session.linkedPr.hasResolvedChecks,
					}
				: {
						prNumber,
						state: session.prState ?? "OPEN",
						url: null,
						title: null,
						additions: null,
						deletions: null,
						isDraft: null,
						isLoading,
						hasResolvedDetails: false,
						checksHeadSha: null,
						checks: [],
						isChecksLoading: true,
						hasResolvedChecks: false,
					};

			if (
				session.linkedPr?.isLoading === nextLinkedPr.isLoading &&
				session.linkedPr?.hasResolvedDetails === nextLinkedPr.hasResolvedDetails
			) {
				continue;
			}

			this.#deps.updateSession(session.sessionId, { linkedPr: nextLinkedPr }, { touchUpdatedAt: false });
		}
	}

	private setLinkedPrChecksLoading(
		projectPath: string,
		prNumber: number,
		isChecksLoading: boolean
	): void {
		const matchingSessions = this.getSessionPrLinkRefs(projectPath, prNumber);

		for (const session of matchingSessions) {
			const linkedPr = session.linkedPr ?? buildPartialSessionLinkedPr(prNumber, session.prState);
			const nextLinkedPr = {
				prNumber: linkedPr.prNumber,
				state: linkedPr.state,
				url: linkedPr.url,
				title: linkedPr.title,
				additions: linkedPr.additions,
				deletions: linkedPr.deletions,
				isDraft: linkedPr.isDraft,
				isLoading: linkedPr.isLoading,
				hasResolvedDetails: linkedPr.hasResolvedDetails,
				checksHeadSha: linkedPr.checksHeadSha,
				checks: linkedPr.checks,
				isChecksLoading,
				hasResolvedChecks: linkedPr.hasResolvedChecks,
			};

			if (
				session.linkedPr?.isChecksLoading === nextLinkedPr.isChecksLoading &&
				session.linkedPr?.hasResolvedChecks === nextLinkedPr.hasResolvedChecks
			) {
				continue;
			}

			this.#deps.updateSession(session.sessionId, { linkedPr: nextLinkedPr }, { touchUpdatedAt: false });
		}
	}
}
