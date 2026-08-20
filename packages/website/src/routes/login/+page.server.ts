import { redirect } from "@sveltejs/kit";
import { getFeatureFlags } from "$lib/server/feature-flags";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
	const result = await Effect.runPromise(Effect.result(getFeatureFlags()));
	const loginEnabled = Result.isSuccess(result) ? result.success.loginEnabled : false;

	if (!loginEnabled) {
		redirect(302, "/");
	}

	return {};
};
