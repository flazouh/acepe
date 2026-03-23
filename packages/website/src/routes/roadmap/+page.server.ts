import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// Roadmap page is disabled — redirect to home.
	// The previous implementation depended on the reports API which has been removed
	// in favor of GitHub Issues projection in the desktop app.
	throw redirect(302, '/');
};
