# Jev vs GPT-5.6 Luna on the same logs, same Gateway

This is the counterpart write-up for people who will send logs to a cheap high-volume model anyway. The model is OpenAI’s **GPT-5.6 Luna**. The bill goes through **Vercel AI Gateway**, using the same `AI_GATEWAY_API_KEY` as Jev. There is no direct OpenAI key in this benchmark.

- Gateway model: [`openai/gpt-5.6-luna`](https://vercel.com/ai-gateway/models/gpt-5.6-luna)
- OpenAI card: [`gpt-5.6-luna`](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- Family: [GPT-5.6 Sol / Terra / Luna](https://openai.com/index/gpt-5-6/)
- Jev: [`typesafe-ai/jev`](https://vercel.com/ai-gateway/models/jev)
- Code: `benchmarks/luna-side-by-side.mjs` in [reachjalil/jevlogs](https://github.com/reachjalil/jevlogs)

This is not a production-log study. Labels are Loghub HDFS (block-level) and BGL (line-level alerts). Classifier numbers below come from `benchmarks/results/e9_luna_metrics.json` (created 2026-09-17T08:25:44Z).

## What we compared

Both systems see the same sanitized JSON `{ body, severityText, severityNumber }`. ERROR / FATAL / CRITICAL never reach a model (same local rule as jevlogs). For the rest:

1. **Jev** answers three typed questions (`experimental_evaluate`).
2. **Luna** answers the same three ideas through **structured output** (`generateObject` + JSON schema) on Gateway: `actionable` (boolean), `actionableProbability` (0–1), `priority` (`critical|high|normal|low`), `value` (0–100).
3. The **same local retain rule** is applied: retain only if priority is `low`, value ≤ 25, and probability < 0.1.

Luna is not wrapped in jevlogs. It is a second model on the same key, so cost and routing can be compared without mixing providers.

Gateway calls set `providerOptions.gateway.zeroDataRetention = true` and `openai.reasoningEffort = 'low'`. Logs are treated as untrusted data. Prompt text tells the model to ignore instructions embedded in the line.

## Gateway prices fetched at run time

On 2026-09-17 the Luna Gateway page parsed as **$0.20 / million input** and **$1.20 / million output** (`List pricing is $0.2 per million input tokens and $1.2 per million output tokens`). That matches the [OpenAI model card](https://developers.openai.com/api/docs/models/gpt-5.6-luna). Jev on the same Gateway is **$0.042 / million input**, output $0 on that page.

Those are list prices Gateway mirrors. Confirm any dollar figure on the Gateway dashboard.

## 20-record Gateway pilot (measured)

File: `benchmarks/results/e9_luna_pilot.jsonl`. Seed `20260916`. 10 HDFS + 10 BGL from the same stratified sample. This is the `--fresh` pilot that preceded the 400-line run (Jev idle).

| | |
| --- | ---: |
| Records | 20 |
| Protected locally (no model) | 5 |
| Structured Luna answers | 15 |
| Unavailable | 0 |
| Luna mean input tokens | 294.1 |
| Luna mean output tokens | 48.9 |
| p50 wall time (model rows) | 3.8 s |
| Estimated Luna spend | **$0.00176** |
| Routes | all `analyze` |

One example (HDFS): `value` 75, `priority` high, `actionable` true, `actionableProbability` 0.78 (`Got exception while serving [BLOCK]`). That is a different shape from Jev on this sample, where default retain is rare because scores sit just above 25, not because Jev calls the line an incident.

Pilot extrapolation for ~668 remaining non-protected calls: **~$0.08**. The 400-line run landed at **$0.081224**. Under the $8 stop.

## Cost as estimates (Luna as the downstream model)

This part does **not** require Luna to classify. It asks: if the analysis model is Luna, does Jev save money?

`estimateSavings()` with illustrative 300 input / 50 output tokens per log, 1 million logs, Jev mean ~537 input tokens, prices above:

- Send every log to Luna: `300×0.20 + 50×1.20` = **$120**
- Jev tax if you still send everything: ~537×0.042 = **~$22.55** extra → **~$142.55** (−19%)
- Jev pays for itself against Luna only if the analyze fraction drops below `1 − 22.55/120 ≈ 0.81` (you have to **skip ~19%** of lines)

On the HDFS sample Jev retained **0.84%**. That is not enough to cover Jev’s own tokens against Luna. Against Terra or Sol the downstream bill is larger, so the skip fraction you need is smaller — still more than 0.84% at these token assumptions.

This is the useful counterpart. Luna is the model you would actually dump a log firehose on. Jev is cheap. It only wins if it actually filters.

## Side-by-side routing (400 / dataset, measured)

Same Gateway path as the pilot, run after Jev finished. Stratified 400-line slice per dataset from the seed `20260916` sample (120 labeled anomalies each). Same local retain rule.

| | HDFS Luna | HDFS Jev (same 400) | BGL Luna | BGL Jev (same 400) |
| --- | ---: | ---: | ---: | ---: |
| Anomaly recall | 0.8333 (100/120) | 0.9917 (119/120) | 1.0000 | 1.0000 |
| Routing rate (`retain`) | 0.1400 | 0.0100 | 0.0200 | 0.0075 |
| Precision of `retain` | 0.6429 | — | 1.0000 | — |
| Protected locally | 0 | 0 | 132 | 132 |
| Unavailable (Gateway 503 / abort) | 0 | 0 | 31 | 0 |
| Route agreement | 0.865 |  | 0.9725 |  |
| p50 / p95 latency | 5.1 s / 13.6 s | — | 7.4 s / 17.9 s | — |
| Mean in / out tokens | 299 / 40 | — | 290 / 79 | — |

Spend for the classifier job: **652** Luna calls with usage, **192,676** input tokens, **35,574** output tokens, estimated **$0.081224** at Gateway $0.20 / $1.20. About **$0.000125** per Luna call vs **~$0.000013** if you billed Jev on Luna’s prompt size.

Charts: `luna_vs_jev_recall.png`, `luna_vs_jev_retain.png`, `luna_vs_jev_call_cost.png`.

### What the disagreement is

On **HDFS**, Luna retained 56 lines (14%). Jev retained 4 of the same 400 (1%). 54 route disagreements:

- 33: Jev `analyze`, Luna `retain`, label **normal**
- 20: Jev `analyze`, Luna `retain`, label **anomaly**
- 1: Jev `retain`, Luna `analyze`, label **anomaly**

The 20 Luna “misses” are block-labeled lines that look routine: `PacketResponder … terminating`, `Deleting block`, `NameSystem.delete … invalidSet`. Luna scored them `priority=low`, `value` 15–25, probability 0.02–0.08 — so the retain rule fired. Jev’s value scores on this sample sit just above 25, so the same rule almost never fires. HDFS labels are **block**-level; a terminating packet responder on an anomalous block is not the same as dropping a crash line.

On **BGL**, both stay at 100% recall. 132 lines never reached a model (ERROR/FATAL). Luna retained 8 normals (2%). 31 Gateway 503/abort rows, all label **normal**, recorded as `analyze`. Excluding them, retain is 2.17% and anomaly recall is unchanged.

Luna’s HDFS model answers were almost all `priority=low` (386/400) with mean value **23.9**. BGL model answers were mostly `high`/`normal` (mean value **68.6**). Structured Luna is willing to call a line low-value. Typed Jev, with this rubric, is not.

The cost story does not flip. Luna as a **classifier** is ~10× Jev per call. Luna as the **downstream** model still needs ~19% skip before Jev’s own tokens pay for themselves. Luna retained 14% on this HDFS slice — closer to that break-even than Jev’s 1% — and paid for it with 20 labeled-block misses.

## How to rerun

```sh
pnpm install --frozen-lockfile && pnpm build
export AI_GATEWAY_API_KEY=...          # Gateway key only
node benchmarks/run.mjs --prepare      # if inputs_*.jsonl are missing
node benchmarks/luna-side-by-side.mjs  # 400 / dataset; add --full for 2,500
node benchmarks/run.mjs --metrics-only
```

Never commit the key. Confirm spend on the Gateway dashboard.

## Limitations

Structured Luna output is not Jev. Probability is whatever Luna puts in the JSON field; it is not Jev’s typed boolean probability. `reasoningEffort: 'low'` is a cost/latency choice, not OpenAI’s default. HDFS labels are block-level. The 400-line slice is still 30% anomalous by design. Gateway 503s are recorded as `unavailable` (analyze), which is conservative for recall and bad for a retain-rate comparison if they are common.
