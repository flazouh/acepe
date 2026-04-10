import { redirect } from "@sveltejs/kit";
import { getFeatureFlags } from "$lib/server/feature-flags";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
	const result = await getFeatureFlags();
	const loginEnabled = result.isOk() ? result.value.loginEnabled : false;

	if (!loginEnabled) {
		redirect(302, "/");
	}

	return {};
};
