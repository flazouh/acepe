declare module "electrobun/view" {
	export class Electroview {
		static defineRPC(input: {
			readonly handlers: {
				readonly requests: Record<string, never>;
				readonly messages: Record<string, never>;
			};
		}): unknown;
		constructor(input: { readonly rpc: unknown });
		readonly rpc: {
			readonly request: {
				readonly ping: (params: unknown) => Promise<unknown>;
				readonly dispatch: (params: unknown) => Promise<unknown>;
				readonly snapshot: (params: unknown) => Promise<unknown>;
				readonly events: (params: unknown) => Promise<unknown>;
				readonly getProjectIndex: (params: unknown) => Promise<unknown>;
				readonly invalidateProjectIndex: (params: unknown) => Promise<unknown>;
			};
			readonly addMessageListener: (
				message: "events",
				listener: (payload: unknown) => void,
			) => void;
			readonly removeMessageListener: (
				message: "events",
				listener: (payload: unknown) => void,
			) => void;
		};
	}
}
