# Sollish

Non-custodial Solana game platform (Coinflip, Crash, Ringside live 2.5D boxing) on Cloudflare Workers, managed Supabase and an ARM VPS worker. Talk to the user in Turkish: short and concrete, with evidence and limits.

## Read only when the task needs it
- Starting a session: `docs/handoff/STATUS.md` holds what is deployed, what failed and which decisions wait on the user. Update it before you stop or when context runs low.
- Ringside simulation, AI, economy or LIVE protocol: `docs/product/ringside-neuroarena-spec.md`, then only the section of `docs/product/ringside-version-log.md` for the version you touch.
- Token, airdrop, chat, infrastructure or UI direction: `docs/product/platform-decisions.md`.
- Any new or changed game: `docs/product/game-standards.md` (owner decision, 11 Oct 2026). Games match top commercial studios in features and polish, with fully original art, sound, names and paytables; never a copy of another game.
- Next.js code: `apps/web/AGENTS.md`.
- Contracts or devnet deploy: `docs/devnet-deployment.md`. Never run a blind `anchor deploy`.
- Test scope and real-asset gates: `docs/validation.md`.

## Commands
Run from the repo root through the pinned Node wrapper, `bash scripts/use-node.sh <cmd>`. Do not change the system PATH. The machine is an 8 GB M2: do not run builds, training and browser tests in parallel.
- Dev server: `pnpm dev` (:3000). Production runtime: `pnpm --filter @sollish/web build:cloudflare`, then `pnpm --filter @sollish/web preview:cloudflare` (:3001).
- Unit and types: `pnpm --filter @sollish/protocol test`, `pnpm --filter @sollish/web test`, `pnpm --filter @sollish/web typecheck`.
- Browser tests against a running preview: `PLAYWRIGHT_SKIP_WEBSERVER=true PLAYWRIGHT_BASE_URL=http://localhost:3001 bash scripts/use-node.sh pnpm --filter @sollish/web test:browser <spec> --workers=1`.
- LIVE and backend: `pnpm --filter @sollish/realtime <script>` with `test:contact`, `test:ringside`, `test:arena` or `test:integration`, `pnpm test:database` (loopback cluster only), `pnpm test:operations`, `pnpm idl:check`, `bash scripts/test-contracts.sh`.
- `pnpm check:readiness`: exit 2 means the known gates are open (expected); exit 1 means evidence is missing or changed. Never add a flag that turns it into a pass.
- Training runners write to fixed output directories. Point new runs elsewhere so historical evidence is not overwritten.
- Deploy the web app only when the user asks: `build:cloudflare`, then `pnpm --filter @sollish/web exec wrangler deploy`. Verify the active version through the Cloudflare MCP. If the CLI returns HTTP 403, report it; do not bypass it.

## Git
There is no commit yet. The whole tree is untracked and has no other backup. Never `git clean`, `reset` or `checkout` over files. Run a secret scan before the first `git add`.

## Invariants
- Preserve SOLO and shared LIVE as distinct lifecycles. An accepted ticket keeps its original engine, model, rules and ledger. New behavior gets a new engine/policy id and namespace; never migrate economics silently.
- Keep game state, financial admission/settlement and presentation separate. Camera, FPS, reduced motion, hidden tabs and disconnected browsers cannot change a result or payout.
- Combat decisions see only observable fight data. They must not read wagers, exposure, balances, house profit or future seeds. Freeze rules, engine, policy, learning rule, initial weights and hyperparameters for a match (owner decision, 9 Oct 2026). Weights may change inside a match only through that frozen rule, deterministically, from observable outcomes, so the same seed and decision log reproduce the match.
- A learned policy needs real training and held-out evaluation evidence. Anatomy import and reactive rules are not learning; in-match learning must beat its non-learning copy on held-out opponents before it is claimed. Connectome superiority has not been shown; never describe a connectome as a transferred mind or a complete functional brain.
- Record dataset version, license, source hashes, filters and limitations. MaleCNS segment rows, weighted synapses and Codex neuron connections are different quantities.
- Use integer arithmetic and per-pool conservation for Ringside pools. No cross-market collateral, hidden subsidy, guaranteed return or guaranteed-profit claim. Make refunds, fees, ties and cutoff visible before admission. Test retries, duplicates, cutoff, restart and failed settlement as thoroughly as the success path.
- Keep secrets (`.env`, keypairs, `.tooling/secrets/`) and private session ids out of frontend assets, public tape, URLs, logs and commits. Third-party decision models have no transaction, wager, deployment or tool authority. Jev may only coach (a plan every 9 seconds); each answer is hashed into the published decision log, has a deterministic fallback, and keeps that engine DEMO-only.
- Reuse licensed models and libraries. Name animations as authored clips, procedural overlays or motion capture.
- Keep the real-asset gates closed until their protocol, oracle, privacy and payment validations pass. A new demo or a larger test count does not satisfy them.
- Prefer the connected Cloudflare/Supabase MCP and CLI for service work. The old VPS cleanup was a one-time action; it does not authorize deleting new data.

## Done means
Reproduce the failure first, then fix the root cause. A change is done when the same scenario passes in the real scene or runtime, the relevant checks above pass, and the evidence (command, result, build or version id) is in `ops/evidence/` or `docs/validation.md`. Report unit, local runtime, hosted and mainnet evidence separately. Local test success does not mean GitHub CI ran, and a test count or screenshot is not the user's visual acceptance. Do reversible local coding, research and verification without asking. Ask before payments, license purchases, new credentials, permanent deletion, deploys and anything on mainnet.
