import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getFeatureFlags } from '$lib/server/feature-flags';

export const load: PageServerLoad = async () => {
	const result = await getFeatureFlags();
	const loginEnabled = result.isOk() ? result.value.loginEnabled : false;

	if (!loginEnabled) {
		redirect(302, '/');
	}

	return {};
};
