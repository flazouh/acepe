/**
 * CapabilityProjectionReader — the read-only capability slice of the session
 * store, extracted as a composed sub-service (see docs/adr/0002). Projects the
 * canonical per-session capability state (models/modes/commands/config/provider
 * metadata + autonomous + revision + mutation preview) for consumers. Owns no
 * state: reads canonical projection, the materialized flag, identity, and
 * transient mutation state through injected accessor closures.
 *
 * GOD-safe — consumes canonical facts only. No `canonical ?? hot` fallback, no
 * provider branching, no dual-write. Capability writes stay on the canonical
 * envelope path in SessionStore.
 */
import type {
	ConfigOptionData as CanonicalConfigOptionData,
	SessionGraphRevision,
} from "../../services/acp-types.js";
import type {
	ModelsForDisplay,
	ProviderMetadataProjection,
} from "../../services/acp-provider-metadata.js";
import type { AvailableCommand } from "../types/available-command.js";
import type { CanonicalSessionProjection } from "./canonical-session-projection.js";
import type { Mode, Model, SessionCapabilities, SessionIdentity, SessionTransientProjection } from "./types.js";
import {
	deriveCapabilityPreviewState,
	projectGraphCapabilities,
	type ProjectedGraphCapabilities,
} from "./capability-projection.js";

export interface CapabilityProjectionDeps {
	readonly getCanonicalProjection: (sessionId: string) => CanonicalSessionProjection | null;
	readonly getSessionIdentity: (sessionId: string) => SessionIdentity | undefined;
	readonly isCapabilitiesMaterialized: (sessionId: string) => boolean;
	readonly getTransientProjection: (sessionId: string) => SessionTransientProjection;
}

export class CapabilityProjectionReader {
	constructor(private readonly deps: CapabilityProjectionDeps) {}

	private getProjectedCapabilities(sessionId: string): ProjectedGraphCapabilities | null {
		const projection = this.deps.getCanonicalProjection(sessionId);
		const sessionIdentity = this.deps.getSessionIdentity(sessionId);
		if (
			projection === null ||
			sessionIdentity === undefined ||
			this.deps.isCapabilitiesMaterialized(sessionId) !== true
		) {
			return null;
		}
		return projectGraphCapabilities(projection.capabilities);
	}

	hasCanonicalCapabilities(sessionId: string): boolean {
		return this.getProjectedCapabilities(sessionId) !== null;
	}

	/** Canonical autonomous setting; null means no canonical projection. */
	getAutonomousEnabled(sessionId: string): boolean | null {
		return this.deps.getCanonicalProjection(sessionId)?.capabilities.autonomousEnabled ?? null;
	}

	getCurrentModeId(sessionId: string): string | null {
		return this.getProjectedCapabilities(sessionId)?.currentModeId ?? null;
	}

	getCurrentModelId(sessionId: string): string | null {
		return this.getProjectedCapabilities(sessionId)?.currentModelId ?? null;
	}

	getAvailableCommands(sessionId: string): ReadonlyArray<AvailableCommand> | null {
		return this.getProjectedCapabilities(sessionId)?.availableCommands ?? null;
	}

	getConfigOptions(sessionId: string): ReadonlyArray<CanonicalConfigOptionData> | null {
		return this.getProjectedCapabilities(sessionId)?.configOptions ?? null;
	}

	getAvailableModels(sessionId: string): ReadonlyArray<Model> | null {
		return this.getProjectedCapabilities(sessionId)?.availableModels ?? null;
	}

	getAvailableModes(sessionId: string): ReadonlyArray<Mode> | null {
		return this.getProjectedCapabilities(sessionId)?.availableModes ?? null;
	}

	getModelsDisplay(sessionId: string): ModelsForDisplay | null {
		return this.getProjectedCapabilities(sessionId)?.modelsDisplay ?? null;
	}

	getProviderMetadata(sessionId: string): ProviderMetadataProjection | null {
		return this.getProjectedCapabilities(sessionId)?.providerMetadata ?? null;
	}

	getCapabilityRevision(sessionId: string): SessionGraphRevision | null {
		const projection = this.deps.getCanonicalProjection(sessionId);
		if (projection === null || this.getProjectedCapabilities(sessionId) === null) {
			return null;
		}
		return projection.revision;
	}

	getPendingMutationId(sessionId: string): string | null {
		if (this.getProjectedCapabilities(sessionId) === null) {
			return null;
		}
		const mutationState = this.deps.getTransientProjection(sessionId).capabilityMutationState ?? {
			pendingMutationId: null,
			previewState: null,
		};
		return mutationState.pendingMutationId;
	}

	getPreviewState(sessionId: string): SessionCapabilities["previewState"] | null {
		const projection = this.deps.getCanonicalProjection(sessionId);
		if (projection === null || this.getProjectedCapabilities(sessionId) === null) {
			return null;
		}
		const mutationState = this.deps.getTransientProjection(sessionId).capabilityMutationState ?? {
			pendingMutationId: null,
			previewState: null,
		};
		return mutationState.previewState ?? deriveCapabilityPreviewState(projection.capabilities);
	}
}
