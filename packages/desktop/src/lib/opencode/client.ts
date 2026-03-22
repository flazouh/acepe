import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

import type { Provider, ProviderConfigResponse } from "./types/index.js";

class OpencodeService {
	private client: OpencodeClient;
	private baseUrl: string;
	private currentDirectory: string | undefined;

	constructor(baseUrl = "/api") {
		this.baseUrl = baseUrl;
		this.client = createOpencodeClient({ baseUrl });
	}

	setDirectory(directory: string | undefined): void {
		this.currentDirectory = directory;
	}

	getDirectory(): string | undefined {
		return this.currentDirectory;
	}

	getProviders(): ResultAsync<ProviderConfigResponse, Error> {
		return ResultAsync.fromPromise(
			this.client.config.providers(
				this.currentDirectory ? { directory: this.currentDirectory } : undefined
			),
			(e) => new Error(`Failed to fetch providers: ${e}`)
		).andThen((response) => {
			if (!response.data) {
				return errAsync(new Error("No provider data received"));
			}

			// Transform models from Record to Array for easier iteration
			const providers: Provider[] = response.data.providers.map((p) => ({
				...p,
				models: Object.values(p.models || {}),
			}));

			return okAsync({
				providers,
				default: response.data.default,
			});
		});
	}

	checkHealth(): ResultAsync<boolean, Error> {
		const healthUrl = new URL(
			"health",
			new URL(this.baseUrl, globalThis.location?.origin || "http://localhost")
		).href;
		return ResultAsync.fromPromise(
			fetch(healthUrl).then((r) => r.ok),
			(e) => new Error(`Health check failed: ${e}`)
		);
	}
}

// Singleton instance
export const opencodeClient = new OpencodeService();
