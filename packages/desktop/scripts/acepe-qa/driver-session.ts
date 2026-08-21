import { networkInterfaces } from "node:os";
import { decodeUnknown } from "@acepe/effect-result/decodeUnknown";
import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

const EXPECTED_APP_IDENTIFIER = "com.acepe.app";
const SESSION_START_FAILURE_TEXT = "Session start failed";

type NetworkInterfaces = ReturnType<typeof networkInterfaces>;

export type DriverSessionManager = {
	readonly manageDriverSession: (
		action: "start" | "stop" | "status",
		host?: string,
		port?: number,
		appIdentifier?: string | number
	) => Promise<string>;
};

const singleSessionStatusSchema = Schema.Struct({
	connected: Schema.Literal(true),
	identifier: Schema.NullOr(Schema.String),
	port: Schema.Number,
});

const multipleSessionStatusSchema = Schema.Struct({
	connected: Schema.Literal(true),
	apps: Schema.Array(
		Schema.Struct({
			identifier: Schema.NullOr(Schema.String),
			port: Schema.Number,
		})
	),
});

const decodeSingleSessionStatus = decodeUnknown(singleSessionStatusSchema, () => null);
const decodeMultipleSessionStatus = decodeUnknown(multipleSessionStatusSchema, () => null);

const parseStatusJson = fromThrowable(
	(input: string) => JSON.parse(input) as object,
	() => null
);

export function localIpv4BridgeHosts(
	interfaces: NetworkInterfaces = networkInterfaces()
): readonly string[] {
	const hosts: string[] = [];
	for (const interfaceEntries of Object.values(interfaces)) {
		for (const entry of interfaceEntries ?? []) {
			if (entry.internal || entry.family !== "IPv4" || hosts.includes(entry.address)) {
				continue;
			}
			hosts.push(entry.address);
		}
	}
	return hosts;
}

export function isDriverSessionStartFailure(result: string): boolean {
	return result.includes(SESSION_START_FAILURE_TEXT);
}

export function parseDriverSessionIdentity(
	status: string,
	port: number
): { readonly identifier: string | null; readonly port: number } | null {
	const json = Effect.runSync(Effect.result(parseStatusJson(status)));
	if (Result.isFailure(json)) {
		return null;
	}
	const single = decodeSingleSessionStatus(json.success);
	if (Result.isSuccess(single)) {
		return single.success.port === port
			? { identifier: single.success.identifier, port: single.success.port }
			: null;
	}
	const multiple = decodeMultipleSessionStatus(json.success);
	if (Result.isFailure(multiple)) {
		return null;
	}
	const app = multiple.success.apps.find((candidate) => candidate.port === port);
	return app === undefined ? null : { identifier: app.identifier, port: app.port };
}

async function startAndVerify(
	manager: DriverSessionManager,
	port: number,
	host: string | undefined
): Promise<string | null> {
	const startResult = await manager.manageDriverSession("start", host, port, undefined);
	if (isDriverSessionStartFailure(startResult)) {
		return null;
	}
	const status = await manager.manageDriverSession("status", undefined, undefined, undefined);
	const identity = parseDriverSessionIdentity(status, port);
	if (identity?.identifier !== EXPECTED_APP_IDENTIFIER) {
		throw new Error(
			`Bridge port ${port.toString()} is not ${EXPECTED_APP_IDENTIFIER}; refusing to attach Acepe QA.`
		);
	}
	return startResult;
}

export async function ensureDriverSession(
	manager: DriverSessionManager,
	appIdentifier: string,
	interfaces: NetworkInterfaces = networkInterfaces()
): Promise<string> {
	const parsedPort = Number.parseInt(appIdentifier, 10);
	const port = Number.isFinite(parsedPort) ? parsedPort : 9223;
	const localhostResult = await startAndVerify(manager, port, undefined);
	if (localhostResult !== null) {
		return localhostResult;
	}

	for (const host of localIpv4BridgeHosts(interfaces)) {
		const hostResult = await startAndVerify(manager, port, host);
		if (hostResult !== null) {
			return hostResult;
		}
	}

	throw new Error(
		`Unable to attach Acepe QA to ${EXPECTED_APP_IDENTIFIER} on bridge port ${port.toString()}.`
	);
}
