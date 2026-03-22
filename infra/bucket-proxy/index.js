// Simple S3 bucket proxy that streams content directly (no redirects)
// This fixes Tauri updater which makes HEAD requests that fail on presigned URLs

import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.S3_REGION || "auto",
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.S3_BUCKET;
const PORT = process.env.PORT || 3000;

async function handleRequest(req) {
  const url = new URL(req.url, `http://localhost`);
  const key = url.pathname.slice(1); // Remove leading slash

  if (!key) {
    return new Response("Bucket proxy running", { status: 200 });
  }

  try {
    if (req.method === "HEAD") {
      // Handle HEAD request
      const command = new HeadObjectCommand({ Bucket: BUCKET, Key: key });
      const response = await s3.send(command);

      return new Response(null, {
        status: 200,
        headers: {
          "Content-Type": response.ContentType || "application/octet-stream",
          "Content-Length": response.ContentLength?.toString() || "0",
          "ETag": response.ETag || "",
          "Last-Modified": response.LastModified?.toUTCString() || "",
        },
      });
    }

    // Handle GET request - stream the content
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const response = await s3.send(command);

    return new Response(response.Body, {
      status: 200,
      headers: {
        "Content-Type": response.ContentType || "application/octet-stream",
        "Content-Length": response.ContentLength?.toString() || "0",
        "ETag": response.ETag || "",
        "Last-Modified": response.LastModified?.toUTCString() || "",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
      return new Response("Not Found", { status: 404 });
    }
    console.error("Error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`Bucket proxy running on port ${PORT}`);
