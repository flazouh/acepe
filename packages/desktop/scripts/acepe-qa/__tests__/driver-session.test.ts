import { describe, expect, it } from "bun:test";
import {
	type DriverSessionManager,
	ensureDriverSession,
	localIpv4BridgeHosts,
	parseDriverSessionIdentity,
} from "../driver-session";

describe("acepe-qa driver session", () => {
	it("retries the bridge port through a local non-loopback address when localhost is occupied", async () => {
		const calls: Array<{ readonly host: string | undefined; readonly port: number }> = [];
		const manager: DriverSessionManager = {
			manageDriverSession: (action, host, port) => {
				if (action === "status") {
					return Promise.resolve(
						JSON.stringify({
							connected: true,
							identifier: "com.acepe.app",
							port: 9223,
						})
					);
				}
				calls.push({ host, port: port ?? 9223 });
				return Promise.resolve(
					host === "192.168.20.153"
						? "Session started with app: Acepe"
						: "Session start failed - no Tauri app found at localhost or localhost:9223"
				);
			},
		};

		const result = await ensureDriverSession(manager, "9223", {
			lo0: [
				{
					address: "127.0.0.1",
					cidr: "127.0.0.1/8",
					netmask: "255.0.0.0",
					family: "IPv4",
					mac: "00:00:00:00:00:00",
					internal: true,
				},
			],
			en0: [
				{
					address: "192.168.20.153",
					cidr: "192.168.20.153/24",
					netmask: "255.255.255.0",
					family: "IPv4",
					mac: "00:00:00:00:00:01",
					internal: false,
				},
			],
		});

		expect(result).toBe("Session started with app: Acepe");
		expect(calls).toEqual([
			{ host: undefined, port: 9223 },
			{ host: "192.168.20.153", port: 9223 },
		]);
	});

	it("parses the expected app identity from single and multi-app session status", () => {
		expect(
			parseDriverSessionIdentity(
				JSON.stringify({
					connected: true,
					identifier: "com.acepe.app",
					port: 9223,
				}),
				9223
			)
		).toEqual({ identifier: "com.acepe.app", port: 9223 });
		expect(
			parseDriverSessionIdentity(
				JSON.stringify({
					connected: true,
					apps: [
						{ identifier: "dev.other", port: 9224 },
						{ identifier: "com.acepe.app", port: 9223 },
					],
				}),
				9223
			)
		).toEqual({ identifier: "com.acepe.app", port: 9223 });
	});

	it("does not retry another host after a session starts with the wrong app identity", async () => {
		const startHosts: Array<string | undefined> = [];
		const manager: DriverSessionManager = {
			manageDriverSession: (action, host) => {
				if (action === "status") {
					return Promise.resolve(
						JSON.stringify({ connected: true, identifier: "dev.other", port: 9223 })
					);
				}
				startHosts.push(host);
				return Promise.resolve("Session started with app: Other");
			},
		};

		expect(
			ensureDriverSession(manager, "9223", {
				en0: [
					{
						address: "192.168.20.153",
						cidr: "192.168.20.153/24",
						netmask: "255.255.255.0",
						family: "IPv4",
						mac: "00:00:00:00:00:01",
						internal: false,
					},
				],
			})
		).rejects.toThrow("is not com.acepe.app");
		expect(startHosts).toEqual([undefined]);
	});

	it("returns only distinct non-loopback IPv4 bridge hosts", () => {
		expect(
			localIpv4BridgeHosts({
				lo0: [
					{
						address: "127.0.0.1",
						cidr: "127.0.0.1/8",
						netmask: "255.0.0.0",
						family: "IPv4",
						mac: "00:00:00:00:00:00",
						internal: true,
					},
				],
				en0: [
					{
						address: "192.168.20.153",
						cidr: "192.168.20.153/24",
						netmask: "255.255.255.0",
						family: "IPv4",
						mac: "00:00:00:00:00:01",
						internal: false,
					},
				],
				bridge0: [
					{
						address: "192.168.20.153",
						cidr: "192.168.20.153/24",
						netmask: "255.255.255.0",
						family: "IPv4",
						mac: "00:00:00:00:00:02",
						internal: false,
					},
				],
				utun0: [
					{
						address: "fe80::1",
						cidr: "fe80::1/64",
						netmask: "ffff:ffff:ffff:ffff::",
						family: "IPv6",
						mac: "00:00:00:00:00:03",
						internal: false,
						scopeid: 1,
					},
				],
			})
		).toEqual(["192.168.20.153"]);
	});
});
