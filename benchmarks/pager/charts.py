#!/usr/bin/env python3
"""PagerDuty-trigger charts from benchmarks/pager/results/metrics.json."""
from __future__ import annotations

import json
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

metrics_path, out_dir = sys.argv[1], sys.argv[2]
os.makedirs(out_dir, exist_ok=True)
m = json.load(open(metrics_path, encoding="utf-8"))
v1_path = os.path.join(os.path.dirname(metrics_path), "metrics.json")
m1 = json.load(open(v1_path, encoding="utf-8")) if os.path.exists(v1_path) else {}
v3_path = os.path.join(os.path.dirname(metrics_path), "metrics_v3.json")
m3 = json.load(open(v3_path, encoding="utf-8")) if os.path.exists(v3_path) else {}

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
LUNA = "#6d28d9"
MUTED = "#8a8374"
RED = "#b42318"

# Prefer the cheapest 100/100 pager (v3), then v2 threshold, then v1.
jev_block = (
    (m3.get("jev_v3_page_now_p050") if m3 else None)
    or m.get("jev_v2_page_now_p050")
    or m.get("jev")
    or {}
)
luna_block = m.get("luna_unchanged") or m.get("luna") or {}
spend = m.get("spend_v2") or m.get("spend") or {}
if m.get("spend_v2") and m.get("luna_unchanged"):
    spend = {
        "jev_estimated_usd": (m.get("spend_v2") or {}).get("estimated_usd"),
        "luna_estimated_usd": 0.320359,
    }


def save(fig, name):
    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, name), dpi=160, facecolor=fig.get_facecolor())
    plt.close(fig)


fig, ax = plt.subplots(figsize=(8.8, 5.2))
# Support both metrics.json (v1) and metrics_v2.json
if m.get("jev_v2_page_now_p050"):
    labels = ["Jev v1\nurgency", "Jev v1\np≥0.22", "Jev v2\nurgency", "Jev v2\np≥0.50"]
    recall = [
        m["jev_v1_urgency_only"]["page_recall"],
        m["jev_v1_calibrated_p022"]["page_recall"],
        m["jev_v2_discrete_urgency"]["page_recall"],
        m["jev_v2_page_now_p050"]["page_recall"],
    ]
    precision = [
        m["jev_v1_urgency_only"]["page_precision"],
        m["jev_v1_calibrated_p022"]["page_precision"],
        m["jev_v2_discrete_urgency"]["page_precision"],
        m["jev_v2_page_now_p050"]["page_precision"],
    ]
    if m3.get("jev_v3_page_now_p050"):
        labels.append("Jev v3\np≥0.50")
        recall.append(m3["jev_v3_page_now_p050"]["page_recall"])
        precision.append(m3["jev_v3_page_now_p050"]["page_precision"])
    labels.append("Luna")
    recall.append((m.get("luna_unchanged") or m.get("luna") or {}).get("page_recall"))
    precision.append((m.get("luna_unchanged") or m.get("luna") or {}).get("page_precision"))
else:
    labels = ["Jev", "Luna", "ERROR\nseverity", "keyword"]
    recall = [
        m["jev"]["page_recall"],
        m["luna"]["page_recall"],
        m["baselines"]["severity_error_pages"]["page_recall"],
        m["baselines"]["keyword_pages"]["page_recall"],
    ]
    precision = [
        m["jev"]["page_precision"],
        m["luna"]["page_precision"],
        m["baselines"]["severity_error_pages"]["page_precision"],
        m["baselines"]["keyword_pages"]["page_precision"],
    ]
x = np.arange(len(labels))
w = 0.35
ax.bar(x - w / 2, recall, w, label="Page recall", color=JEV)
ax.bar(x + w / 2, precision, w, label="Page precision", color=LUNA)
ax.set_xticks(list(x))
ax.set_xticklabels(labels)
ax.set_ylim(0, 1.05)
ax.set_ylabel("Rate")
ax.set_title("PagerDuty trigger: catch real incidents without paging on ERROR noise")
ax.legend()
ax.grid(True, axis="y", alpha=0.25)
save(fig, "pager_recall_precision.png")

fig, ax = plt.subplots(figsize=(8.8, 5.2))
names = ["False pages\non ignore", "False pages\non ticket", "ERROR traps\nnot paged", "INFO incidents\npaged"]
jev_v = [
    jev_block.get("false_page_on_ignore"),
    jev_block.get("false_page_on_ticket"),
    jev_block.get("error_looking_not_paged"),
    jev_block.get("info_incidents_paged"),
]
luna_v = [
    luna_block.get("false_page_on_ignore"),
    luna_block.get("false_page_on_ticket"),
    luna_block.get("error_looking_not_paged"),
    luna_block.get("info_incidents_paged"),
]
x = np.arange(len(names))
ax.bar(x - w / 2, jev_v, w, label="Jev (tuned)", color=JEV)
ax.bar(x + w / 2, luna_v, w, label="Luna", color=LUNA)
ax.set_xticks(list(x))
ax.set_xticklabels(names)
ax.set_ylim(0, 1.05)
ax.set_ylabel("Rate")
ax.set_title("Where the decision is not 'ERROR means page'")
ax.legend()
ax.grid(True, axis="y", alpha=0.25)
save(fig, "pager_traps.png")

fig, ax = plt.subplots(figsize=(9.2, 5.4))
fam = jev_block.get("by_family") or {}
page_fams = [k for k, v in fam.items() if v.get("gold_page")]
page_fams.sort()
if page_fams:
    jev_r = [fam[k]["hit"] / fam[k]["n"] if fam[k]["n"] else 0 for k in page_fams]
    luna_fam = luna_block.get("by_family") or {}
    luna_r = [
        (luna_fam.get(k, {}).get("hit") or 0) / (luna_fam.get(k, {}).get("n") or 1)
        for k in page_fams
    ]
    y = np.arange(len(page_fams))
    ax.barh(y - 0.18, jev_r, 0.35, label="Jev tuned accuracy", color=JEV)
    ax.barh(y + 0.18, luna_r, 0.35, label="Luna accuracy", color=LUNA)
    ax.set_yticks(list(y))
    ax.set_yticklabels(page_fams, fontsize=8)
    ax.set_xlim(0, 1.05)
    ax.set_xlabel("Accuracy on that family")
    ax.set_title("Per-incident-family accuracy")
    ax.legend()
    ax.grid(True, axis="x", alpha=0.25)
    save(fig, "pager_families.png")

spend = m.get("spend") or m1.get("spend") or {}
v1_usd = spend.get("jev_estimated_usd") or 0
v2_usd = (m.get("spend_v2") or {}).get("estimated_usd") or 0
v3_usd = (m3.get("spend_v3") or {}).get("estimated_usd") or 0
luna_usd = spend.get("luna_estimated_usd") or 0
names = ["Jev v1", "Jev v2", "Jev v3", "Luna"]
vals = [v1_usd, v2_usd, v3_usd, luna_usd]
if not any(vals[1:3]) and not m.get("spend_v2"):
    names, vals, colors = ["Jev", "Luna"], [v1_usd, luna_usd], [JEV, LUNA]
else:
    colors = [JEV, "#4f7cff", "#93b0ff", LUNA]
fig, ax = plt.subplots(figsize=(7.6, 4.8))
bars = ax.bar(names, vals, color=colors, width=0.55)
ax.set_ylabel("USD (Gateway list prices × logged tokens)")
ax.set_title("Measured spend for this PagerDuty trigger run")
for bar, val in zip(bars, vals):
    ax.text(bar.get_x() + bar.get_width() / 2, val, f"${val:.4f}", ha="center", va="bottom")
ax.grid(True, axis="y", alpha=0.25)
save(fig, "pager_spend.png")

print("charts written", out_dir)
