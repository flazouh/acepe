import { error, redirect } from '@sveltejs/kit';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const PRESIGNED_URL_EXPIRY = 3600; // 1 hour

function getS3Client(): S3Client {
	return new S3Client({
		region: env.AWS_DEFAULT_REGION || 'auto',
		endpoint: env.AWS_ENDPOINT_URL || 'https://t3.storageapi.dev',
		credentials: {
			accessKeyId: env.AWS_ACCESS_KEY_ID!,
			secretAccessKey: env.AWS_SECRET_ACCESS_KEY!
		},
		forcePathStyle: false
	});
}

async function getLatestVersion(s3Client: S3Client): Promise<string | null> {
	const command = new GetObjectCommand({
		Bucket: env.AWS_S3_BUCKET_NAME!,
		Key: 'updates/latest.json'
	});

	const response = await s3Client.send(command);
	const body = await response.Body?.transformToString();
	if (!body) return null;

	const data = JSON.parse(body) as { version?: string };
	return data.version ?? null;
}

export const GET: RequestHandler = async ({ url }) => {
	const arch = url.searchParams.get('arch');

	// Validate architecture
	if (!arch || !['aarch64', 'x64'].includes(arch)) {
		throw error(400, 'Invalid architecture. Use ?arch=aarch64 or ?arch=x64');
	}

	// Check if bucket credentials are configured
	if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.AWS_S3_BUCKET_NAME) {
		throw error(503, 'Download service not configured');
	}

	const s3Client = getS3Client();

	// Get version for filename
	const version = await getLatestVersion(s3Client);
	const archLabel = arch === 'aarch64' ? 'Apple_Silicon' : 'Intel';
	const filename = version ? `Acepe_${version}_${archLabel}.dmg` : `Acepe_${archLabel}.dmg`;

	const key = `latest/Acepe_${arch}.dmg`;

	const command = new GetObjectCommand({
		Bucket: env.AWS_S3_BUCKET_NAME!,
		Key: key,
		ResponseContentDisposition: `attachment; filename="${filename}"`
	});

	const presignedUrl = await getSignedUrl(s3Client, command, {
		expiresIn: PRESIGNED_URL_EXPIRY
	});

	throw redirect(302, presignedUrl);
};
