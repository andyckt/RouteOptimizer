/**
 * Client-side image compression for proof-of-delivery uploads.
 * Vercel serverless functions have a 4.5MB request body limit.
 * Target: max ~1.1MB per image × 3 = 3.3MB total (safe margin for FormData).
 *
 * iOS Safari auto-converts HEIC→JPEG when selecting from Photos, which can
 * double or triple file size (e.g. 3.1MB HEIC → 6–8MB JPEG). That triggers
 * 413 FUNCTION_PAYLOAD_TOO_LARGE. Compression here ensures all images stay under limit.
 */

const MAX_DIMENSION = 1200;
const TARGET_BYTES_PER_IMAGE = 1_100_000; // ~1.1MB to leave margin

function compressToBlob(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      "image/jpeg",
      quality
    );
  });
}

export async function compressImageForUpload(file: File): Promise<File> {
  if (file.size <= TARGET_BYTES_PER_IMAGE) return file;

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = async () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;
      let w = width;
      let h = height;

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width >= height) {
          w = MAX_DIMENSION;
          h = Math.round((height * MAX_DIMENSION) / width);
        } else {
          h = MAX_DIMENSION;
          w = Math.round((width * MAX_DIMENSION) / height);
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }

      ctx.drawImage(img, 0, 0, w, h);

      let quality = 0.85;
      let blob = await compressToBlob(canvas, quality);
      while (blob && blob.size > TARGET_BYTES_PER_IMAGE && quality > 0.3) {
        quality -= 0.1;
        blob = await compressToBlob(canvas, quality);
      }

      if (blob) {
        const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
        resolve(new File([blob], name, { type: "image/jpeg" }));
      } else {
        resolve(file);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };

    img.src = url;
  });
}

export async function compressImagesForUpload(files: File[]): Promise<File[]> {
  return Promise.all(files.map(compressImageForUpload));
}
