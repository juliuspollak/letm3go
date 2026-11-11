// JWT-verified private media endpoint. Uploads go to the private R2 bucket; the
// client never receives R2 credentials, only short-lived signed URLs. The logic lives in
// handler.js (so it can be tested); this file only wires in Supabase and R2.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from 'npm:@aws-sdk/client-s3@3';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3';
import { createJourneysHandler } from './handler.js';

const r2 = () => new S3Client({ region: Deno.env.get('R2_REGION') || 'auto', endpoint: Deno.env.get('R2_ENDPOINT'), credentials: { accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!, secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')! } });
const bucket = Deno.env.get('R2_BUCKET_NAME')!;
Deno.serve(createJourneysHandler({
  env: (key: string) => Deno.env.get(key)!,
  createClient,
  storage: {
    signedGet: (key: string) => getSignedUrl(r2(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 }),
    put: (key: string, body: Uint8Array) => r2().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'image/jpeg', CacheControl: 'private, max-age=60' })),
    remove: (key: string) => r2().send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
  },
}));
