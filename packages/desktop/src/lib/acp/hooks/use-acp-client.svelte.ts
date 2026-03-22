import { okAsync, type ResultAsync } from "neverthrow";

import { AcpClient } from "../logic/acp-client.js";

/**
 * Hook for accessing the ACP client.
 *
 * Provides a singleton instance of the ACP client and manages
 * initialization state.
 */
export class UseAcpClient {
	/**
	 * The ACP client instance.
	 */
	client = $state<AcpClient>(new AcpClient());

	/**
	 * Whether the client is initialized.
	 */
	isInitialized = $state(false);

	/**
	 * Current error, if any.
	 */
	error = $state<string | null>(null);

	/**
	 * Whether the client is currently loading.
	 */
	isLoading = $state(false);

	/**
	 * Initialize the ACP client.
	 *
	 * @returns ResultAsync that resolves when initialization is complete
	 */
	initialize(): ResultAsync<void, Error> {
		if (this.isInitialized) {
			return okAsync(undefined);
		}

		this.isLoading = true;
		this.error = null;

		return this.client
			.initialize()
			.map(() => {
				this.isInitialized = true;
				this.isLoading = false;
				this.error = null;
			})
			.mapErr((error) => {
				this.error = error.message;
				this.isLoading = false;
				return error;
			});
	}

	/**
	 * Reset the client state.
	 */
	reset(): void {
		this.isInitialized = false;
		this.error = null;
		this.isLoading = false;
		this.client = new AcpClient();
	}
}

/**
 * Creates a new ACP client hook instance.
 *
 * @returns A new UseAcpClient instance
 *
 * @example
 * ```typescript
 * const acpClient = useAcpClient();
 * await acpClient.initialize();
 * ```
 */
export function useAcpClient(): UseAcpClient {
	return new UseAcpClient();
}
