import type {
	CapabilityPreviewState,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionStateEnvelope,
	SessionStateGraph,
	TranscriptDelta,
	UsageTelemetryData,
} from "../../services/acp-types.js";
import { resolveSessionStateDelta, type SessionStateDeltaResolution } from "./session-state-query-service.js";

export type SessionStateCommand =
	| {
			kind: "replaceGraph";
			graph: SessionStateGraph;
	  }
	| {
			kind: "applyLifecycle";
			lifecycle: SessionGraphLifecycle;
	  }
	| {
			kind: "applyCapabilities";
			capabilities: SessionGraphCapabilities;
			revision: SessionGraphRevision;
			pendingMutationId: string | null;
			previewState: CapabilityPreviewState;
	  }
	| {
			kind: "applyTelemetry";
			telemetry: UsageTelemetryData;
	  }
	| {
			kind: "refreshSnapshot";
			fromRevision: number;
			toRevision: number;
	  }
	| {
			kind: "applyTranscriptDelta";
			delta: TranscriptDelta;
	  };

function commandFromDeltaResolution(resolution: SessionStateDeltaResolution): SessionStateCommand[] {
	switch (resolution.kind) {
		case "refreshSnapshot":
			return [
				{
					kind: "refreshSnapshot",
					fromRevision: resolution.fromRevision,
					toRevision: resolution.toRevision,
				},
			];
		case "applyTranscriptDelta":
			return [
				{
					kind: "applyTranscriptDelta",
					delta: resolution.delta,
				},
			];
		case "noop":
			return [];
	}
}

export function routeSessionStateEnvelope(
	sessionId: string,
	currentTranscriptRevision: number | undefined,
	envelope: SessionStateEnvelope
): SessionStateCommand[] {
	switch (envelope.payload.kind) {
		case "snapshot":
			return [
				{
					kind: "replaceGraph",
					graph: envelope.payload.graph,
				},
			];
		case "lifecycle":
			return [
				{
					kind: "applyLifecycle",
					lifecycle: envelope.payload.lifecycle,
				},
			];
		case "capabilities":
			return [
				{
					kind: "applyCapabilities",
					capabilities: envelope.payload.capabilities,
					revision: envelope.payload.revision,
					pendingMutationId: envelope.payload.pendingMutationId ?? null,
					previewState: envelope.payload.previewState,
				},
			];
		case "telemetry":
			return [
				{
					kind: "applyTelemetry",
					telemetry: envelope.payload.telemetry,
				},
			];
		case "delta":
			return commandFromDeltaResolution(
				resolveSessionStateDelta(sessionId, currentTranscriptRevision, envelope.payload.delta)
			);
	}
}
