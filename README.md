# AI Slop Detector for LinkedIn®

Created by [Mayas Ötegen](https://www.linkedin.com/in/mayasotegen/).

Independent Chrome extension that analyzes visible LinkedIn post text for low substance writing patterns using your own Jev API key.

## Install

1. Extract `AI_Slop_Detector_for_LinkedIn_0.3.0.zip` into a folder you will keep on your computer.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the extracted `AI_Slop_Detector_for_LinkedIn` folder containing `manifest.json`.
5. Pin **AI Slop Detector for LinkedIn®** from the Chrome extensions menu.
6. Open LinkedIn, open the extension, add your Jev API key and start scanning.

No Node installation, terminal command, server deployment or Cloudflare setup is required for normal use.

## Your Jev key

The default key mode uses Chrome extension session storage. Select **Remember on this device** if you want Chrome extension local storage to retain the key. The key is sent only to TypeSafe from the extension background worker and is never returned to the LinkedIn content script.

Get your key from here: https://console.typesafe.ai/keys

## What it checks

The detector evaluates visible post text for five patterns: formulaic filler, engagement bait, generic motivation, empty business jargon and pseudo insight. The score describes writing patterns and does not prove whether AI was used. Surface style alone is not enough to trigger a flag. Concrete evidence, methods, examples, constraints and useful instructions count against a slop result.

## Included controls

| Feature | Behavior |
| --- | --- |
| API access | Direct calls to `https://api.typesafe.ai/v1/systemone` |
| Model | Pinned to `jev-1.13.0` |
| Key controls | Save, test, reveal typed text, remove and optional device retention |
| Feed detection | Checks visible posts as you scroll |
| Stamp | Optional red SLOP overlay |
| Languages | English, with experimental Arabic, Turkish and mixed text handling |
| Sensitivity | Configurable score threshold, initially 85% |
| Local request guard | Initially 300 provider requests per UTC day |
| Burst guard | 30 provider requests per minute, with two concurrent checks |
| Cache | One hour in session storage, up to 300 classification results |

## Creator and support

Creator: [Mayas Ötegen](https://www.linkedin.com/in/mayasotegen/)

Homepage: [Midnight Lab](https://www.midnightlab.dev/)

For support, questions or feedback, contact Mayas through LinkedIn.

## Version history

### 0.3.0

Added pseudo insight as a fifth slop signal. Added hard negative guidance so a cliché opening, polished corporate language, a numbered list, a keyword comment request or an X is not Y contrast does not trigger a flag by itself when the post contains specific evidence or useful information. Added a 500 post benchmark with 250 clear, 200 slop and 50 uncertain cases. It includes 150 hard negatives across English, Arabic, Turkish and mixed language posts. Added benchmark validation tests and an optional live Jev benchmark runner.

### 0.2.0

Introduced the **AI Slop Detector for LinkedIn®** identity, new independent icon and wordmark, About page, creator profile, trademark notice, homepage metadata, corrected install filename, refreshed build information and internal naming cleanup.

### 0.1.1

Improved LinkedIn feed selectors, restored removed annotations, added feed diagnostics and improved scan state reporting.

## Independent project

LinkedIn is a registered trademark of LinkedIn Corporation or its affiliates. AI Slop Detector for LinkedIn® is independently developed by Mayas Ötegen and is not affiliated with or endorsed by LinkedIn Corporation.

## Privacy

See `privacy.html` inside the extension for key storage, cached data and request details.

## Detector benchmark

The benchmark lives in `tests/cases.json`. The 500 cases are original synthetic examples informed by official LinkedIn guidance, public post archetypes and published detector evaluation research. Public posts were used to identify difficult patterns, not copied into the benchmark.

Run local validation with `npm test`. To evaluate the full benchmark against Jev with your own TypeSafe key, set `JEV_API_KEY` and run `npm run benchmark`. The live runner writes a local report with accuracy, slop precision, recall, clear false positive rate, Brier score, hard negative accuracy, false positives, false negatives, language breakdowns and archetype breakdowns.

See `tests/BENCHMARK_SOURCES.md` for the research sources and benchmark design notes.
