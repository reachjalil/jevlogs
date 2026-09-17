# Jev Logs log-triage benchmark

Reproducible evaluation of the **local jevlogs 0.3.0 build** (`../dist/index.js` after `pnpm build`) on labeled public logs (Loghub HDFS_v1 and BGL via Hugging Face). Live calls use a measured `experimental_evaluate` wrapper (the pattern in `skills/jevlogs/examples/measured-evaluator.ts`) so token usage and latency are recorded, not assumed. E1–E5 run with `cache: false` and no `rules`. E7–E8 use the 0.3.0 default cache and a small retain-rule set.

npm may still show `jevlogs@0.2.0`. This directory does not import that package.

## One command

Requires Node.js 22+, `uv` (for PyArrow sampling and matplotlib charts), and the `hf` CLI. Run from the **repository root** (the worktree that contains `src/` and `pnpm-lock.yaml`):

```sh
pnpm install --frozen-lockfile && pnpm build
export AI_GATEWAY_API_KEY=...   # your Vercel AI Gateway key; never commit it
node benchmarks/run.mjs
```

`run.mjs` downloads the parquet shards (cached under `benchmarks/.cache/`), hash-samples 2,500 records per dataset at seed `20260916` with a 30% anomalous mix, sanitizes bodies, runs a 20-record pilot, then E1–E8. It stops live calls if estimated spend from logged input tokens reaches **$8**. Resume is the default: existing decision JSONL is not re-scored.

Useful flags:

| Flag | Behavior |
| --- | --- |
| `--prepare` | Download, sample, sanitize. No Gateway calls. |
| `--pilot` | Live 20-record probe, then stop. |
| `--resume` | Skip records already in decision JSONL (default). |
| `--fresh` | Ignore existing decision JSONL. |
| `--metrics-only` | Recompute `metrics.json` and PNG charts from saved JSONL. |

## What it costs

Jev list price is fetched at run time from https://vercel.com/ai-gateway/models/jev (input billed, output $0 on that page). A 20-record pilot on 2026-09-16 measured **~536 input tokens per model call**. The full E1–E8 run logged **6,841** Jev calls with usage, **3,665,677** input tokens, and an estimated **$0.153958** at the fetched $0.042 per million input price. Confirm that figure on the Vercel AI Gateway dashboard. The $8 stop was not approached.

Protected ERROR/FATAL records do not call Jev. On BGL that is most labeled alerts; on HDFS it is none. Cache hits also skip the model; that saving is large on repetitive HDFS templates and small on more varied BGL lines.

## Outputs

| Path | Committed? |
| --- | --- |
| `results/metrics.json` | yes |
| `results/*.png` | yes |
| `results/*.stats.json` | yes |
| `results/*.jsonl` | no (Hugging Face only; can be large) |
| `.cache/` | no |

Public artifacts: dataset [`reachjalil/jevlogs-log-triage-benchmark`](https://huggingface.co/datasets/reachjalil/jevlogs-log-triage-benchmark), Space [`reachjalil/jevlogs-triage-explorer`](https://huggingface.co/spaces/reachjalil/jevlogs-triage-explorer), collection [Jev Logs: log triage with Jev](https://huggingface.co/collections/reachjalil/jev-logs-log-triage-with-jev-6aab8a1c641f647b3c6eea22).

## License of the source logs

HDFS_v1 and BGL come from [Loghub](https://github.com/logpai/loghub), also mirrored as [`logfit-project/HDFS_v1`](https://huggingface.co/datasets/logfit-project/HDFS_v1) and [`logfit-project/BGL`](https://huggingface.co/datasets/logfit-project/BGL) (`license: other`). Loghub permits research/academic use and distribution of copies if the license notice and citation travel with the data. The published dataset includes that notice and sanitized line text plus source offsets and SHA-256 hashes of the original `content` field.
