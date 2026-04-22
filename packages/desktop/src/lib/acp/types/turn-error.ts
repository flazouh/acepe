import type { TurnErrorInfo, TurnErrorSource } from "../../services/converted-session-types.js";
import type { SessionUpdate } from "./session-update.js";

export type TurnFailureKind = TurnErrorInfo["kind"];
export type TurnErrorUpdate = Extract<SessionUpdate, { type: "turnError" }>;
export type TurnCompleteUpdate = Extract<SessionUpdate, { type: "turnComplete" }>;
export type TurnErrorPayload = TurnErrorUpdate["error"] | TurnErrorInfo;

export interface ActiveTurnFailure {
	readonly turnId: string | null;
	readonly message: string;
	readonly code: string | null;
	readonly kind: TurnFailureKind;
	readonly source: TurnErrorSource;
}

export function normalizeTurnError(error: TurnErrorPayload): TurnErrorInfo {
	if (typeof error === "string") {
		return {
			message: error,
			kind: "recoverable",
			source: "unknown",
		};
	}

	return error;
}

export function normalizeActiveTurnFailure(update: TurnErrorUpdate): ActiveTurnFailure {
	const error = normalizeTurnError(update.error);

	return {
		turnId: update.turn_id ?? null,
		message: error.message,
		code: error.code != null ? String(error.code) : null,
		kind: error.kind,
		source: error.source ?? "unknown",
	};
}
