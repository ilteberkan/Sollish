/** Prints the owner's table (Turkish) from resim.json and player-path.json of an RTP audit.
 * Run: bash scripts/use-node.sh node --import tsx ops/rtp-audit/report.ts ops/evidence/rtp-audit-20261023 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "ops/evidence/rtp-audit-20261023");
const resim = JSON.parse(readFileSync(resolve(dir, "resim.json"), "utf8"));
const player = existsSync(resolve(dir, "player-path.json")) ? JSON.parse(readFileSync(resolve(dir, "player-path.json"), "utf8")) : { results: [] };
const NAMES: Record<string, string> = { cascade: "Candy Cascade", tarhun: "Tarhun", ebru: "Ebru", cezeri: "Cezeri", asena: "Asena", goreme: "Göreme", damla: "Damla" };
const pct = (x: number, d = 2) => `%${(x * 100).toFixed(d).replace(".", ",")}`;
const range = (r: [number, number]) => `${pct(r[0])} – ${pct(r[1])}`;

console.log("| Oyun | Mod | İddia edilen RTP | Yeniden ölçülen RTP (2 M tur) | %95 aralık | Eski aralıkta mı | Oyuncu yolu RTP, 200 bin tur (bahis ağırlıklı / tur başı) | Defter = motor | Karar |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of resim.results) {
  const p = player.results.find((x: { game: string; mode: string }) => x.game === r.game && x.mode === r.mode);
  const ledgerOk = p ? p.ledgerMismatches === 0 && p.ledgerRefusals === 0 && p.costMismatches === 0 && p.replayMismatches === 0 && p.sessionMatches && p.sumBalanceChangeCents === p.sumPayoutCents - p.sumCostCents : null;
  const pIn = p ? p.expectedRtp >= p.rtpWeightedCi95[0] && p.expectedRtp <= p.rtpWeightedCi95[1] : true;
  const pText = p ? `${pct(p.rtpWeighted)} / ${pct(p.rtpPerRoundMean)}${pIn ? "" : " **(aralık dışı, z=" + p.zWeightedVsExpected.toFixed(2).replace(".", ",") + ")**"}` : "—";
  const verdict = r.verdict === "PASS" && ledgerOk !== false && pIn ? "GEÇTİ" : "**KALDI**";
  console.log(`| ${NAMES[r.game]} | ${r.mode} | ${pct(r.claim.claimedRtp, r.game === "damla" ? 3 : 2)}${r.game === "damla" ? " (kesin)" : ""} | ${pct(r.rtp)} | ${range(r.ci95)} | ${r.newInsideOriginalCi95 ? "evet" : "hayır"} (z=${r.zVsOriginal.toFixed(2).replace(".", ",")}) | ${pText} | ${ledgerOk === null ? "—" : ledgerOk ? "evet" : "HAYIR"} | ${verdict} |`);
}
