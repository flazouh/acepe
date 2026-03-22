import type { TurnErrorInfo } from "../../services/converted-session-types.js";
import type { SessionUpdate } from "./session-update.js";

export type TurnFailureKind = TurnErrorInfo["kind"];

export type TurnErrorPayload =
	| Extract<SessionUpdate, { type: "turnError" }>["error"]
	| TurnErrorInfo;

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
