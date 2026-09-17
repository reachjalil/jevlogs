#!/usr/bin/env python3
"""Render benchmark PNGs from metrics.json. No model calls."""
from __future__ import annotations

import json
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

metrics_path, out_dir, results_dir = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out_dir, exist_ok=True)
m = json.load(open(metrics_path, encoding="utf-8"))

plt.rcParams.update({
    "font.size": 11,
    "figure.facecolor": "#f7f5ef",
    "axes.facecolor": "#f7f5ef",
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.edgecolor": "#3d3a32",
    "text.color": "#1c1915",
    "axes.labelcolor": "#1c1915",
    "xtick.color": "#1c1915",
    "ytick.color": "#1c1915",
})

JEV = "#2448ff"
HDFS = "#2448ff"
BGL = "#11131b"
LUNA = "#6d28d9"
TERRA = "#0f766e"
SOL = "#ea580c"
MUTED = "#8a8374"


def load_lat(name):
    path = os.path.join(results_dir, name)
    vals = []
    if not os.path.exists(path):
        return vals
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            row = json.loads(line)
            if isinstance(row.get("wall_ms"), (int, float)):
                vals.append(row["wall_ms"])
    return vals


def save(fig, name):
    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, name), dpi=160, facecolor=fig.get_facecolor())
    plt.close(fig)


fig, ax = plt.subplots(figsize=(8.5, 5.2))
for ds, color in [("hdfs", HDFS), ("bgl", BGL)]:
    sweep = m["e2_threshold_sweep"][ds]
    ax.plot(
        [p["routing_rate_retain"] for p in sweep],
        [p["anomaly_recall"] for p in sweep],
        marker="o",
        color=color,
        label=ds.upper(),
        linewidth=2,
    )
    for p in sweep:
        ax.annotate(
            str(p["retainBelow"]),
            (p["routing_rate_retain"], p["anomaly_recall"]),
            textcoords="offset points",
            xytext=(5, 5),
            fontsize=8,
            color=color,
        )
ax.set_xlabel("Routing rate (share retain)")
ax.set_ylabel("Anomaly recall (labeled anomalies routed analyze)")
ax.set_title("Recall vs routing rate by retainBelow")
ax.set_xlim(-0.02, 1.02)
ax.set_ylim(-0.02, 1.02)
ax.grid(True, alpha=0.25)
ax.legend()
save(fig, "recall_vs_routing_rate.png")

fig, ax = plt.subplots(figsize=(8.5, 5.2))
reasons = ["model", "uncertain", "protected", "unavailable", "rule"]
x = np.arange(len(reasons))
w = 0.36
hdfs = [m["e1_baseline"]["hdfs"]["reason_mix"].get(r, 0) for r in reasons]
bgl = [m["e1_baseline"]["bgl"]["reason_mix"].get(r, 0) for r in reasons]
ax.bar(x - w / 2, hdfs, w, label="HDFS", color=HDFS)
ax.bar(x + w / 2, bgl, w, label="BGL", color=BGL)
ax.set_xticks(list(x))
ax.set_xticklabels(reasons)
ax.set_ylabel("Records")
ax.set_title("E1 reason mix at retainBelow = 0.1")
ax.legend()
ax.grid(True, axis="y", alpha=0.25)
save(fig, "reason_mix.png")

fig, ax = plt.subplots(figsize=(8.5, 5.2))
for ds, color in [("hdfs", HDFS), ("bgl", BGL)]:
    vals = load_lat(f"e1_{ds}.jsonl")
    if vals:
        ax.hist(vals, bins=40, alpha=0.5, label=ds.upper(), color=color)
ax.axvline(2000, color="#b42318", linestyle="--", label="timeout 2000 ms")
ax.set_xlabel("triage() wall time (ms)")
ax.set_ylabel("Records")
ax.set_title("Jev latency vs 2s timeout")
ax.legend()
ax.grid(True, alpha=0.25)
save(fig, "latency_histogram.png")

e6 = m.get("e6_cost_model") or {}
headline = e6.get("headline") or {}
curves = e6.get("curves") or []
scenarios = e6.get("scenarios") or []

fig, ax = plt.subplots(figsize=(9.2, 5.4))
colors = {"openai/gpt-5.6-luna": LUNA, "openai/gpt-5.6-terra": TERRA, "openai/gpt-5.6-sol": SOL, "openai/gpt-4.1": MUTED}
if curves:
    for curve in curves:
        name = curve["downstream_model"].split("/")[-1]
        pts = curve["points"]
        ax.plot(
            [p["analyze_rate"] for p in pts],
            [p["withJev"] for p in pts],
            color=colors.get(curve["downstream_model"], JEV),
            linewidth=2.2,
            label=f"Jev + {name}",
        )
        ax.axhline(
            pts[-1]["baseline"] if pts else 0,
            color=colors.get(curve["downstream_model"], MUTED),
            linestyle=":",
            linewidth=1.4,
            alpha=0.8,
        )
    ax.set_xlabel("Share still sent to the downstream model")
    ax.set_ylabel("USD per 1M logs (estimate)")
    ax.set_title("Jev plus GPT-5.6 vs sending every log downstream")
    ax.legend(loc="upper left", fontsize=8)
    ax.grid(True, alpha=0.25)
    if headline.get("measured_analyze_rate") is not None:
        ax.axvline(headline["measured_analyze_rate"], color=JEV, linestyle="--", linewidth=1.2, label="measured analyze rate")
else:
    labels, baseline, withjev = [], [], []
    for s in scenarios:
        labels.append(s["downstream_model"].split("/")[-1] + "\n" + s["label"].replace("_", " "))
        baseline.append(s["estimate"]["baseline"])
        withjev.append(s["estimate"]["withJev"])
    x = np.arange(len(labels))
    w = 0.35
    ax.bar(x - w / 2, baseline, w, label="send every log (no Jev)", color=MUTED)
    ax.bar(x + w / 2, withjev, w, label="with Jev (estimate)", color=JEV)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=8)
    ax.set_ylabel("USD per 1M logs (estimate)")
    ax.set_title("Estimated analysis spend")
    ax.legend()
    ax.grid(True, axis="y", alpha=0.25)
save(fig, "cost_scenarios.png")

luna_measured = next((s for s in scenarios if "luna" in s.get("downstream_model", "") and s.get("label") == "measured_analyze_rate_on_stratified_sample"), None)
luna_none = next((s for s in scenarios if "luna" in s.get("downstream_model", "") and s.get("label") == "nothing_filtered"), None)
luna_be = next((s for s in scenarios if "luna" in s.get("downstream_model", "") and s.get("label") == "at_break_even_filter"), None)
if luna_measured and luna_none:
    fig, ax = plt.subplots(figsize=(8.8, 5.3))
    names = ["Send every log\nto Luna", "Jev, then Luna\nat measured rate", "Jev overhead\n(nothing filtered)"]
    vals = [
        luna_measured["estimate"]["baseline"],
        luna_measured["estimate"]["withJev"],
        luna_none["estimate"]["withJev"],
    ]
    bars = ax.bar(names, vals, color=[LUNA, JEV, MUTED], width=0.62)
    ax.set_ylabel("USD per 1M logs (estimate)")
    ax.set_title("Counterpart: GPT-5.6 Luna via Vercel AI Gateway")
    for bar, val in zip(bars, vals):
        ax.text(bar.get_x() + bar.get_width() / 2, val, f"${val:,.0f}", ha="center", va="bottom", fontsize=10)
    if luna_be:
        ax.axhline(luna_be["estimate"]["baseline"], color=LUNA, linestyle=":", linewidth=1.3)
        ax.text(2.35, luna_be["estimate"]["baseline"], "Luna-only baseline", va="bottom", fontsize=8, color=LUNA)
    ax.grid(True, axis="y", alpha=0.25)
    save(fig, "cost_luna_counterpart.png")

e9 = m.get("e9_luna_side_by_side")
if e9:
    fig, ax = plt.subplots(figsize=(8.8, 5.3))
    datasets = [k for k in ("hdfs", "bgl") if k in e9]
    x = np.arange(len(datasets))
    w = 0.35
    jev_r = [e9[ds].get("jev_anomaly_recall") for ds in datasets]
    luna_r = [e9[ds].get("luna_anomaly_recall") for ds in datasets]
    ax.bar(x - w / 2, jev_r, w, label="Jev", color=JEV)
    ax.bar(x + w / 2, luna_r, w, label="GPT-5.6 Luna (Gateway, structured)", color=LUNA)
    ax.set_xticks(list(x))
    ax.set_xticklabels([ds.upper() for ds in datasets])
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("Anomaly recall")
    ax.set_title("Side-by-side: same 400-line slice, same retain rule")
    ax.legend()
    ax.grid(True, axis="y", alpha=0.25)
    save(fig, "luna_vs_jev_recall.png")

    fig, ax = plt.subplots(figsize=(8.8, 5.3))
    jev_ret = [e9[ds].get("jev_routing_rate_retain") for ds in datasets]
    luna_ret = [e9[ds].get("luna_routing_rate_retain") for ds in datasets]
    ax.bar(x - w / 2, jev_ret, w, label="Jev", color=JEV)
    ax.bar(x + w / 2, luna_ret, w, label="GPT-5.6 Luna (Gateway, structured)", color=LUNA)
    ax.set_xticks(list(x))
    ax.set_xticklabels([ds.upper() for ds in datasets])
    ax.set_ylabel("Routing rate (share retain)")
    ax.set_title("Same slice: Luna retains more than Jev at the default cutoff")
    ax.legend()
    ax.grid(True, axis="y", alpha=0.25)
    save(fig, "luna_vs_jev_retain.png")

    fig, ax = plt.subplots(figsize=(8.8, 5.3))
    labels = ["Jev mean\nUSD / model call", "Luna mean\nUSD / model call"]
    costs = e9.get("cost_per_model_call") or {}
    jev_c = costs.get("jev_usd")
    if jev_c is None:
        jev_c = costs.get("jev_usd_estimated_from_luna_prompt_size")
    luna_c = costs.get("luna_usd")
    if jev_c is not None and luna_c is not None:
        bars = ax.bar(labels, [jev_c, luna_c], color=[JEV, LUNA], width=0.55)
        ax.set_ylabel("USD per successful model call (from logged tokens)")
        ax.set_title("Measured per-call cost on this sample (Gateway list prices)")
        for bar, val in zip(bars, [jev_c, luna_c]):
            ax.text(bar.get_x() + bar.get_width() / 2, val, f"${val:.5f}", ha="center", va="bottom", fontsize=10)
        ax.grid(True, axis="y", alpha=0.25)
        save(fig, "luna_vs_jev_call_cost.png")

print("charts written", out_dir)
