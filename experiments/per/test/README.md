# Two separate kinds of evidence

`npm test` runs **82 pure Node tests**. `helpers/synthetic-artifacts.mjs` reads only checked-in public source, IDL, Cargo.lock and the report shape. Its deliberately fake ELF-header bytes and in-memory report are marked `SYNTHETIC`; they exercise validation and client behavior, not compilation or executable correctness. It never reads the ignored `program/target/deploy/per_probe.so` or private program/payer keys. The 82 tests retain the existing integrity rejection cases.

`npm run test:clean` creates a disposable source-only tree, links installed dependencies, and runs those same 82 tests with no `program/target` directory or `.tooling` keys. It also verifies that the unchanged production `loadArtifacts()` rejects the absent real ELF. The original local build and keys are not moved, copied, or deleted. Temporary own test identities are generated only within disposable test directories.

`npm run test:artifacts` runs a **separate actual-artifact test** against `program/target/deploy/per_probe.so`, the actual source/lock/IDL hashes and the checked-in local build report. Missing or stale artifacts fail; there is no skip or synthetic fallback. It checks the pinned ELF64 little-endian SBF v2 header (`EM_SBPF=263`), but does not build/deploy, access private keys, execute PER, or prove a source-to-binary reproducible build. Run it after the existing local build/verification workflow.

The Ubuntu `per-client` CI job runs pure Node tests only. No private program identity key should be sent to CI and no CI-built probe or live-provider verification is claimed. Production artifact-loading/deployment guards are unchanged.

The suite now also covers before-broadcast fee reservation and fsync journals, exact returned-signature binding, malformed/expired confirmations, bounded JWT scheduling metadata, and the isolated paced buffer uploader. Unverified JWT timestamps only shorten a local deadline; they do not verify identity or attestation. Fake RPC tests never send live transactions.

Explicit initialized-only continuation tests bind all three finalized transaction signatures/messages to the canonical instructions and reject changed accounts, pending/unknown statuses or any delegation PDA. Per-origin600ms pacing is tested with injected clocks; node relay retries reuse one signed message, while the application never re-signs an uncertain action.
