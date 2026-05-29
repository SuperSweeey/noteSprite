import COS from "cos-nodejs-sdk-v5";

let cosClient: COS | null = null;

export function getCOS(): COS | null {
  if (!process.env.COS_SECRET_ID || !process.env.COS_SECRET_KEY) return null;

  if (!cosClient) {
    cosClient = new COS({
      SecretId: process.env.COS_SECRET_ID,
      SecretKey: process.env.COS_SECRET_KEY,
    });
  }
  return cosClient;
}

/**
 * Generate a pre-signed upload URL for direct client-to-COS upload.
 */
export async function getPresignedUploadUrl(
  key: string,
  expiresIn = 600
): Promise<string | null> {
  const cos = getCOS();
  if (!cos) return null;

  const bucket = process.env.COS_BUCKET!;
  const region = process.env.COS_REGION!;

  return new Promise((resolve) => {
    cos.getObjectUrl(
      {
        Bucket: bucket,
        Region: region,
        Key: key,
        Method: "PUT",
        Expires: expiresIn,
        Sign: true,
      },
      (err, data) => {
        if (err) {
          console.error("COS presigned URL error:", err);
          resolve(null);
        } else {
          resolve(data.Url);
        }
      }
    );
  });
}

/**
 * Generate a read URL (with CDN if configured).
 */
export function getFileUrl(key: string): string {
  const cdn = process.env.COS_CDN_DOMAIN;
  if (cdn) return `${cdn}/${key}`;

  const bucket = process.env.COS_BUCKET!;
  const region = process.env.COS_REGION!;
  return `https://${bucket}.cos.${region}.myqcloud.com/${key}`;
}
