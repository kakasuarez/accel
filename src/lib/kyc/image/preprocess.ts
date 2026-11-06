import sharp from 'sharp';

export interface PreparedImage {
  png: Buffer;
  width: number;
  height: number;
  /** Variance of the Laplacian (higher = sharper). */
  blurScore: number;
}

const LAPLACIAN = { width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 };

/** Sharpness as variance of the Laplacian (a standard focus measure), computed with sharp's convolve + stats. */
export async function laplacianVariance(img: Buffer): Promise<number> {
  const { channels } = await sharp(img).greyscale().convolve(LAPLACIAN).stats();
  return channels[0].stdev ** 2;
}

/**
 * Normalize an upload for OCR:
 *  1. apply EXIF orientation and flatten transparency onto white;
 *  2. keep only the red channel: red/pink watermarks and stamps are near-white there, while black and
 *     dark-blue text stays dark (the usual channel-separation way to drop coloured overlays);
 *  3. upscale small captures so text is large enough for tesseract (~300 dpi equivalent).
 * No contrast stretch here: it would amplify the faint watermark residue. Binarisation is left to
 * tesseract (Otsu); `enhance` stretches contrast for images that need it.
 */
export async function prepareForOcr(input: Buffer): Promise<PreparedImage> {
  const meta = await sharp(input).metadata();
  const minWidth = 1000;
  const scale = meta.width && meta.width < minWidth ? minWidth / meta.width : 1;

  let pipeline = sharp(input).rotate().flatten({ background: '#ffffff' }).toColourspace('srgb').extractChannel('red');
  if (scale > 1) pipeline = pipeline.resize({ width: Math.round(meta.width! * scale), kernel: 'lanczos3' });
  const { data, info } = await pipeline.png().toBuffer({ resolveWithObject: true });
  return { png: data, width: info.width, height: info.height, blurScore: await laplacianVariance(data) };
}

/** Enhancement for blurry or low-contrast images: 2× Lanczos upscale, median denoise, unsharp mask. */
export async function enhance(png: Buffer): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  return sharp(png)
    .resize({ width: (meta.width ?? 1000) * 2, kernel: 'lanczos3' })
    .median(3)
    .sharpen({ sigma: 1.5, m1: 1, m2: 3 })
    .normalise()
    .png()
    .toBuffer();
}

export const rotate = (png: Buffer, deg: 90 | 180 | 270) => sharp(png).rotate(deg).png().toBuffer();
