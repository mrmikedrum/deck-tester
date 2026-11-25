// Loading what painters and materials draw from: the baked surfaces and the tome's normal map (images), and card art
// (decoded to ImageBitmaps). All same-origin; a missing image is not an error, the painters have flat fallbacks.
import { FRAME_KEYS } from "../../theme";
import type { FrameKey, Source, Surfaces } from "../../theme";
import { FRAME_URLS, TEXTURE_URLS } from "../../theme/grimoire/tex";
import type { ArtImage } from "../resources";

export interface Assets {
  readonly surfaces: Surfaces;
  readonly tomeNormal: Source | null;
}

function image(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Load every baked surface; resolves once all have loaded or failed. */
export async function loadAssets(): Promise<Assets> {
  const [vellum, bronze, bronzeClean, tome, tomeNormal, ...frames] = await Promise.all([
    image(TEXTURE_URLS.vellum),
    image(TEXTURE_URLS.bronze),
    image(TEXTURE_URLS.bronzeClean),
    image(TEXTURE_URLS.tome),
    image(TEXTURE_URLS.tomeNormal),
    ...FRAME_KEYS.map((k) => image(FRAME_URLS[k])),
  ]);
  const frame: Partial<Record<FrameKey, Source>> = {};
  FRAME_KEYS.forEach((k, i) => {
    const f = frames[i];
    if (f) frame[k] = f;
  });
  return { surfaces: { vellum, bronze, bronzeClean, tome, frame }, tomeNormal };
}

/** Card art over fetch: decoded off the main thread where the browser can. Null on any failure. */
export async function loadArt(url: string): Promise<ArtImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}
