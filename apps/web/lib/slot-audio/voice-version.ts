/**
 * Content-hash query for voice lines. `public/audio/voice/<game>/<tr|en>/<stem>.mp3` keep stable names, so each bank URL is
 * `<folder>/<stem>.mp3?v=<hash>` where the hash covers every file of that game/language folder
 * (scripts/build-audio-worker.mjs writes voice-version.generated.ts; it runs before dev, build, typecheck and test).
 * public/_headers serves /audio/voice/* `immutable`: that is only safe because EVERY loader builds its URL through here.
 * A URL outside the generated folders (a custom per-line URL, a test folder) is returned unchanged.
 */
import { VOICE_FOLDER_VERSIONS } from './voice-version.generated';

export function versionedVoiceUrl(url: string): string {
  const slash = url.lastIndexOf('/');
  if (slash <= 0) return url;
  const version = Object.hasOwn(VOICE_FOLDER_VERSIONS, url.slice(0, slash)) ? VOICE_FOLDER_VERSIONS[url.slice(0, slash)] : undefined;
  return version ? `${url}?v=${version}` : url;
}
