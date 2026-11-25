// The painters' facade for the scene: each call leases the texture for one description (keyed by content), painting it
// on first use. Faces, signs, tags, chips, plates, halos and shades all come through here, so every painted pixel is
// counted against the one texture budget.
import {
  canonical,
  faceKey,
  paintBack,
  paintChip,
  paintDrop,
  paintFace,
  paintFxSprite,
  paintHalo,
  paintPage,
  paintPageShade,
  paintPlate,
  paintShade,
  paintStrata,
  paintDieFace,
  paintPrinted,
  paintSign,
  paintSlip,
  paintTable,
  paintTag,
  paintVellumTile,
} from "../../theme";
import type { ChipSpec, FaceEnv, FaceSpec, FxSprite, HaloKind, PageSpec, PlateSpec, SignSpec } from "../../theme";
import type { Lease, TextureCache } from "./textures";

export class Painter {
  constructor(
    private readonly cache: TextureCache,
    readonly env: FaceEnv,
  ) {}

  face(spec: FaceSpec): Lease {
    return this.cache.lease("face|" + faceKey(spec), (c) => paintFace(c, spec, this.env));
  }
  /** The face for `spec` if it is already painted (its art need not still be decoded); null otherwise. */
  paintedFace(spec: FaceSpec): Lease | null {
    return this.cache.leaseCached("face|" + faceKey(spec));
  }
  /** The printed card image at `url`, once it is decoded (null until then: the painted face stands in). */
  printed(url: string): Lease | null {
    const img = this.env.art(url);
    const cached = this.cache.leaseCached("printed|" + url);
    if (cached || !img) return cached;
    return this.cache.lease("printed|" + url, (c) => paintPrinted(c, img));
  }
  /** An ability's slip: its effect in ink. */
  slip(text: string): Lease {
    return this.cache.lease("slip|" + text, (c) => void paintSlip(c, text, this.env.surfaces));
  }
  back(): Lease {
    return this.cache.lease("back", (c) => paintBack(c, this.env));
  }
  sign(spec: SignSpec): Lease {
    return this.cache.lease("sign|" + canonical(spec), (c) => void paintSign(c, spec, this.env.surfaces));
  }
  tag(text: string, colour: string): Lease {
    return this.cache.lease(`tag|${text}|${colour}`, (c) => paintTag(c, text, colour, this.env.surfaces));
  }
  chip(spec: ChipSpec): Lease {
    return this.cache.lease("chip|" + canonical(spec), (c) => paintChip(c, spec, this.env.surfaces));
  }
  plate(spec: PlateSpec): Lease {
    return this.cache.lease("plate|" + canonical(spec), (c) => paintPlate(c, spec, this.env.surfaces, this.env.art));
  }
  /** The plate for `spec` if it is already painted; null otherwise. */
  paintedPlate(spec: PlateSpec): Lease | null {
    return this.cache.leaseCached("plate|" + canonical(spec));
  }
  halo(kind: HaloKind): Lease {
    return this.cache.lease("halo|" + kind, (c) => paintHalo(c, kind));
  }
  drop(): Lease {
    return this.cache.lease("drop", paintDrop);
  }
  /** One of the effects' sprites (embers, streaks, a well's light, ash, the sigil's brand, a pool of light). */
  fx(kind: FxSprite): Lease {
    return this.cache.lease("fx|" + kind, (c) => paintFxSprite(c, kind));
  }
  /** A die's face: pips (a d6) or a numeral. */
  dieFace(pips: boolean, n: number): Lease {
    return this.cache.lease(`die|${pips}|${n}`, (c) => paintDieFace(c, { pips, n }));
  }
  /** A block's wall, one card high (repeated by its material). */
  strata(): Lease {
    return this.cache.lease("strata", paintStrata);
  }
  shade(): Lease {
    return this.cache.lease("shade", paintShade);
  }
  pageShade(): Lease {
    return this.cache.lease("pageShade", paintPageShade);
  }
  page(spec: PageSpec): Lease {
    return this.cache.lease("page|" + canonical(spec), (c) => paintPage(c, spec, this.env.surfaces));
  }
  vellumTile(mine: boolean, base: string): Lease {
    return this.cache.lease(`vellum|${mine}|${base}`, (c) => paintVellumTile(c, mine, base, this.env.surfaces));
  }
  table(seed = 1): Lease {
    return this.cache.lease("table|" + seed, (c) => paintTable(c, this.env.surfaces, seed));
  }
}
