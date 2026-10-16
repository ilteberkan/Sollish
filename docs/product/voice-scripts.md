# Voice-over scripts (Turkish and English)

Status: generated 16 Oct 2026. Owner decision (16 Oct 2026): game voices are **English by default**; only when the site language is Turkish do the Turkish voices play. For every other language (de, pt, fr, it, es, zh, ko, en) the English voices play.

## Files and loading

- Folders: `apps/web/public/audio/voice/<game>/tr/<stem>.mp3` and `.../<game>/en/<stem>.mp3`, same stems in both languages. `<game>` is `storm` (Tarhun), `cezeri`, `ebru`, `asena`, `cascade` (Candy Cascade, stems are the multiplier class names `x2 x10 x25 x50 x100 x250`).
- Language: `lib/slot-audio/voice-locale.ts`. `voiceLanguage()` reads `document.documentElement.lang` (`tr*` gives `tr`, everything else and the server give `en`). `onVoiceLanguageChange(cb)` listens to the `sollish:locale` event on `window` (`detail.locale`), which the i18n layer dispatches when it changes `<html lang>`. Each game hook loads `/audio/voice/<game>/<lang>` and reloads the bank when the voice language changes; the engine drops the old buffers first and ignores a bank that was superseded while loading. A missing file leaves that line to its non-verbal placeholder, silently.
- Policy: `lib/slot-audio/voice-policy.ts` (see the end of this file). Level setting: `voice` in the shared slot settings, panel control "Ses anonsu" (`VOICE_LEVEL_UI` in `components/slot-kit/settings-panel.tsx`).

## Style rules for the English lines

Short (one to four words for multipliers, at most six otherwise), confident, professional, varied between characters, never cheesy or shouty. No catchphrases from other games or brands. No gambling-encouragement language ("bet more", "don't stop"): lines celebrate an outcome that already happened, or name a feature moment, and nothing else. Turkish lines are the existing owner-approved texts (Tarhun from `storm-throne-voice-script.md`, the others from `*_VOICE_TEXT` in `lib/slot-audio/*-tiers.ts`); Candy Cascade Turkish lines are new.


## Tarhun: Fırtına Tahtı

**Character:** Deep, commanding, original storm god. Slow and weighty, a little amused, never shouting. Short declarations, like weather being announced.

**Voice (both languages):** Gideon (`1ad38ba4-9cc4-4f2f-9fde-b0fefdf67ae5`), Higgsfield `text2speech_v2`, ElevenLabs, preset.

| Stem | When | Turkish | English |
|---|---|---|---|
| `x2-9` | multiplier ×2–9 (minor remark) | Güç! | Power. |
| `x10` | multiplier ≥×10 | On kat! | Ten times! |
| `x25` | multiplier ≥×25 | Yirmi beş kat! | Twenty-five! |
| `x50` | multiplier ≥×50 | Elli kat! | Fifty times! |
| `x100` | multiplier ≥×100 | Yüz kat! | One hundred! |
| `x250` | multiplier ≥×250 | İki yüz elli kat! | Two hundred fifty! |
| `x500` | multiplier ×500 (orb ceiling) | Beş yüz kat! | Five hundred! |
| `scatter-tease` | two scatters on screen (tease) | Hissediyorum... | I feel it... |
| `feature-trigger` | free spins triggered | Fırtına başlıyor! | The storm begins. |
| `feature-start` | free spins begin | Gökler açıldı! | The skies are open. |
| `retrigger` | free spins re-triggered | Daha fazlası! | Five more spins. |
| `win-big` | win ≥10× | Büyük kazanç! | Big win. |
| `win-mega` | win ≥25× | Mega kazanç! | Mega win. |
| `win-super` | win ≥50× | Süper kazanç! | Super win. |
| `win-legend` | win ≥100× | Efsane kazanç! | Legendary win. |
| `win-max` | win cap reached | Azami kazanç! Gökler senin! | Maximum win. The skies are yours. |
| `laugh` | long tumble chain | Ha ha haaa! | Ha, ha, haaa! |
| `nice` | medium win (rare) | Güzel! | Well struck. |
| `feature-end` | free spins total screen | Fırtına dindi. | The storm has passed. |


## Cezeri

**Character:** Warm, measured master engineer. Unhurried and precise, proud of the work, speaks like someone reading a gauge he built himself.

**Voice (both languages):** Barrett (`d603a8cd-3fe1-55e0-9245-617a2589131e`), Higgsfield `text2speech_v2`, ElevenLabs, preset.

| Stem | When | Turkish | English |
|---|---|---|---|
| `x10` | multiplier ≥×10 | On kat! | Ten times. |
| `x25` | multiplier ≥×25 | Yirmi beş kat! | Twenty-five times. |
| `x50` | multiplier ≥×50 | Elli kat! | Fifty times. |
| `x100` | multiplier ≥×100 | Yüz kat! | One hundred times. |
| `x250` | multiplier ≥×250 | İki yüz elli kat! | Two hundred fifty. |
| `lock` | a ring locks | Kenetlendi! | Locked in. |
| `chain-3` | chain: 3rd respin | Çarklar dönüyor! | The gears turn. |
| `chain-6` | chain: 6th respin | Dişliler hızlanıyor! | The gears gain speed. |
| `chain-max` | chain: all 10 respins | Tam kurulum! | Fully assembled. |
| `scatter-tease` | two scatters on screen (tease) | Bir su kabı daha… | One more vessel... |
| `feature-trigger` | free spins triggered | Su kapları doldu! | The vessels are full. |
| `feature-start` | free spins begin | Fil Saati başlıyor. | The Elephant Clock begins. |
| `retrigger` | free spins re-triggered | Dört dönüş daha! | Four more turns. |
| `reservoir` | reservoir level 3 | Hazne doldu! | The reservoir is full. |
| `falcon` | falcon flight | Şahin süzülüyor! | The falcon glides. |
| `win-big` | win ≥10× | Büyük kazanç! | Big win. |
| `win-mega` | win ≥25× | Mega kazanç! | Mega win. |
| `win-super` | win ≥50× | Süper kazanç! | Super win. |
| `win-legend` | win ≥100× | Efsane kazanç! | Legendary win. |
| `win-max` | win cap reached | Azami kazanç! | Maximum win. A masterwork. |
| `nice` | medium win (rare) | Güzel! | Fine work. |
| `feature-end` | free spins total screen | Saat tamamlandı. | The hour is complete. |


## Ebru: Mürekkep Bahçesi

**Character:** Calm, soft marbling master. Quiet, steady, close to the microphone; the voice of someone watching ink settle on water.

**Voice (both languages):** Vesper (`c3204739-4084-41a3-9dc5-c805b307ec18`), Higgsfield `text2speech_v2`, ElevenLabs, preset.

| Stem | When | Turkish | English |
|---|---|---|---|
| `x2-9` | multiplier ×2–9 (minor remark) | Renk! | Colour. |
| `x10` | multiplier ≥×10 | On kat! | Tenfold. |
| `x25` | multiplier ≥×25 | Yirmi beş kat! | Twenty-five. |
| `x50` | multiplier ≥×50 | Elli kat! | Fifty. |
| `x100` | multiplier ≥×100 | Yüz kat! | One hundred. |
| `x250` | multiplier ≥×250 | İki yüz elli kat! | Two hundred fifty. |
| `scatter-tease` | two scatters on screen (tease) | Bir tarak daha… | One more comb... |
| `feature-trigger` | free spins triggered | Altın taraklar! | Golden combs. |
| `feature-start` | free spins begin | Lale ebrusu başlıyor. | The tulip marbling begins. |
| `retrigger` | free spins re-triggered | Dört dönüş daha! | Four more passes. |
| `win-big` | win ≥10× | Büyük kazanç! | Big win. |
| `win-mega` | win ≥25× | Mega kazanç! | Mega win. |
| `win-super` | win ≥50× | Süper kazanç! | Super win. |
| `win-legend` | win ≥100× | Efsane kazanç! | Legendary win. |
| `win-max` | win cap reached | Azami kazanç! | Maximum win. |
| `comb` | comb sweep | Tarak suda… | Comb on water... |
| `nice` | medium win (rare) | Güzel! | Lovely. |
| `feature-end` | free spins total screen | Bahçe tamam. | The garden is complete. |


## Asena

**Character:** Wise, mythic sky voice. Clear and spacious, ceremonial but not theatrical; names things as if reading them off the stars.

**Voice (both languages):** Nora (`d081b915-6623-4a44-bacf-80d0f1c90a03`), Higgsfield `text2speech_v2`, ElevenLabs, preset.

| Stem | When | Turkish | English |
|---|---|---|---|
| `x2-9` | multiplier ×2–9 (minor remark) | Parlıyor! | It shines. |
| `x10` | multiplier ≥×10 | On kat! | Ten times. |
| `x25` | multiplier ≥×25 | Yirmi beş kat! | Twenty-five times. |
| `x50` | multiplier ≥×50 | Elli kat! | Fifty times. |
| `x100` | multiplier ≥×100 | Yüz kat! | A hundred. |
| `x250` | multiplier ≥×250 | İki yüz elli kat! | Two hundred fifty. |
| `sky-open` | constellation opens | Gök açıldı! | The sky opens. |
| `tpl-kurt-basi` | template: wolf head | Kurt Başı! | Wolf Head. |
| `tpl-yay` | template: bow | Yay gerildi! | The bow is drawn. |
| `tpl-at` | template: horse | At koşuyor! | The horse runs. |
| `tpl-kartal` | template: eagle | Kartal kanatlandı! | The eagle takes wing. |
| `tpl-hayat-agaci` | template: tree of life | Hayat Ağacı! | Tree of Life. |
| `tpl-hilal` | template: crescent | Hilal doğdu. | The crescent rises. |
| `wolf-guides` | wolf walk | Kurt yol gösteriyor… | The wolf shows the way... |
| `moon-tease` | moon tease | Ay Ata bakıyor… | Ay Ata is watching... |
| `feature-trigger` | free spins triggered | Ay Ata uyandı! | Ay Ata awakens. |
| `feature-start` | free spins begin | Ergenekon! | Ergenekon. |
| `retrigger` | free spins re-triggered | Üç dönüş daha! | Three more spins. |
| `map-spins` | +5 map spins | Beş dönüş daha! | Five more spins. |
| `mult-2` | mountain multiplier ×2 | Demir dağ çatlıyor! İki kat! | The iron mountain cracks. Two times. |
| `mult-3` | mountain multiplier ×3 | Dağ eriyor! Üç kat! | The mountain melts. Three times. |
| `mult-5` | mountain multiplier ×5 | Ergenekon açıldı! Beş kat! | Ergenekon is open. Five times. |
| `win-big` | win ≥10× | Büyük kazanç! | Big win. |
| `win-mega` | win ≥25× | Mega kazanç! | Mega win. |
| `win-super` | win ≥50× | Süper kazanç! | Super win. |
| `win-legend` | win ≥100× | Efsane kazanç! | Legendary win. |
| `win-max` | win cap reached | Azami kazanç! | Maximum win. |
| `nice` | medium win (rare) | Güzel! | Well done. |
| `feature-end` | free spins total screen | Ergenekon’dan çıktık! | We have left Ergenekon. |


## Candy Cascade

**Character:** Bright, playful, warm host. Smiling and quick, a little sparkle in the pitch, never childish or squeaky.

**Voice (both languages):** Skye (`1fb253b8-928b-4d29-a349-f242a71eaddf`), Higgsfield `text2speech_v2`, ElevenLabs, preset.

| Stem | When | Turkish | English |
|---|---|---|---|
| `x2` | multiplier below ×10 (minor remark) | Tatlı! | Sweet! |
| `x10` | multiplier ≥×10 | On kat! | Ten times! |
| `x25` | multiplier ≥×25 | Yirmi beş kat! | Twenty-five! |
| `x50` | multiplier ≥×50 | Elli kat! | Fifty times! |
| `x100` | multiplier ≥×100 | Yüz kat! | One hundred! |
| `x250` | multiplier ≥×250 | İki yüz elli kat! | Two hundred fifty! |


## Candy Cascade voice audition

One line, "Sweet! Fifty times!", was generated with two bright female/neutral presets from `list_voices`: **Zoe** (`d0374db1-44b9-4f05-939e-0a9ae9dbbe6a`) and **Skye** (`1fb253b8-928b-4d29-a349-f242a71eaddf`). Measured on the two clips (spectral centroid of the whole clip, voiced-frame pitch spread): Skye is brighter (centroid 3231 Hz against 2433 Hz) and moves through a wider pitch range (about 178 to 398 Hz against 206 to 416 Hz), which reads as "bright and playful" without a higher, squeakier baseline; Zoe is softer and closer to a narrator. **Skye was chosen** for all twelve Candy Cascade lines (six English, six Turkish). This is an objective pick from the audio, not a listening acceptance; the owner's ear decides, and replacing the voice means regenerating twelve short lines.

## Production log (16 Oct 2026)

- Model and variant: `text2speech_v2` / `elevenlabs`, voice type `preset`, credits (not unlimited). One item per call (a second item in the same batch call returned HTTP 429 `rate_limit_reached` every time), `jobs_wait` between calls, no item resubmitted after it had a job id.
- Cost: 102 generations (2 auditions, 12 Candy Cascade, 88 English for the four existing games), credits 35.75 before and 20.45 after (0.15 per line).
- Processing (ffmpeg): leading silence cut at -45 dB with 0.05 s kept, trailing silence cut with 0.12 s kept, `loudnorm I=-16 TP=-1.5 LRA=7`, 44.1 kHz mono, MP3 128 kb/s. Measured over all 100 new files: integrated loudness -17.6 to -15.1 LUFS (the three quietest are very short clips: Ebru `nice` -17.6, Candy Cascade Turkish `x2` -17.2 after an extra `alimiter=limit=0.84`, and one more at -17.5), highest peak -1.7 dBFS.
- Pronunciation risks to check by ear: "Ergenekon", "Ay Ata" (Asena, English), the laugh "Ha, ha, haaa!" (Tarhun, English), "Elephant Clock" (Cezeri). Replace a single line by regenerating it with the same voice and stem.

## Not annoying: shared policy (all five games)

| Rule | Value |
|---|---|
| Level "Key moments" (default) | tier lines, feature lines, multiplier callouts from ×10 |
| Level "Full" | everything, including teases, locks, templates, the ×2–9 remark and ambient remarks |
| Level "Off" | no recorded line and no non-verbal placeholder |
| Spacing | at most one line per 2.5 s; tier and feature lines are headlines and are not held back by the gap (the engine still plays one voice at a time by priority) |
| Repeats | the same line is not repeated within 20 s; tier lines (including the max win) are exempt |
| ×2–9 remark | Tarhun speaks it at Key moments; the other games only at Full; at most once per 30 s |
| Ambient ("nice", laugh) | at most once per 60 s, Full only, never in turbo or autoplay |
| Turbo or autoplay | only tier and feature lines |

None of this reads or changes a result, a payout or a settlement: it only decides whether a finished win or feature moment is announced aloud.
