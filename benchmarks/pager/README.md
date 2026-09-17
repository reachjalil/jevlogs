# PagerDuty trigger benchmark: Jev vs GPT-5.6 Luna

This is a **different question** from the Loghub junk-filter study.

TypeSafe’s Jev is a typed decision model (boolean / choice / score), sold as a fast “smart if-statement” and, on Vercel’s Gateway notes, for **scoring urgency or risk before an action**. PagerDuty’s own alerting rule is: **page only if a human must act now**. So the experiment is:

> We put Jev and Luna on the same synthetic checkout/payments log stream and asked each: should this fire PagerDuty?

Not “is this log junk.” Not “skip an LLM analysis branch.” A page trigger.

## Gold labels

Copied from [PagerDuty alerting principles](https://response.pagerduty.com/oncall/alerting_principles/):

| Gold action | Meaning | Examples in the stream |
| --- | --- | --- |
| `page` | Human must act within minutes | Checkout SLO burning 14x, payments processor down, crash loop with 502s, disk already full, 47-minute replica lag (INFO!), credential stuffing, revoked IAM key used, TLS hours left, fulfillment queue dead, checksum mismatch |
| `ticket` | Human should act later | Disk 80% / 48h to full, cert expires in 7 days, slow 1x SLO burn, one pod OOM with 5/6 ready |
| `ignore` | Notification, no action | Health 200, cache hits, successful deploys, expected `INVALID_COUPON` ERRORs, retried charges that succeeded |

The interesting traps:

- **ERROR that must not page** (invalid coupon, user not found, handled exception)
- **INFO that must page** (replica lag with data-loss risk)

3,000 lines, seed `20260917`. Synthetic. Not production.

## How we score

Both models see `{ service, severityText, severityNumber, body }`. There is **no** ERROR/FATAL auto-page.

Jev (`typesafe-ai/jev` via `experimental_evaluate` on Vercel AI Gateway, ZDR):

- `page_now` boolean (v1, v2, v3)
- `urgency` choice: `page` | `ticket` | `ignore` (v1, v2 only)
- `data_at_risk` boolean (v2 only)

Luna (`openai/gpt-5.6-luna` via `generateObject` on the **same** Gateway key): page_now + urgency.

**Recommended trigger:** `page_now.probability >= 0.50`. Do not ship `urgency == page` after loosening the prompt — v2 discrete urgency false-paged 189 ignores (122 successful deploys). Unavailable rows are excluded from rates.

Baselines: page every ERROR; page if the body matches `fail|error|exception|timeout|denied|refused|kill|panic|oom|crash`.

## Run

```sh
export AI_GATEWAY_API_KEY=...   # Gateway key only; never commit it
node benchmarks/pager/generate.mjs
node benchmarks/pager/run.mjs --pilot
node benchmarks/pager/run.mjs
node benchmarks/pager/run-jev-v2.mjs
node benchmarks/pager/run-jev-v3.mjs
node benchmarks/pager/run-jev-v2.mjs --metrics-only
uv run --with matplotlib --with numpy python benchmarks/pager/charts.py \
  benchmarks/pager/results/metrics_v2.json benchmarks/pager/results
```

`--fresh` ignores saved decisions. Default is resume. `--metrics-only` recomputes rates from saved JSONL with no new spend.

## Outputs

| Path | |
| --- | --- |
| `results/stream.jsonl` | labeled log stream (Hugging Face; not in git) |
| `results/jev.jsonl` / `luna.jsonl` | v1 decisions (Hugging Face) |
| `results/jev_v2.jsonl` / `jev_v3.jsonl` | tuned Jev decisions (Hugging Face) |
| `results/metrics.json` | v1 recall, precision, traps, spend |
| `results/metrics_v2.json` / `metrics_v3.json` | probability trigger vs discrete urgency vs Luna |
| `results/*.png` | charts |

Luna: 2,870 scored + 130 Azure-filtered injection rows. Agreement on page/no-page: **98.1%** of scored rows.

Dataset: [reachjalil/jev-luna-pagerduty-trigger](https://huggingface.co/datasets/reachjalil/jev-luna-pagerduty-trigger). Write-up: [`docs/article/jev-vs-luna-pagerduty.md`](../../docs/article/jev-vs-luna-pagerduty.md).
