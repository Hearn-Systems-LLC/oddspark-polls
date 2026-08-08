// R2 adapter — thin Media-module storage port. Cleanup policy and age/
// ownership decisions stay in the provider-free Media module (AD-1/AD-19).

import type { TempObjectPage } from "../../modules/media/index";

export function createR2MediaStorage(bucket: R2Bucket) {
  return {
    async deleteObject(key: string): Promise<void> {
      await bucket.delete(key);
    },

    async listTempKeys(
      cursor: string | undefined,
      limit: number,
    ): Promise<TempObjectPage> {
      const page = await bucket.list({
        prefix: "tmp/",
        cursor,
        limit,
      });
      return {
        objects: page.objects.map((object) => ({
          key: object.key,
          uploadedAtMs: object.uploaded.getTime(),
        })),
        truncated: page.truncated,
        ...(page.truncated ? { cursor: page.cursor } : {}),
      };
    },
  };
}
