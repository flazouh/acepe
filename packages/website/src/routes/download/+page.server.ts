import { dev } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

async function getLatestVersion(): Promise<string | null> {
	if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.AWS_S3_BUCKET_NAME) {
		return null;
	}

	const s3Client = new S3Client({
		region: env.AWS_DEFAULT_REGION || 'auto',
		endpoint: env.AWS_ENDPOINT_URL || 'https://t3.storageapi.dev',
		credentials: {
			accessKeyId: env.AWS_ACCESS_KEY_ID,
			secretAccessKey: env.AWS_SECRET_ACCESS_KEY
		},
		forcePathStyle: false
	});

	const command = new GetObjectCommand({
		Bucket: env.AWS_S3_BUCKET_NAME,
		Key: 'updates/latest.json'
	});

	const response = await s3Client.send(command);
	const body = await response.Body?.transformToString();
	if (!body) return null;

	const data = JSON.parse(body) as { version?: string };
	return data.version ?? null;
}

export const load: PageServerLoad = async ({ parent }) => {
	const { featureFlags } = await parent();

	if (!dev && !featureFlags.downloadEnabled) {
		throw redirect(302, '/');
	}

	const version = await getLatestVersion();

	return { version };
};
