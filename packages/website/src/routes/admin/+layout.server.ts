import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { validateSession } from '$lib/server/auth/admin';

export const load: LayoutServerLoad = async ({ cookies }) => {
	const sessionId = cookies.get('session');

	if (!sessionId) {
		throw redirect(302, '/login');
	}

	const userResult = await validateSession(sessionId);

	if (userResult.isErr() || !userResult.value) {
		cookies.delete('session', { path: '/' });
		throw redirect(302, '/login');
	}

	if (!userResult.value.isAdmin) {
		throw redirect(302, '/');
	}

	return {
		user: {
			email: userResult.value.email,
			name: userResult.value.name,
			picture: userResult.value.picture
		}
	};
};
