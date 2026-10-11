// Generated from Anchor build IDLs. Run pnpm idl:sync; do not edit.
export const schema = {
  "house": {
    "address": "9bHnYHRGiNP8umiqtpAsALJYgcAJu3dKWVE1voGfqAu2",
    "instructions": {
      "initialize_player": {
        "discriminator": [
          79,
          249,
          88,
          177,
          220,
          62,
          56,
          128
        ],
        "accounts": [
          {
            "name": "player",
            "signer": true,
            "writable": true
          },
          {
            "name": "config",
            "signer": false,
            "writable": false
          },
          {
            "name": "player_ledger",
            "signer": false,
            "writable": true
          },
          {
            "name": "system_program",
            "signer": false,
            "writable": false
          }
        ],
        "args": []
      }
    },
    "accounts": {
      "BetReceipt": {
        "discriminator": [
          220,
          192,
          65,
          5,
          23,
          202,
          146,
          102
        ],
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "shard",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "max_gross",
            "type": "u64"
          },
          {
            "name": "reserved",
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      },
      "HouseConfig": {
        "discriminator": [
          194,
          237,
          216,
          79,
          135,
          254,
          7,
          212
        ],
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "game_program",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      },
      "HouseShard": {
        "discriminator": [
          180,
          36,
          200,
          55,
          132,
          153,
          46,
          51
        ],
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u16"
          },
          {
            "name": "buffer",
            "type": "u64"
          },
          {
            "name": "max_stake",
            "type": "u64"
          },
          {
            "name": "max_gross",
            "type": "u64"
          },
          {
            "name": "reserved",
            "type": "u64"
          },
          {
            "name": "open_bets",
            "type": "u64"
          },
          {
            "name": "total_bets",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      },
      "PlayerLedger": {
        "discriminator": [
          216,
          224,
          218,
          1,
          67,
          118,
          105,
          213
        ],
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "last_bet_id",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    "types": {
      "BetClosed": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "shard",
          "type": "pubkey"
        },
        {
          "name": "bet",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "payout",
          "type": "u64"
        },
        {
          "name": "returned_lamports",
          "type": "u64"
        }
      ],
      "BetReceipt": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "shard",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "max_gross",
          "type": "u64"
        },
        {
          "name": "reserved",
          "type": "u64"
        },
        {
          "name": "payout",
          "type": "u64"
        },
        {
          "name": "status",
          "type": "u8"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "BetReserved": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "shard",
          "type": "pubkey"
        },
        {
          "name": "bet",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "max_gross",
          "type": "u64"
        },
        {
          "name": "reserved",
          "type": "u64"
        },
        {
          "name": "shard_reserved",
          "type": "u64"
        }
      ],
      "BetSettled": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "shard",
          "type": "pubkey"
        },
        {
          "name": "bet",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "payout",
          "type": "u64"
        },
        {
          "name": "released_reserve",
          "type": "u64"
        },
        {
          "name": "shard_reserved",
          "type": "u64"
        }
      ],
      "FreeCollateralWithdrawn": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "shard",
          "type": "pubkey"
        },
        {
          "name": "authority",
          "type": "pubkey"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "remaining_free",
          "type": "u64"
        }
      ],
      "HouseConfig": [
        {
          "name": "authority",
          "type": "pubkey"
        },
        {
          "name": "game_program",
          "type": "pubkey"
        },
        {
          "name": "paused",
          "type": "bool"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "HouseInitialized": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "authority",
          "type": "pubkey"
        },
        {
          "name": "game_program",
          "type": "pubkey"
        }
      ],
      "HousePauseChanged": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "authority",
          "type": "pubkey"
        },
        {
          "name": "paused",
          "type": "bool"
        }
      ],
      "HouseShard": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "id",
          "type": "u16"
        },
        {
          "name": "buffer",
          "type": "u64"
        },
        {
          "name": "max_stake",
          "type": "u64"
        },
        {
          "name": "max_gross",
          "type": "u64"
        },
        {
          "name": "reserved",
          "type": "u64"
        },
        {
          "name": "open_bets",
          "type": "u64"
        },
        {
          "name": "total_bets",
          "type": "u64"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "PlayerInitialized": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "player_ledger",
          "type": "pubkey"
        }
      ],
      "PlayerLedger": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "last_bet_id",
          "type": "u64"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "ShardCreated": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "shard",
          "type": "pubkey"
        },
        {
          "name": "id",
          "type": "u16"
        },
        {
          "name": "funding",
          "type": "u64"
        },
        {
          "name": "buffer",
          "type": "u64"
        },
        {
          "name": "max_stake",
          "type": "u64"
        },
        {
          "name": "max_gross",
          "type": "u64"
        }
      ],
      "ShardFunded": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "shard",
          "type": "pubkey"
        },
        {
          "name": "funder",
          "type": "pubkey"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  },
  "games": {
    "address": "8V4v7SqwVqx6aZUf2kFwJWdbSKBhqn5vdR4YeqZsfcQJ",
    "instructions": {
      "close_coinflip": {
        "discriminator": [
          80,
          248,
          191,
          227,
          10,
          46,
          103,
          252
        ],
        "accounts": [
          {
            "name": "player",
            "signer": false,
            "writable": true
          },
          {
            "name": "house",
            "signer": false,
            "writable": false
          },
          {
            "name": "bet",
            "signer": false,
            "writable": true
          },
          {
            "name": "player_ledger",
            "signer": false,
            "writable": false
          },
          {
            "name": "activity",
            "signer": false,
            "writable": false
          }
        ],
        "args": []
      },
      "initialize_activity": {
        "discriminator": [
          67,
          88,
          153,
          230,
          74,
          132,
          121,
          191
        ],
        "accounts": [
          {
            "name": "player",
            "signer": true,
            "writable": true
          },
          {
            "name": "house",
            "signer": false,
            "writable": false
          },
          {
            "name": "activity",
            "signer": false,
            "writable": true
          },
          {
            "name": "system_program",
            "signer": false,
            "writable": false
          }
        ],
        "args": []
      },
      "place_coinflip": {
        "discriminator": [
          31,
          251,
          249,
          238,
          97,
          213,
          84,
          53
        ],
        "accounts": [
          {
            "name": "player",
            "signer": true,
            "writable": true
          },
          {
            "name": "house",
            "signer": false,
            "writable": false
          },
          {
            "name": "config",
            "signer": false,
            "writable": false
          },
          {
            "name": "shard",
            "signer": false,
            "writable": true
          },
          {
            "name": "house_bet",
            "signer": false,
            "writable": true
          },
          {
            "name": "player_ledger",
            "signer": false,
            "writable": true
          },
          {
            "name": "bet",
            "signer": false,
            "writable": true
          },
          {
            "name": "game_program",
            "signer": false,
            "writable": false
          },
          {
            "name": "house_authority",
            "signer": false,
            "writable": false
          },
          {
            "name": "program_identity",
            "signer": false,
            "writable": false
          },
          {
            "name": "oracle_queue",
            "signer": false,
            "writable": true
          },
          {
            "name": "vrf_program",
            "signer": false,
            "writable": false
          },
          {
            "name": "slot_hashes",
            "signer": false,
            "writable": false
          },
          {
            "name": "house_program",
            "signer": false,
            "writable": false
          },
          {
            "name": "system_program",
            "signer": false,
            "writable": false
          },
          {
            "name": "activity",
            "signer": false,
            "writable": false
          }
        ],
        "args": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "stake",
            "type": "u64"
          }
        ]
      },
      "place_coinflip_rewarded": {
        "discriminator": [
          186,
          104,
          79,
          244,
          112,
          200,
          151,
          144
        ],
        "accounts": [
          {
            "name": "game.player",
            "signer": true,
            "writable": true
          },
          {
            "name": "game.house",
            "signer": false,
            "writable": false
          },
          {
            "name": "game.config",
            "signer": false,
            "writable": false
          },
          {
            "name": "game.shard",
            "signer": false,
            "writable": true
          },
          {
            "name": "game.house_bet",
            "signer": false,
            "writable": true
          },
          {
            "name": "game.player_ledger",
            "signer": false,
            "writable": true
          },
          {
            "name": "game.bet",
            "signer": false,
            "writable": true
          },
          {
            "name": "game.game_program",
            "signer": false,
            "writable": false
          },
          {
            "name": "game.house_authority",
            "signer": false,
            "writable": false
          },
          {
            "name": "game.program_identity",
            "signer": false,
            "writable": false
          },
          {
            "name": "game.oracle_queue",
            "signer": false,
            "writable": true
          },
          {
            "name": "game.vrf_program",
            "signer": false,
            "writable": false
          },
          {
            "name": "game.slot_hashes",
            "signer": false,
            "writable": false
          },
          {
            "name": "game.house_program",
            "signer": false,
            "writable": false
          },
          {
            "name": "game.system_program",
            "signer": false,
            "writable": false
          },
          {
            "name": "game.activity",
            "signer": false,
            "writable": false
          },
          {
            "name": "reward_phase",
            "signer": false,
            "writable": true
          },
          {
            "name": "incentives_authority",
            "signer": false,
            "writable": false
          },
          {
            "name": "player_rewards",
            "signer": false,
            "writable": true
          },
          {
            "name": "epoch_state",
            "signer": false,
            "writable": true
          },
          {
            "name": "participant",
            "signer": false,
            "writable": true
          },
          {
            "name": "incentives_program",
            "signer": false,
            "writable": false
          }
        ],
        "args": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "epoch",
            "type": "u64"
          }
        ]
      },
      "settle_coinflip": {
        "discriminator": [
          69,
          57,
          200,
          136,
          7,
          34,
          236,
          112
        ],
        "accounts": [
          {
            "name": "player",
            "signer": false,
            "writable": true
          },
          {
            "name": "house",
            "signer": false,
            "writable": false
          },
          {
            "name": "config",
            "signer": false,
            "writable": false
          },
          {
            "name": "shard",
            "signer": false,
            "writable": true
          },
          {
            "name": "house_bet",
            "signer": false,
            "writable": true
          },
          {
            "name": "player_ledger",
            "signer": false,
            "writable": false
          },
          {
            "name": "bet",
            "signer": false,
            "writable": true
          },
          {
            "name": "game_program",
            "signer": false,
            "writable": false
          },
          {
            "name": "house_authority",
            "signer": false,
            "writable": false
          },
          {
            "name": "house_program",
            "signer": false,
            "writable": false
          },
          {
            "name": "activity",
            "signer": false,
            "writable": true
          }
        ],
        "args": []
      }
    },
    "accounts": {
      "CoinflipBet": {
        "discriminator": [
          209,
          19,
          149,
          64,
          38,
          110,
          9,
          25
        ],
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "house",
            "type": "pubkey"
          },
          {
            "name": "shard",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "max_gross",
            "type": "u64"
          },
          {
            "name": "request_tag",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "randomness",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "payout",
            "type": "u64"
          },
          {
            "name": "created_at",
            "type": "i64"
          },
          {
            "name": "settled_at",
            "type": "i64"
          },
          {
            "name": "hour_recorded",
            "type": "bool"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      },
      "CoinflipConfig": {
        "discriminator": [
          76,
          76,
          90,
          204,
          192,
          147,
          89,
          75
        ],
        "fields": [
          {
            "name": "house",
            "type": "pubkey"
          },
          {
            "name": "queue",
            "type": "pubkey"
          },
          {
            "name": "edge_bps",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      },
      "GamePlayerActivity": {
        "discriminator": [
          59,
          215,
          202,
          38,
          154,
          40,
          43,
          122
        ],
        "fields": [
          {
            "name": "house",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "total_wagered_lamports",
            "type": "u128"
          },
          {
            "name": "total_payout_lamports",
            "type": "u128"
          },
          {
            "name": "settled_bets",
            "type": "u64"
          },
          {
            "name": "last_settled_at",
            "docs": [
              "Maximum observed settlement timestamp, not an expiry or refund deadline."
            ],
            "type": "i64"
          },
          {
            "name": "current",
            "type": {
              "defined": {
                "name": "ActivityBucket"
              }
            }
          },
          {
            "name": "previous",
            "type": {
              "defined": {
                "name": "ActivityBucket"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    "types": {
      "ActivityBucket": [
        {
          "name": "epoch",
          "type": "u64"
        },
        {
          "name": "wagered_lamports",
          "type": "u128"
        },
        {
          "name": "bet_count",
          "type": "u64"
        }
      ],
      "ActivityInitialized": [
        {
          "name": "house",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "activity",
          "type": "pubkey"
        },
        {
          "name": "current_epoch",
          "type": "u64"
        }
      ],
      "CoinflipBet": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "house",
          "type": "pubkey"
        },
        {
          "name": "shard",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "max_gross",
          "type": "u64"
        },
        {
          "name": "request_tag",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "payout",
          "type": "u64"
        },
        {
          "name": "created_at",
          "type": "i64"
        },
        {
          "name": "settled_at",
          "type": "i64"
        },
        {
          "name": "hour_recorded",
          "type": "bool"
        },
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "status",
          "type": "u8"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "CoinflipClosed": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "house",
          "type": "pubkey"
        },
        {
          "name": "shard",
          "type": "pubkey"
        },
        {
          "name": "bet",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "max_gross",
          "type": "u64"
        },
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "winning_side",
          "type": "u8"
        },
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "request_tag",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "payout",
          "type": "u64"
        },
        {
          "name": "created_at",
          "type": "i64"
        },
        {
          "name": "settled_at",
          "type": "i64"
        },
        {
          "name": "hour_recorded",
          "type": "bool"
        },
        {
          "name": "returned_lamports",
          "type": "u64"
        }
      ],
      "CoinflipConfig": [
        {
          "name": "house",
          "type": "pubkey"
        },
        {
          "name": "queue",
          "type": "pubkey"
        },
        {
          "name": "edge_bps",
          "type": "u16"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "CoinflipInitialized": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "house",
          "type": "pubkey"
        },
        {
          "name": "queue",
          "type": "pubkey"
        },
        {
          "name": "edge_bps",
          "type": "u16"
        }
      ],
      "CoinflipPlaced": [
        {
          "name": "house",
          "type": "pubkey"
        },
        {
          "name": "shard",
          "type": "pubkey"
        },
        {
          "name": "bet",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "max_gross",
          "type": "u64"
        },
        {
          "name": "request_tag",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "created_at",
          "type": "i64"
        }
      ],
      "CoinflipReady": [
        {
          "name": "bet",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "request_tag",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ],
      "CoinflipSettled": [
        {
          "name": "house",
          "type": "pubkey"
        },
        {
          "name": "shard",
          "type": "pubkey"
        },
        {
          "name": "bet",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "payout",
          "type": "u64"
        },
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "winning_side",
          "type": "u8"
        },
        {
          "name": "settled_at",
          "type": "i64"
        },
        {
          "name": "hour_recorded",
          "type": "bool"
        }
      ],
      "GamePlayerActivity": [
        {
          "name": "house",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "total_wagered_lamports",
          "type": "u128"
        },
        {
          "name": "total_payout_lamports",
          "type": "u128"
        },
        {
          "name": "settled_bets",
          "type": "u64"
        },
        {
          "name": "last_settled_at",
          "docs": [
            "Maximum observed settlement timestamp, not an expiry or refund deadline."
          ],
          "type": "i64"
        },
        {
          "name": "current",
          "type": {
            "defined": {
              "name": "ActivityBucket"
            }
          }
        },
        {
          "name": "previous",
          "type": {
            "defined": {
              "name": "ActivityBucket"
            }
          }
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "HouseConfig": [
        {
          "name": "authority",
          "type": "pubkey"
        },
        {
          "name": "game_program",
          "type": "pubkey"
        },
        {
          "name": "paused",
          "type": "bool"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "HouseShard": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "id",
          "type": "u16"
        },
        {
          "name": "buffer",
          "type": "u64"
        },
        {
          "name": "max_stake",
          "type": "u64"
        },
        {
          "name": "max_gross",
          "type": "u64"
        },
        {
          "name": "reserved",
          "type": "u64"
        },
        {
          "name": "open_bets",
          "type": "u64"
        },
        {
          "name": "total_bets",
          "type": "u64"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "PlayerLedger": [
        {
          "name": "config",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "last_bet_id",
          "type": "u64"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "RewardPhase": [
        {
          "name": "house",
          "type": "pubkey"
        },
        {
          "name": "game_program",
          "type": "pubkey"
        },
        {
          "name": "mint",
          "type": "pubkey"
        },
        {
          "name": "token_program",
          "type": "pubkey"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "start_epoch",
          "type": "u64"
        },
        {
          "name": "end_epoch",
          "type": "u64"
        },
        {
          "name": "wager_budget",
          "type": "u64"
        },
        {
          "name": "rate_units_per_sol",
          "type": "u64"
        },
        {
          "name": "hourly_budget",
          "type": "u64"
        },
        {
          "name": "minimum_wager_lamports",
          "type": "u64"
        },
        {
          "name": "total_budget",
          "type": "u64"
        },
        {
          "name": "wager_allocated",
          "type": "u64"
        },
        {
          "name": "wager_claimed",
          "type": "u64"
        },
        {
          "name": "hourly_claimed",
          "type": "u64"
        },
        {
          "name": "credits_closed",
          "type": "bool"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ]
    }
  },
  "incentives": {
    "address": "E5tr12oarJumShYmXvohnSDJNVKrVGuKS4gLm6pdgfHv",
    "instructions": {
      "claim_hourly": {
        "discriminator": [
          198,
          215,
          71,
          211,
          231,
          171,
          141,
          186
        ],
        "accounts": [
          {
            "name": "transfer.player",
            "signer": true,
            "writable": true
          },
          {
            "name": "transfer.phase",
            "signer": false,
            "writable": true
          },
          {
            "name": "transfer.mint",
            "signer": false,
            "writable": false
          },
          {
            "name": "transfer.reward_vault",
            "signer": false,
            "writable": true
          },
          {
            "name": "transfer.player_tokens",
            "signer": false,
            "writable": true
          },
          {
            "name": "transfer.token_program",
            "signer": false,
            "writable": false
          },
          {
            "name": "epoch_state",
            "signer": false,
            "writable": true
          },
          {
            "name": "participant",
            "signer": false,
            "writable": true
          }
        ],
        "args": []
      },
      "claim_staking": {
        "discriminator": [
          13,
          254,
          54,
          79,
          128,
          120,
          129,
          63
        ],
        "accounts": [
          {
            "name": "player",
            "signer": true,
            "writable": false
          },
          {
            "name": "pool",
            "signer": false,
            "writable": true
          },
          {
            "name": "position",
            "signer": false,
            "writable": true
          },
          {
            "name": "mint",
            "signer": false,
            "writable": false
          },
          {
            "name": "reward_vault",
            "signer": false,
            "writable": true
          },
          {
            "name": "player_tokens",
            "signer": false,
            "writable": true
          },
          {
            "name": "token_program",
            "signer": false,
            "writable": false
          }
        ],
        "args": []
      },
      "claim_wager_rewards": {
        "discriminator": [
          186,
          42,
          208,
          14,
          55,
          20,
          205,
          1
        ],
        "accounts": [
          {
            "name": "transfer.player",
            "signer": true,
            "writable": true
          },
          {
            "name": "transfer.phase",
            "signer": false,
            "writable": true
          },
          {
            "name": "transfer.mint",
            "signer": false,
            "writable": false
          },
          {
            "name": "transfer.reward_vault",
            "signer": false,
            "writable": true
          },
          {
            "name": "transfer.player_tokens",
            "signer": false,
            "writable": true
          },
          {
            "name": "transfer.token_program",
            "signer": false,
            "writable": false
          },
          {
            "name": "player_rewards",
            "signer": false,
            "writable": true
          }
        ],
        "args": []
      },
      "initialize_staker": {
        "discriminator": [
          131,
          155,
          29,
          159,
          5,
          65,
          156,
          247
        ],
        "accounts": [
          {
            "name": "player",
            "signer": true,
            "writable": true
          },
          {
            "name": "pool",
            "signer": false,
            "writable": false
          },
          {
            "name": "position",
            "signer": false,
            "writable": true
          },
          {
            "name": "system_program",
            "signer": false,
            "writable": false
          }
        ],
        "args": []
      },
      "stake": {
        "discriminator": [
          206,
          176,
          202,
          18,
          200,
          209,
          179,
          108
        ],
        "accounts": [
          {
            "name": "player",
            "signer": true,
            "writable": false
          },
          {
            "name": "pool",
            "signer": false,
            "writable": true
          },
          {
            "name": "position",
            "signer": false,
            "writable": true
          },
          {
            "name": "mint",
            "signer": false,
            "writable": false
          },
          {
            "name": "principal_vault",
            "signer": false,
            "writable": true
          },
          {
            "name": "player_tokens",
            "signer": false,
            "writable": true
          },
          {
            "name": "token_program",
            "signer": false,
            "writable": false
          }
        ],
        "args": [
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      },
      "unstake": {
        "discriminator": [
          90,
          95,
          107,
          42,
          205,
          124,
          50,
          225
        ],
        "accounts": [
          {
            "name": "player",
            "signer": true,
            "writable": false
          },
          {
            "name": "pool",
            "signer": false,
            "writable": true
          },
          {
            "name": "position",
            "signer": false,
            "writable": true
          },
          {
            "name": "mint",
            "signer": false,
            "writable": false
          },
          {
            "name": "principal_vault",
            "signer": false,
            "writable": true
          },
          {
            "name": "player_tokens",
            "signer": false,
            "writable": true
          },
          {
            "name": "token_program",
            "signer": false,
            "writable": false
          }
        ],
        "args": [
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    "accounts": {
      "HourlyEpoch": {
        "discriminator": [
          121,
          143,
          208,
          22,
          150,
          170,
          79,
          255
        ],
        "fields": [
          {
            "name": "phase",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "total_wagered_lamports",
            "type": "u128"
          },
          {
            "name": "qualified_wallets",
            "type": "u64"
          },
          {
            "name": "qualified_wagered_lamports",
            "type": "u64"
          },
          {
            "name": "claimed_wallets",
            "type": "u64"
          },
          {
            "name": "sealed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      },
      "HourlyParticipant": {
        "discriminator": [
          238,
          99,
          43,
          119,
          142,
          112,
          128,
          25
        ],
        "fields": [
          {
            "name": "phase",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "wagered_lamports",
            "type": "u128"
          },
          {
            "name": "qualified",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      },
      "RewardPhase": {
        "discriminator": [
          120,
          178,
          99,
          197,
          149,
          251,
          177,
          168
        ],
        "fields": [
          {
            "name": "house",
            "type": "pubkey"
          },
          {
            "name": "game_program",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "token_program",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "start_epoch",
            "type": "u64"
          },
          {
            "name": "end_epoch",
            "type": "u64"
          },
          {
            "name": "wager_budget",
            "type": "u64"
          },
          {
            "name": "rate_units_per_sol",
            "type": "u64"
          },
          {
            "name": "hourly_budget",
            "type": "u64"
          },
          {
            "name": "minimum_wager_lamports",
            "type": "u64"
          },
          {
            "name": "total_budget",
            "type": "u64"
          },
          {
            "name": "wager_allocated",
            "type": "u64"
          },
          {
            "name": "wager_claimed",
            "type": "u64"
          },
          {
            "name": "hourly_claimed",
            "type": "u64"
          },
          {
            "name": "credits_closed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      },
      "RewardPlayer": {
        "discriminator": [
          121,
          4,
          148,
          33,
          235,
          169,
          73,
          41
        ],
        "fields": [
          {
            "name": "phase",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "pending",
            "type": "u64"
          },
          {
            "name": "total_credited",
            "type": "u64"
          },
          {
            "name": "total_claimed",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      },
      "StakePosition": {
        "discriminator": [
          78,
          165,
          30,
          111,
          171,
          125,
          11,
          220
        ],
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "pending",
            "type": "u64"
          },
          {
            "name": "checkpoint",
            "type": "u128"
          },
          {
            "name": "fraction",
            "type": "u128"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      },
      "StakingPool": {
        "discriminator": [
          203,
          19,
          214,
          220,
          220,
          154,
          24,
          102
        ],
        "fields": [
          {
            "name": "house",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "token_program",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "start_ts",
            "type": "i64"
          },
          {
            "name": "end_ts",
            "type": "i64"
          },
          {
            "name": "budget",
            "type": "u64"
          },
          {
            "name": "emitted",
            "type": "u64"
          },
          {
            "name": "allocated",
            "type": "u64"
          },
          {
            "name": "claimed",
            "type": "u64"
          },
          {
            "name": "total_staked",
            "type": "u64"
          },
          {
            "name": "reward_per_share",
            "type": "u128"
          },
          {
            "name": "emission_fraction",
            "type": "u128"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    "types": {
      "HourlyEpoch": [
        {
          "name": "phase",
          "type": "pubkey"
        },
        {
          "name": "epoch",
          "type": "u64"
        },
        {
          "name": "total_wagered_lamports",
          "type": "u128"
        },
        {
          "name": "qualified_wallets",
          "type": "u64"
        },
        {
          "name": "qualified_wagered_lamports",
          "type": "u64"
        },
        {
          "name": "claimed_wallets",
          "type": "u64"
        },
        {
          "name": "sealed",
          "type": "bool"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "HourlyParticipant": [
        {
          "name": "phase",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "epoch",
          "type": "u64"
        },
        {
          "name": "wagered_lamports",
          "type": "u128"
        },
        {
          "name": "qualified",
          "type": "bool"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "HourlyRewardClaimed": [
        {
          "name": "phase",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "epoch",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "qualified_wallets",
          "type": "u64"
        },
        {
          "name": "qualified_wagered_lamports",
          "type": "u64"
        },
        {
          "name": "wagered_lamports",
          "type": "u64"
        }
      ],
      "HouseConfig": [
        {
          "name": "authority",
          "type": "pubkey"
        },
        {
          "name": "game_program",
          "type": "pubkey"
        },
        {
          "name": "paused",
          "type": "bool"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "PoolInitialized": [
        {
          "name": "pool",
          "type": "pubkey"
        },
        {
          "name": "house",
          "type": "pubkey"
        },
        {
          "name": "mint",
          "type": "pubkey"
        },
        {
          "name": "token_program",
          "type": "pubkey"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "start_ts",
          "type": "i64"
        },
        {
          "name": "end_ts",
          "type": "i64"
        },
        {
          "name": "budget",
          "type": "u64"
        }
      ],
      "RewardPhase": [
        {
          "name": "house",
          "type": "pubkey"
        },
        {
          "name": "game_program",
          "type": "pubkey"
        },
        {
          "name": "mint",
          "type": "pubkey"
        },
        {
          "name": "token_program",
          "type": "pubkey"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "start_epoch",
          "type": "u64"
        },
        {
          "name": "end_epoch",
          "type": "u64"
        },
        {
          "name": "wager_budget",
          "type": "u64"
        },
        {
          "name": "rate_units_per_sol",
          "type": "u64"
        },
        {
          "name": "hourly_budget",
          "type": "u64"
        },
        {
          "name": "minimum_wager_lamports",
          "type": "u64"
        },
        {
          "name": "total_budget",
          "type": "u64"
        },
        {
          "name": "wager_allocated",
          "type": "u64"
        },
        {
          "name": "wager_claimed",
          "type": "u64"
        },
        {
          "name": "hourly_claimed",
          "type": "u64"
        },
        {
          "name": "credits_closed",
          "type": "bool"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "RewardPhaseArgs": [
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "start_epoch",
          "type": "u64"
        },
        {
          "name": "end_epoch",
          "type": "u64"
        },
        {
          "name": "wager_budget",
          "type": "u64"
        },
        {
          "name": "rate_units_per_sol",
          "type": "u64"
        },
        {
          "name": "hourly_budget",
          "type": "u64"
        },
        {
          "name": "minimum_wager_lamports",
          "type": "u64"
        }
      ],
      "RewardPhaseInitialized": [
        {
          "name": "phase",
          "type": "pubkey"
        },
        {
          "name": "house",
          "type": "pubkey"
        },
        {
          "name": "mint",
          "type": "pubkey"
        },
        {
          "name": "token_program",
          "type": "pubkey"
        },
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "RewardPhaseArgs"
            }
          }
        },
        {
          "name": "total_budget",
          "type": "u64"
        }
      ],
      "RewardPlayer": [
        {
          "name": "phase",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "pending",
          "type": "u64"
        },
        {
          "name": "total_credited",
          "type": "u64"
        },
        {
          "name": "total_claimed",
          "type": "u64"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "StakePosition": [
        {
          "name": "pool",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "pending",
          "type": "u64"
        },
        {
          "name": "checkpoint",
          "type": "u128"
        },
        {
          "name": "fraction",
          "type": "u128"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "Staked": [
        {
          "name": "pool",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "total_staked",
          "type": "u64"
        }
      ],
      "StakingClaimed": [
        {
          "name": "pool",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "total_claimed",
          "type": "u64"
        }
      ],
      "StakingPool": [
        {
          "name": "house",
          "type": "pubkey"
        },
        {
          "name": "mint",
          "type": "pubkey"
        },
        {
          "name": "token_program",
          "type": "pubkey"
        },
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "start_ts",
          "type": "i64"
        },
        {
          "name": "end_ts",
          "type": "i64"
        },
        {
          "name": "budget",
          "type": "u64"
        },
        {
          "name": "emitted",
          "type": "u64"
        },
        {
          "name": "allocated",
          "type": "u64"
        },
        {
          "name": "claimed",
          "type": "u64"
        },
        {
          "name": "total_staked",
          "type": "u64"
        },
        {
          "name": "reward_per_share",
          "type": "u128"
        },
        {
          "name": "emission_fraction",
          "type": "u128"
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ],
      "Unstaked": [
        {
          "name": "pool",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "total_staked",
          "type": "u64"
        }
      ],
      "WagerCredited": [
        {
          "name": "phase",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "bet",
          "type": "pubkey"
        },
        {
          "name": "epoch",
          "type": "u64"
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "reward",
          "type": "u64"
        },
        {
          "name": "qualified",
          "type": "bool"
        },
        {
          "name": "qualified_wallets",
          "type": "u64"
        },
        {
          "name": "qualified_wagered_lamports",
          "type": "u64"
        }
      ],
      "WagerRewardClaimed": [
        {
          "name": "phase",
          "type": "pubkey"
        },
        {
          "name": "player",
          "type": "pubkey"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  }
} as const;
