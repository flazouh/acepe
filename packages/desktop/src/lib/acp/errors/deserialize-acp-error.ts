import type { AcpError } from "./acp-error.js";
import { ConnectionError } from "./connection-error.js";
import { ProtocolError } from "./protocol-error.js";
import {
	parseSerializableAcpError,
	type SerializableAcpError,
} from "./serializable-acp-error.schema.js";
import { SessionError } from "./session-error.js";

/**
 * Converts a serializable ACP error from the backend into an appropriate AcpError subclass.
 *
 * @param serializableError - The structured error from the backend (validated via Zod)
 * @returns An appropriate AcpError subclass
 */
export function deserializeAcpError(serializableError: SerializableAcpError): AcpError {
	switch (serializableError.type) {
		case "agent_not_found":
			return new ConnectionError(`Agent not found: ${serializableError.data.agent_id}`);

		case "no_provider_configured":
			return new ConnectionError("No agent provider configured");

		case "session_not_found":
			return new SessionError(`Session not found: ${serializableError.data.session_id}`);

		case "client_not_started":
			return new ConnectionError("Client not started");

		case "opencode_server_not_running":
			return new ConnectionError("OpenCode server not running");

		case "subprocess_spawn_failed":
			return new ConnectionError(
				`Failed to spawn subprocess '${serializableError.data.command}': ${serializableError.data.error}`
			);

		case "json_rpc_error":
			return new ProtocolError(serializableError.data.message);

		case "protocol_error":
			return new ProtocolError(serializableError.data.message);

		case "http_error":
			return new ConnectionError(`HTTP request failed: ${serializableError.data.message}`);

		case "serialization_error":
			return new ProtocolError(`Serialization error: ${serializableError.data.message}`);

		case "channel_closed":
			return new ConnectionError("Channel closed unexpectedly");

		case "timeout":
			return new ConnectionError(`Operation timed out: ${serializableError.data.operation}`);

		case "invalid_state":
			return new ProtocolError(`Invalid state: ${serializableError.data.message}`);

		default:
			// Fallback for unknown error types
			return new ConnectionError(`Unknown error: ${JSON.stringify(serializableError)}`);
	}
}

/**
 * Safely parses and deserializes an unknown error value into an AcpError.
 *
 * Uses Zod validation to check if the value is a valid SerializableAcpError,
 * then converts it to the appropriate AcpError subclass.
 *
 * @param error - The unknown error value to parse and deserialize
 * @returns An AcpError if parsing succeeds, null if the value is not a valid SerializableAcpError
 */
export function tryDeserializeAcpError(error: unknown): AcpError | null {
	const parsed = parseSerializableAcpError(error);
	if (parsed === null) {
		return null;
	}
	return deserializeAcpError(parsed);
}
