---
license: mit
task_categories:
  - text-classification
language:
  - en
pretty_name: Jev vs Luna PagerDuty trigger
size_categories:
  - 1K<n<10K
tags:
  - pagerduty
  - alerting
  - jev
  - typesafe
  - gpt-5.6-luna
  - vercel-ai-gateway
  - on-call
  - sre
---

# Jev vs Luna as a PagerDuty trigger

Synthetic checkout/payments log stream with gold labels from [PagerDuty alerting principles](https://response.pagerduty.com/oncall/alerting_principles/): **page only if a human must act now**. TypeSafe’s Jev (`typesafe-ai/jev`) and GPT-5.6 Luna (`openai/gpt-5.6-luna`) both ran on **Vercel AI Gateway**. There is no ERROR auto-page.

This is **not** production traffic and **not** the Loghub junk-filter benchmark.

- Write-up: https://github.com/reachjalil/jevlogs/blob/hf-benchmark/docs/article/jev-vs-luna-pagerduty.md
- Code: https://github.com/reachjalil/jevlogs/tree/hf-benchmark/benchmarks/pager

## Headline (seed 20260917, n=3000)

Recommended trigger: Jev v3 `page_now.probability >= 0.50` (one boolean; not discrete `urgency==page`).

| | Page recall | Page precision | False pages | INFO replica-lag paged | Est. USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Jev v1 urgency==page | 0.886 | 1.000 | 0 | 0/57 | $0.072 |
| Jev v1 p≥0.22 (same calls) | 1.000 | 1.000 | 0 | 57/57 | $0 |
| Jev v2 urgency==page | 1.000 | 0.726 | 189 | 57/57 | $0.087 |
| Jev v2 p≥0.50 | 1.000 | 1.000 | 0 | 57/57 | $0.087 |
| **Jev v3 p≥0.50** | **1.000** | **1.000** | **0** | **57/57** | **$0.062** |
| Luna | 0.962 | 1.000 | 0 | 46/57 | $0.320 |
| ERROR severity | 0.492 | 0.330 | 500 | 0/57 | 0 |

Luna content-filtered 130/155 injection-style user searches (Azure policy). Those rows are in `data/luna.jsonl` as `reason=unavailable` and are excluded from rates. Jev classified all 155 as `ignore`.

Confirm dollar figures on the Vercel AI Gateway dashboard. Prices were fetched at run time: Jev $0.042/M input, Luna $0.20 / $1.20.

![Recall vs precision](charts/pager_recall_precision.png)

![Traps](charts/pager_traps.png)

![Families](charts/pager_families.png)

![Spend](charts/pager_spend.png)

## Files

| Path | |
| --- | --- |
| `metrics.json` | v1 numbers |
| `metrics_v2.json` | v1 vs calibrated vs v2 vs Luna (recommended `page_now.p≥0.50`) |
| `metrics_v3.json` | single-question Jev (same trigger, fewer tokens) |
| `data/stream.jsonl` | Labeled logs (`gold_action`, `gold_page`, `family`, `trap`) |
| `data/jev.jsonl` | Jev v1 decisions |
| `data/jev_v2.jsonl` | Jev v2 (page_now + data_at_risk + urgency) |
| `data/jev_v3.jsonl` | Jev v3 (page_now only) |
| `data/luna.jsonl` | Luna decisions |
| `charts/*.png` | Charts |

## Reproduce

```sh
export AI_GATEWAY_API_KEY=...
node benchmarks/pager/generate.mjs
node benchmarks/pager/run.mjs
node benchmarks/pager/run-jev-v2.mjs
node benchmarks/pager/run-jev-v3.mjs
```
