---
title: Jev Logs triage explorer
emoji: 📟
colorFrom: blue
colorTo: gray
sdk: gradio
sdk_version: 5.29.1
python_version: "3.11"
app_file: app.py
pinned: false
license: mit
short_description: Loghub HDFS/BGL explorer for Jev Logs. No live calls.
tags:
  - opentelemetry
  - logs
  - observability
  - jev
  - anomaly-detection
---

# Jev Logs triage explorer

Interactive view of [reachjalil/jevlogs-log-triage-benchmark](https://huggingface.co/datasets/reachjalil/jevlogs-log-triage-benchmark).

This Space **does not call Jev**. It recomputes routing from saved probabilities and shows the measured metrics from `jevlogs@0.2.0` on sanitized Loghub-derived HDFS and BGL samples.

- Dataset: https://huggingface.co/datasets/reachjalil/jevlogs-log-triage-benchmark
- GitHub: https://github.com/reachjalil/jevlogs
- npm: https://www.npmjs.com/package/jevlogs
- Site: https://jevlogs.com
