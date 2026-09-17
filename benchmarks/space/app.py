"""
CPU-only explorer for the Jev Logs log-triage benchmark.
Loads saved decisions from the public dataset. Makes no live model calls.
"""
from __future__ import annotations

import json
from functools import lru_cache

import gradio as gr
import pandas as pd
from huggingface_hub import hf_hub_download

DATASET = "reachjalil/jevlogs-log-triage-benchmark"
GITHUB = "https://github.com/reachjalil/jevlogs"
THRESHOLD_DEFAULT = 0.1
VALUE_MAX_FOR_RETAIN = 25


def _download(name: str) -> str:
    return hf_hub_download(repo_id=DATASET, repo_type="dataset", filename=name)


@lru_cache(maxsize=1)
def load_metrics() -> dict:
    with open(_download("metrics.json"), encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=4)
def load_e1(dataset: str) -> pd.DataFrame:
    path = _download(f"data/e1_{dataset}.jsonl")
    return pd.read_json(path, lines=True)


def route_from_row(row: pd.Series, threshold: float) -> str:
    if row.get("reason") == "protected" or bool(row.get("protected_input")):
        return "analyze"
    if row.get("reason") == "unavailable" or pd.isna(row.get("actionableProbability")):
        return "analyze"
    p = row.get("actionableProbability")
    value = row.get("value")
    priority = row.get("priority")
    if p < threshold and value <= VALUE_MAX_FOR_RETAIN and priority == "low":
        return "retain"
    return "analyze"


def summarize(df: pd.DataFrame, threshold: float) -> dict:
    routed = df.apply(lambda row: route_from_row(row, threshold), axis=1)
    work = df.assign(route_at=routed)
    anomaly = work[work["label"] == "anomaly"]
    retain = work[work["route_at"] == "retain"]
    recall = float((anomaly["route_at"] == "analyze").mean()) if len(anomaly) else None
    routing = float((work["route_at"] == "retain").mean()) if len(work) else None
    precision = float((retain["label"] == "normal").mean()) if len(retain) else None
    return {
        "n": int(len(work)),
        "anomaly_n": int(len(anomaly)),
        "anomaly_recall": recall,
        "routing_rate_retain": routing,
        "precision_retain": precision,
        "analyze_rate": 1 - routing if routing is not None else None,
    }


def estimate_savings(
    logs: float,
    tokens_per_log: float,
    output_tokens_per_log: float,
    llm_input: float,
    llm_output: float,
    retained_fraction: float,
    jev_input: float,
    question_tokens: float,
) -> dict:
    baseline = logs * (tokens_per_log * llm_input + output_tokens_per_log * llm_output) / 1e6
    triage = logs * (tokens_per_log + question_tokens) * jev_input / 1e6
    with_jev = triage + baseline * retained_fraction
    savings = baseline - with_jev
    percent = (savings / baseline * 100) if baseline else 0
    return {
        "baseline": baseline,
        "triage": triage,
        "withJev": with_jev,
        "savings": savings,
        "percent": percent,
    }


def metrics_tables():
    m = load_metrics()
    e1 = m["e1_baseline"]
    rows = []
    for ds in ("hdfs", "bgl"):
        s = e1[ds]
        rows.append({
            "dataset": ds,
            "n": s["n"],
            "anomaly_n": s["anomaly_n"],
            "anomaly_recall": s["anomaly_recall"],
            "routing_rate_retain": s["routing_rate_retain"],
            "precision_retain": s["precision_retain"],
            "protected_share_of_anomalies": s["protected_share_of_anomalies"],
            "unavailable_n": s["unavailable_n"],
            "latency_p50_ms": s["latency_ms"]["all_p50"],
            "latency_p95_ms": s["latency_ms"]["all_p95"],
            "mean_input_tokens": s["tokens"]["mean_input"],
        })
    sweep_rows = []
    for ds, points in m["e2_threshold_sweep"].items():
        for p in points:
            sweep_rows.append({"dataset": ds, **p})
    feat_rows = []
    for key, label in (("e7_cache", "E7 cache"), ("e8_rules", "E8 rules")):
        block = m.get(key) or {}
        for ds in ("hdfs", "bgl"):
            s = block.get(ds) or {}
            routing = s.get("routing") or {}
            feat_rows.append({
                "experiment": label,
                "dataset": ds,
                "cache_hit_rate": s.get("cache_hit_rate"),
                "model_calls_with_tokens": s.get("model_calls_with_tokens"),
                "rule_n": s.get("rule_n"),
                "labeled_anomalies_retained_by_rule_n": s.get("labeled_anomalies_retained_by_rule_n"),
                "anomaly_recall": routing.get("anomaly_recall"),
                "routing_rate_retain": routing.get("routing_rate_retain"),
            })
    spend = m.get("spend", {})
    intro = (
        f"Package under test: `{m.get('package_under_test')}`. "
        f"Seed `{m.get('seed')}`. "
        f"Estimated Jev spend from logged tokens: ${spend.get('estimated_spend_usd', 'n/a')} "
        f"({spend.get('input_tokens', 'n/a')} input tokens, "
        f"{spend.get('jev_calls_with_usage', 'n/a')} calls with usage). "
        "Confirm on the Vercel AI Gateway dashboard. "
        "HDFS labels are block-level, not line-level. "
        "BGL labels are line-level alerts. "
        "The sample oversamples anomalies (~30%); it is not a production mix. "
        "Cache hit rate depends on how repetitive the workload is."
    )
    return intro, pd.DataFrame(rows), pd.DataFrame(sweep_rows), pd.DataFrame(feat_rows)


def sweep_view(dataset: str, threshold: float):
    df = load_e1(dataset)
    current = summarize(df, threshold)
    points = []
    for t in (0.05, 0.1, 0.2, 0.3, 0.5, threshold):
        points.append({"retainBelow": t, **summarize(df, t)})
    table = pd.DataFrame(points).drop_duplicates(subset=["retainBelow"]).sort_values("retainBelow")
    plot_df = table.rename(columns={
        "routing_rate_retain": "routing_rate_retain",
        "anomaly_recall": "anomaly_recall",
    })[["routing_rate_retain", "anomaly_recall", "retainBelow"]]
    missed = df[(df["label"] == "anomaly")].copy()
    missed["route_at"] = missed.apply(lambda row: route_from_row(row, threshold), axis=1)
    missed = missed[missed["route_at"] == "retain"][
        ["id", "original_level", "severityText", "value", "priority", "actionableProbability", "body"]
    ].head(25)
    return current, table, plot_df, missed


def savings_view(
    logs, tokens_per_log, output_tokens, llm_in, llm_out, analyze_rate, jev_in, question_tokens, include_unfiltered
):
    measured = estimate_savings(logs, tokens_per_log, output_tokens, llm_in, llm_out, analyze_rate, jev_in, question_tokens)
    rows = [{"scenario": "slider analyze rate", **measured}]
    if include_unfiltered:
        rows.append({
            "scenario": "nothing filtered (Jev overhead visible)",
            **estimate_savings(logs, tokens_per_log, output_tokens, llm_in, llm_out, 1.0, jev_in, question_tokens),
        })
    note = (
        "Estimate only, using the same formula as jevlogs.estimateSavings(). "
        "Downstream token counts are whatever you type here, not measured production usage. "
        f"Jev price source: https://vercel.com/ai-gateway/models/jev . "
        f"GPT-4.1: https://vercel.com/ai-gateway/models/gpt-4.1 . "
        f"GPT-4.1 mini: https://vercel.com/ai-gateway/models/gpt-4.1-mini ."
    )
    return pd.DataFrame(rows), note


def build() -> gr.Blocks:
    m = load_metrics()
    spend = m.get("spend", {})
    prices = m.get("prices", {})
    jev_in = prices.get("jev", {}).get("input", 0.042)
    gpt = prices.get("gpt41", {"input": 2, "output": 8})
    question = 0
    hdfs_e1 = m["e1_baseline"]["hdfs"]
    try:
        question = float(m["e6_cost_model"]["scenarios"][0]["questionTokensPerLog"])
    except Exception:
        mean_tok = hdfs_e1["tokens"].get("mean_input") or 0
        question = mean_tok
    analyze_default = float(hdfs_e1.get("analyze_rate") or 1)

    with gr.Blocks(title="Jev Logs triage explorer") as demo:
        gr.Markdown(
            """
# Jev Logs triage explorer

Measured routing of [Jev Logs](https://github.com/reachjalil/jevlogs) (`jevlogs@0.3.0` local build) on sanitized Loghub-derived HDFS and BGL samples.

This Space never calls a model and has no API keys. Sliding `retainBelow` recomputes `route` locally:
`retain` only when priority is `low`, value ≤ 25, and `actionableProbability` < threshold.
Protected, unavailable, and missing-probability records stay `analyze`.

- Dataset: [reachjalil/jevlogs-log-triage-benchmark](https://huggingface.co/datasets/reachjalil/jevlogs-log-triage-benchmark)
- GitHub: [reachjalil/jevlogs](https://github.com/reachjalil/jevlogs)
- npm: [jevlogs](https://www.npmjs.com/package/jevlogs)
- Site: [jevlogs.com](https://jevlogs.com)
            """
        )
        intro, e1_table, sweep_table, feat_table = metrics_tables()
        gr.Markdown(intro)
        gr.Markdown("## E1 baseline (`retainBelow = 0.1`, cache off)")
        gr.Dataframe(value=e1_table, label="Headline metrics")
        gr.Markdown("## E2 saved threshold sweep")
        gr.Dataframe(value=sweep_table, label="Recall vs routing rate from saved probabilities")
        gr.Markdown("## E7 cache and E8 retain rules")
        gr.Markdown(
            "E7 uses the default 1,000-entry / 5-minute cache. E8 adds three retain rules "
            "(HDFS PacketResponder terminating; BGL icache parity corrected; BGL rbs signal handler). "
            "An HDFS rule that matches a heartbeat template will also match that template on block-labeled anomalies; "
            "that is a finding about the rule, not about Jev."
        )
        gr.Dataframe(value=feat_table, label="Cache hit rate, model calls, rule hits")

        gr.Markdown("## Recompute routing from saved probabilities")
        dataset = gr.Radio(["hdfs", "bgl"], value="hdfs", label="Dataset")
        threshold = gr.Slider(0.0, 0.5, value=THRESHOLD_DEFAULT, step=0.01, label="retainBelow")
        current = gr.JSON(label="Metrics at this threshold")
        table = gr.Dataframe(label="Sweep including this threshold")
        plot = gr.ScatterPlot(
            x="routing_rate_retain",
            y="anomaly_recall",
            title="Recall vs routing rate",
            x_title="routing rate (retain)",
            y_title="anomaly recall",
        )
        missed = gr.Dataframe(label="Missed anomalies at this threshold (first 25)")
        inputs = [dataset, threshold]
        outputs = [current, table, plot, missed]
        demo.load(sweep_view, inputs, outputs)
        dataset.change(sweep_view, inputs, outputs)
        threshold.release(sweep_view, inputs, outputs)

        gr.Markdown("## Savings calculator (estimates)")
        gr.Markdown(
            "Mirrors `estimateSavings()` in jevlogs. `retainedFraction` here is the share **still sent** to a downstream LLM."
        )
        with gr.Row():
            logs = gr.Number(value=1_000_000, label="Logs per period")
            tokens_per_log = gr.Number(value=300, label="Downstream input tokens / log")
            output_tokens = gr.Number(value=50, label="Downstream output tokens / log")
        with gr.Row():
            llm_in = gr.Number(value=float(gpt.get("input", 2)), label="Downstream $/M input")
            llm_out = gr.Number(value=float(gpt.get("output", 8)), label="Downstream $/M output")
            analyze_rate = gr.Slider(0, 1, value=analyze_default, step=0.01, label="Analyze fraction (retainedFraction)")
        with gr.Row():
            jev_price = gr.Number(value=float(jev_in), label="Jev $/M input")
            qtok = gr.Number(value=float(question), label="Jev question tokens / log (measured default)")
            include_unfiltered = gr.Checkbox(value=True, label="Also show nothing-filtered case")
        savings_table = gr.Dataframe(label="Estimated USD")
        savings_note = gr.Markdown()
        sav_inputs = [logs, tokens_per_log, output_tokens, llm_in, llm_out, analyze_rate, jev_price, qtok, include_unfiltered]
        demo.load(savings_view, sav_inputs, [savings_table, savings_note])
        for ctrl in sav_inputs:
            ctrl.change(savings_view, sav_inputs, [savings_table, savings_note])

        gr.Markdown(
            f"""
## Spend recorded in this benchmark

Estimated from logged Jev input tokens: **${spend.get("estimated_spend_usd")}**.
Jalil should confirm this against the Gateway dashboard. Output tokens were recorded as usage but Jev output is priced at $0 on the model page.

Upstream logs: Loghub HDFS_v1 and BGL, research/academic license with required citation.
            """
        )
    return demo


demo = build()

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)
