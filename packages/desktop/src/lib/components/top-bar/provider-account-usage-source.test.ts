import { describe, expect, test } from "bun:test";

import {
	buildProviderUsageCheckingAccounts,
	buildProviderUsageErrorAccounts,
	mapProviderAccountUsageToAccounts,
} from "./provider-account-usage-source.js";

describe("provider account usage source", () => {
	test("maps native Codex account usage to widget accounts", () => {
		const accounts = mapProviderAccountUsageToAccounts([
			{
				providerId: "codex",
				displayName: "Codex",
				plan: "pro",
				capturedAtMs: 1_782_212_400_000,
				connection: "connected",
				windows: [
					{
						id: "primary",
						label: "5h window",
						role: "primaryShort",
						usedFraction: 0.25,
						windowMinutes: 300,
						resetsAtMs: 1_782_253_000_000,
					},
					{
						id: "secondary",
						label: "Weekly window",
						role: "weekly",
						usedFraction: 0.81,
						windowMinutes: 10_080,
						resetsAtMs: 1_782_821_000_000,
					},
				],
				message: null,
			},
			{
				providerId: "cursor",
				displayName: "Cursor",
				plan: null,
				capturedAtMs: 1_782_212_400_000,
				connection: "unavailable",
				windows: [],
				message: "Cursor quota needs the Cursor account API",
			},
		]);

		expect(accounts).toHaveLength(2);
		expect(accounts[0]?.providerId).toBe("codex");
		expect(accounts[0]?.connectionState).toBe("connected");
		expect(accounts[0]?.planLabel).toBe("pro");
		expect(accounts[0]?.statusLabel).toBe("Connected");
		expect(accounts[0]?.quotaMetrics).toHaveLength(2);
		expect(accounts[0]?.quotaMetrics[0]?.role).toBe("primary-short");
		expect(accounts[0]?.quotaMetrics[0]?.used).toBe(25);
		expect(accounts[0]?.quotaMetrics[0]?.usedLabel).toBe("25% used");
		expect(accounts[0]?.quotaMetrics[0]?.leftLabel).toBe("75% left");
		expect(accounts[1]?.connectionState).toBe("unavailable");
		expect(accounts[1]?.textMetrics).toHaveLength(0);
	});

	test("builds honest transient states without fake quota numbers", () => {
		const checking = buildProviderUsageCheckingAccounts();
		const error = buildProviderUsageErrorAccounts();

		expect(checking).toHaveLength(3);
		expect(checking[0]?.quotaMetrics).toHaveLength(0);
		expect(checking[0]?.textMetrics[0]?.value).toBe("Checking usage");
		expect(error[0]?.textMetrics[0]?.value).toBe("Usage unavailable");
	});
});
