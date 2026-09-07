// Images are decoded fully into memory by sharp — cap the source size well
// below MediaService's generic upload limit (200MB, shared across images,
// video, PDFs) to bound per-job memory use and processing time.
export const MAX_IMAGE_BYTES = Number(
  process.env.MAX_IMAGE_BYTES ?? 25 * 1024 * 1024,
);
