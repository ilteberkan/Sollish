# NON-PRODUCTION experiment

This directory uses MagicBlock Labs' `solana-vrf-api` and `solana-vrf` from
https://github.com/magicblock-labs/solana-vrf at exact commit
`52b103c5d55d72e07456a445044b3c006cb87c1a`.

Those two packages inherit the Business Source License 1.1 in LICENSE.md.
Additional Use Grant: None. Stated Change Date: December 1, 2029.
Stated Change License: MIT. The license allows non-production use; this
experiment does not authorize production use. Its license terms must be
reviewed before any incorporation into a deployed Sollish program.

The separately published MIT `ephemeral-vrf-sdk` license does not apply to
these two packages. This experiment calls the official prover/verifier and
does not supply an independently implemented cryptographic algorithm.

The initialization authority's seed is a public test fixture. Never deploy
the recovery experiment program. That program has no wagering, custody, settlement, or token logic.

The optional `root-games-provider` host test target loads unmodified Sollish
House/Games SBF artifacts alongside the pinned provider SBF in a local LiteSVM.
The upstream prover/API remain dependencies of this separate non-production
workspace only. This does not link the BSL recovery verifier into the root
production programs. Test oracle keys and ProgramData authority are public VM
fixtures; queue transplantation is explicitly labeled and does not establish
live provider delivery or production licensing rights.
