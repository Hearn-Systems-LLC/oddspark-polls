// Server-side image upload validation for Image Polls (Story 6.1 / AC 1).
// Magic-byte sniffing + byte-length cap; never trusts client Content-Type.

export const IMAGE_UPLOAD_CAPS = {
  maxBytes: 5 * 1024 * 1024,
  maxAltTextLength: 500,
  maxCaptionLength: 200,
} as const;

export const IMAGE_UPLOAD_COPY = {
  uploadFailed: (filename: string): string =>
    `${filename || "The image"} didn't upload. The rest of the form is intact \u2014 try that one again.`,
  preservedRefLost:
    "A previously uploaded image is no longer available. Try uploading it again.",
  formatInvalid:
    "Only JPEG, PNG, and WebP images are accepted.",
  tooLarge:
    "That image is too large. Keep it under 5 MB.",
  altTextTooLong:
    `Alt text is too long. Keep it to ${IMAGE_UPLOAD_CAPS.maxAltTextLength} characters.`,
  captionTooLong:
    `Caption is too long. Keep it to ${IMAGE_UPLOAD_CAPS.maxCaptionLength} characters.`,
} as const;

export type ImageValidationResult =
  | { ok: true; contentType: string; sizeBytes: number }
  | { ok: false; error: string };

const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff]);
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const WEBP_RIFF = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
const WEBP_SUFFIX = new Uint8Array([0x57, 0x45, 0x42, 0x50]);

function matchesPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

function sniffContentType(bytes: Uint8Array): string | null {
  if (matchesPrefix(bytes, JPEG_MAGIC)) return "image/jpeg";
  if (matchesPrefix(bytes, PNG_MAGIC)) return "image/png";
  if (
    bytes.length >= 12 &&
    matchesPrefix(bytes, WEBP_RIFF) &&
    matchesPrefix(bytes.slice(8, 12), WEBP_SUFFIX)
  ) {
    return "image/webp";
  }
  return null;
}

export async function validateImageUpload(
  file: File,
): Promise<ImageValidationResult> {
  if (file.size > IMAGE_UPLOAD_CAPS.maxBytes) {
    return { ok: false, error: IMAGE_UPLOAD_COPY.tooLarge };
  }
  if (file.size === 0) {
    return { ok: false, error: IMAGE_UPLOAD_COPY.formatInvalid };
  }

  const headerSize = Math.min(file.size, 12);
  const headerSlice = file.slice(0, headerSize);
  const headerBuffer = await headerSlice.arrayBuffer();
  const headerBytes = new Uint8Array(headerBuffer);

  const contentType = sniffContentType(headerBytes);
  if (contentType === null) {
    return { ok: false, error: IMAGE_UPLOAD_COPY.formatInvalid };
  }

  return { ok: true, contentType, sizeBytes: file.size };
}
