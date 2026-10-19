/**
 * Lobby key-art files. scripts/lobby-posters.mjs renders /lab/lobby-posters (each game's own art components) into
 * public/images/lobby/<id>-<variant>.webp and writes the content hashes to posters.generated.ts, so a URL changes
 * whenever its bytes do. Sizes are the file's pixel size; the lobby reserves the same aspect ratio (no layout shift).
 */
import { POSTER_VERSIONS } from './posters.generated';

export type PosterVariant = 'tile' | 'wide' | 'narrow' | 'land';
/** [width, height] in pixels. tile 3:4 (rows and grids), wide ≈ 2.44:1 (desktop hero), narrow 3:2 (phone hero), land 16:10. */
export const POSTER_SIZES: Readonly<Record<PosterVariant, readonly [number, number]>> = Object.freeze({
  tile: [360, 480], wide: [1320, 540], narrow: [780, 520], land: [560, 350],
});

export interface PosterImage { src: string; width: number; height: number }
/** The poster of one game in one format, or null when it was not generated. */
export function poster(id: string, variant: PosterVariant): PosterImage | null {
  const key = `${id}-${variant}`;
  const version = Object.hasOwn(POSTER_VERSIONS, key) ? POSTER_VERSIONS[key as keyof typeof POSTER_VERSIONS] : undefined;
  if (!version) return null;
  const [width, height] = POSTER_SIZES[variant];
  return { src: `/images/lobby/${key}.webp?v=${version}`, width, height };
}
