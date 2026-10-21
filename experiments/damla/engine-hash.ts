/** sha256 of the engine source without its evidence block (the DAMLA_RTP constants are filled from the evidence itself). */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const stripEvidenceBlock = (source: string): string => source.replace(/\/\/ @evidence-block-begin[^\n]*\n[\s\S]*?\/\/ @evidence-block-end\n/, "");
export const engineSha256 = (): string => createHash("sha256").update(stripEvidenceBlock(readFileSync(new URL("../../packages/protocol/src/damla.ts", import.meta.url), "utf8"))).digest("hex");
