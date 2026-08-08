import { describe, expect, it } from "vitest";
import {
  validateImageUpload,
  IMAGE_UPLOAD_CAPS,
  IMAGE_UPLOAD_COPY,
} from "../../src/modules/polls/image-upload";

// Minimal valid image file headers for testing magic-byte sniffing.
const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_HEADER = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x00, 0x00, 0x00, 0x00, // size placeholder
  0x57, 0x45, 0x42, 0x50, // WEBP
]);
const GIF_HEADER = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

function makeFile(bytes: Uint8Array, name: string, type = ""): File {
  return new File([new Uint8Array(bytes) as unknown as BlobPart], name, { type });
}

describe("validateImageUpload", () => {
  it("accepts a valid JPEG by magic bytes", async () => {
    const file = makeFile(JPEG_HEADER, "photo.jpg");
    const result = await validateImageUpload(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType).toBe("image/jpeg");
    }
  });

  it("accepts a valid PNG by magic bytes", async () => {
    const file = makeFile(PNG_HEADER, "photo.png");
    const result = await validateImageUpload(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType).toBe("image/png");
    }
  });

  it("accepts a valid WebP by magic bytes", async () => {
    const file = makeFile(WEBP_HEADER, "photo.webp");
    const result = await validateImageUpload(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType).toBe("image/webp");
    }
  });

  it("rejects a GIF file", async () => {
    const file = makeFile(GIF_HEADER, "animation.gif");
    const result = await validateImageUpload(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(IMAGE_UPLOAD_COPY.formatInvalid);
    }
  });

  it("rejects an SVG file (text content)", async () => {
    const svgBytes = new TextEncoder().encode("<svg></svg>");
    const file = makeFile(svgBytes, "icon.svg");
    const result = await validateImageUpload(file);
    expect(result.ok).toBe(false);
  });

  it("rejects a renamed extension with wrong magic bytes", async () => {
    const file = makeFile(GIF_HEADER, "fake.jpg");
    const result = await validateImageUpload(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(IMAGE_UPLOAD_COPY.formatInvalid);
    }
  });

  it("rejects an empty file", async () => {
    const file = makeFile(new Uint8Array(0), "empty.jpg");
    const result = await validateImageUpload(file);
    expect(result.ok).toBe(false);
  });

  it("rejects a file exceeding the 5 MB cap", async () => {
    const oversized = new Uint8Array(IMAGE_UPLOAD_CAPS.maxBytes + 1);
    // Set JPEG header so it passes sniffing but fails on size.
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;
    const file = makeFile(oversized, "huge.jpg");
    const result = await validateImageUpload(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(IMAGE_UPLOAD_COPY.tooLarge);
    }
  });

  it("accepts a file exactly at the 5 MB cap", async () => {
    const exactCap = new Uint8Array(IMAGE_UPLOAD_CAPS.maxBytes);
    exactCap[0] = 0xff;
    exactCap[1] = 0xd8;
    exactCap[2] = 0xff;
    const file = makeFile(exactCap, "exact.jpg");
    const result = await validateImageUpload(file);
    expect(result.ok).toBe(true);
  });

  it("does not trust client Content-Type", async () => {
    // Send a GIF with Content-Type image/jpeg — sniffing should reject.
    const file = makeFile(GIF_HEADER, "tricky.jpg", "image/jpeg");
    const result = await validateImageUpload(file);
    expect(result.ok).toBe(false);
  });
});
