import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { container } from '$lib/server/infrastructure/container';

export const load: PageServerLoad = async ({ url }) => {
	const token = url.searchParams.get('token');

	if (!token) {
		throw error(400, 'Missing confirmation token');
	}

	const service = container.getWaitlistService();
	const result = await service.confirmEmail(token);

	if (result.isErr()) {
		throw error(400, result.error.message);
	}

	return {
		confirmed: true
	};
};
