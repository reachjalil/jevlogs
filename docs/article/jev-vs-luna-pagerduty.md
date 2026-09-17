# Jev vs Luna as a PagerDuty trigger

We put TypeSafe’s Jev and GPT-5.6 Luna on the **same** synthetic checkout/payments log stream and asked each: **should this page a human right now?**

That is the job TypeSafe describes (typed urgency/risk before an action) and the rule PagerDuty publishes (page only if a human must act). It is **not** the earlier Loghub study, which asked whether a line was junk worth skipping before an LLM. Both models used **Vercel AI Gateway** and the same `AI_GATEWAY_API_KEY`. No OpenAI key. No ERROR/FATAL auto-page.

- Jev: [`typesafe-ai/jev`](https://vercel.com/ai-gateway/models/jev) via `experimental_evaluate`
- Luna: [`openai/gpt-5.6-luna`](https://vercel.com/ai-gateway/models/gpt-5.6-luna) via `generateObject`
- Labels: [PagerDuty alerting principles](https://response.pagerduty.com/oncall/alerting_principles/)
- Dataset: [reachjalil/jev-luna-pagerduty-trigger](https://huggingface.co/datasets/reachjalil/jev-luna-pagerduty-trigger)

Synthetic. Seed `20260917`. Not production logs.

## Stream

3,000 lines.

| Gold action | n | Meaning |
| ---: | ---: | --- |
| page | 500 | Human must act in minutes (checkout SLO 14x burn, payments down, crash loop with 502s, disk already full, 47-minute replica lag, credential stuffing, revoked key used, TLS hours left, dead fulfillment queue, checksum mismatch) |
| ticket | 250 | Act later (disk 80% / 48h, cert in 7 days, slow 1x burn, one pod OOM with 5/6 ready) |
| ignore | 2,250 | Notification (health checks, deploys, cache hits, expected `INVALID_COUPON` ERRORs) |

Traps the old “ERROR means page” heuristic fails:

- **500 ERROR lines that must not page**
- **254 INFO/WARN lines that must page** (including 57 replica-lag INFO lines)

## Live spend (Gateway list prices × logged tokens)

Confirm on the Vercel dashboard. Figures are from successful calls in the JSONL.

| | Calls | Input tokens | Output tokens | Estimated USD |
| --- | ---: | ---: | ---: | ---: |
| Jev v1 | 3,000 | 1,709,333 | 168,000 | **$0.072** |
| Jev v2 (3 questions) | 3,000 | 2,075,333 | 225,000 | **$0.087** |
| **Jev v3 (page_now only)** | 3,000 | 1,481,333 | 63,000 | **$0.062** |
| Luna | 2,870 | 1,029,899 | 95,316 | **$0.320** |

130 Luna rows (all `injection_noise` user-search strings) were Azure content-filtered. They are excluded from rates. Jev scored all 155 injection lines `ignore`.

Fetched prices: Jev $0.042 / M input, output $0. Luna $0.20 / $1.20.

## Headline

| | Page recall | Page precision | False pages | INFO replica-lag paged | Est. USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Jev v1 discrete urgency | 0.886 | 1.000 | 0 | 0/57 | $0.072 |
| **Jev v1 + p ≥ 0.22** (same calls) | **1.000** | **1.000** | **0** | **57/57** | $0 |
| Jev v2 discrete urgency | 1.000 | 0.726 | 189 (mostly successful deploys) | 57/57 | $0.087 |
| Jev v2 + p ≥ 0.50 | 1.000 | 1.000 | 0 | 57/57 | $0.087 |
| **Jev v3 + p ≥ 0.50** (one question) | **1.000** | **1.000** | **0** | **57/57** | **$0.062** |
| Luna (unchanged) | 0.962 | 1.000 | 0 | 46/57 | $0.320 |
| ERROR severity | 0.492 | 0.330 | 500 | 0/57 | 0 |

**Recommended pager:** one boolean `page_now` with INFO-not-veto instructions, fire if `page_now.probability >= 0.50`. That is TypeSafe’s workflow style: use the probability, do not take a discrete `urgency` argmax as gospel. v3 is the cheap form of that rule. v2 is useful if you want a `data_at_risk` bit for the ticket text.

## How we tuned Jev

v1 already **knew** the 47-minute replica lag was hotter than a 12-second lag (`page_now` 0.24–0.31 vs 0.11–0.13). The discrete `urgency=ticket` threw that gap away.

1. **Cheapest fix (no new Jev calls):** page if `urgency==page` **or** `page_now.p ≥ 0.22`. On this stream that is 100% / 100%. The cut sits above one-pod OOM (max 0.20). It is **in-sample**; do not ship 0.22 as a universal constant.
2. **Live v2 (~$0.087):** add a `data_at_risk` boolean and say INFO is not a veto. Replica-lag `page_now` jumped to 0.89–0.93. But discrete `urgency=page` then false-paged **122 successful deploys**. Shouting at the model made the choice head noisier.
3. **Live v3 (~$0.062):** drop urgency and `data_at_risk`. One boolean, same INFO-not-veto text. Gold pages sit at 0.70–0.98; noise ≤0.18. `p ≥ 0.50` is 100% / 100%, cheaper than v1, and still beats Luna’s 96.2% recall.

Do not “fine-tune” by paging whenever Jev says `urgency=page` after you loosen the prompt. Extra questions cost tokens; they are not what made recall recover.

Jev and Luna **agree on the page/no-page bit 98.1%** of the 2,870 rows Luna actually answered.

## What that means

Paging on ERROR is a bad pager. It catches less than half the incidents we planted and wakes people for expected validation noise.

Both models, asked the PagerDuty question with a **discrete** page bit, had **zero false pages** in v1. After tuning, **Jev v3 with `page_now.p ≥ 0.50` catches every planted page, including all 57 INFO replica-lag lines, still with zero false pages**, cheaper and faster than Luna.

v1 discrete Jev still misses only that replica-lag family if you ship `urgency==page` with no probability rule. Do not ship v2 discrete urgency: it pages successful deploys.

## Per page-family (pages)

| Family | n | Jev v1 urgency | Jev v3 p≥0.50 | Luna |
| --- | ---: | ---: | ---: | ---: |
| checkout_slo_burn | 50 | 50 | 50 | 50 |
| payments_processor_down | 47 | 47 | 47 | 47 |
| crash_loop_user_impact | 48 | 48 | 48 | 48 |
| disk_full_writes_failing | 55 | 55 | 55 | 55 |
| credential_stuffing | 48 | 48 | 48 | 48 |
| revoked_key_used | 51 | 51 | 51 | 51 |
| checksum_corruption | 45 | 45 | 45 | 45 |
| queue_backup_checkout | 50 | 50 | 50 | 50 |
| tls_hours_left_serving | 49 | 49 | 49 | 41 |
| replica_lag_data_risk (INFO) | 57 | **0** | **57** | **46** |

Ticket families (disk in 48h, cert in 7 days, single-pod OOM, CPU with no SLO burn): both models **did not page**. That matches PagerDuty’s own examples.

## Limitations

Invented SaaS logs, not your production stream. Families are templated; a keyword rule tuned to this file would cheat. Luna `reasoningEffort: 'low'`. Unavailable Luna rows fail-closed in the JSONL and are dropped from rates. Jev output tokens are logged; the Gateway Jev page prices output at $0.

Reproduce:

```sh
export AI_GATEWAY_API_KEY=...
node benchmarks/pager/generate.mjs
node benchmarks/pager/run.mjs
node benchmarks/pager/run-jev-v2.mjs
node benchmarks/pager/run-jev-v3.mjs
```

v3 asks only `page_now` (same instructions as v2) and fires on `p>=0.50`. That is the cheaper form of the same pager.
