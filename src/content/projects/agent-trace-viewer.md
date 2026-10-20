---
title: LLM Agent Trace Viewer
description: Watch an AI agent fix a bug in a small code project while OpenTelemetry traces every model call, tool call and test run, live in a waterfall viewer. Everything runs in your browser.
pubDate: 2026-10-20
featured: true
listed: true
tags:
  - TypeScript
  - React
  - OpenTelemetry
  - LLM agents
  - WebLLM
  - WebGPU
githubUrl: https://github.com/HannaKessler/PorfolioSite
demoUrl: /projects/agent-trace-viewer
---

## Summary

A small coding agent and the observability pipeline that watches it, both running in the browser. The agent is given a JavaScript project with a failing test suite. It runs the tests, reads the failing module, edits it and runs the tests again until they pass. Every model call, tool call and test run is recorded as an OpenTelemetry span and streamed to a trace viewer while the run is in progress.

The agent's "brain" can be a simulated rule set, which works on any device, or a real language model (Qwen2.5 1.5B by default) running on the GPU through WebLLM. The monitor is identical for both: the same instrumentation, span schema, transport, store and viewer.

What it demonstrates:

- **Agent design:** a tool-calling loop with schema validation, retries for invalid model output, wall-clock timeouts on tools and a step cap.
- **Observability engineering:** the real OpenTelemetry JavaScript SDK, the GenAI semantic conventions, a custom live span processor, a collector, a trace store and OTLP-JSON import and export.
- **Data visualisation:** a virtualized waterfall timeline drawn on canvas, a span inspector, a step-by-step activity feed, a file view with diffs, a prompt view, run summaries, filters, run comparison and playback.
- **Browser engineering:** three Web Workers (agent, tests, model), MessagePort transport, IndexedDB persistence and lazy loading of a large model runtime.
- **Testing:** unit tests for every layer, golden traces, determinism checks, a schema test that holds both brains to the same contract, and a Playwright end-to-end test.

## What you can do with it

- Run the agent with the simulated brain and watch spans appear on the timeline while they are still open.
- Opt in to a real model. The page checks for WebGPU first, shows the download size and GPU memory needed, and reports download progress. The model is cached by the browser and can be removed again.
- Inject faults: a flaky test, a tool that blocks past its deadline, or a model reply that is cut off mid-JSON. Each one really happens in the run, and the affected spans are marked as injected faults.
- Step through a run one agent step at a time.
- Inspect any span: its prompt and response, tool arguments and results, events, status and attributes.
- Follow the run step by step in the activity feed: the real model's reasoning in its own words, or the rule the simulated brain applied, then the tool call with its arguments, the result (including test failures and tool errors) and the outcome. Selecting an item selects the same span in the timeline and inspector, and the other way round.
- Browse the agent's project as it was at any point in the run, and see a diff for every `edit_file` call. A failed edit shows the text it tried to find and replace, the file as it was at the time, and how many times the text occurred.
- Read the full message list sent for every model call and the raw reply before parsing, including replies the validator rejected, with copy buttons.
- Filter by errors, slow spans (slower than the run's 90th percentile), tool, operation or text; compare two runs step by step; replay a run at 0.01× to 8× speed.
- Export a run as standard OTLP-JSON, or import one by file picker or drag and drop. The current view, including the selected span, filters and playback position, is kept in the URL.

## Architecture

- **Agent worker:** the agent loop, its four tools (`read_file`, `edit_file`, `run_tests`, `finish`), an in-memory file system holding the project, and the tracing SDK all run in one worker, off the page's main thread.
- **Test worker:** `run_tests` snapshots the project and spawns a fresh worker that loads the files as ES modules from Blob URLs and runs them with a small `describe`/`it`/`expect` harness. A wall-clock deadline terminates the worker, so a test run that never finishes cannot hang the agent.
- **Model worker:** the optional WebLLM engine runs in its own worker on WebGPU. Its JavaScript is a separate chunk that is downloaded only when a visitor chooses the real model.
- **Transport:** a custom OpenTelemetry span processor sends each span when it starts and again when it ends, batched every 50 ms and serialized with the SDK's standard OTLP-JSON serializer, over a `MessagePort` to the page.
- **Collector and store:** one `ingest()` entry point validates and normalizes OTLP-JSON from the live port, bundled samples and uploaded files alike, then upserts spans by ID into a store indexed by trace, parent and start time. Finished runs are saved to IndexedDB so they survive a reload.
- **Viewer:** a React island on a static Astro page. It reads only from the store and has no knowledge of which brain produced a trace.

## Engineering decisions and trade-offs

- **One monitor for both brains.** Both brains return raw text that must contain a JSON tool call, so the simulated brain goes through the same parser, validator and retry path as the real model. An architecture test fails if the tracing, collector, store or viewer code imports anything from the brains.
- **Only measured data.** Spans hold real durations, real tool inputs and outputs and real test results. Token counts and model statistics (time to first token, prefill and decode speed) are copied from what the WebLLM runtime reports, field by field. When a value is not reported, the attribute is left out rather than estimated, and the viewer says "Not reported by this brain". The simulated brain reports no usage at all and adds no artificial delay.
- **The real OpenTelemetry SDK instead of a hand-written tracer.** It provides standard span IDs, context, processors and serialization; the whole agent worker, SDK included, is about 19 KB gzip. Context is passed explicitly, because there is no zone.js-style async context in a worker.
- **GenAI semantic conventions.** Spans follow the OpenTelemetry GenAI conventions (`invoke_agent`, `chat`, `execute_tool`, `gen_ai.*` attributes). The conventions are still in Development status, so all names are pinned in one module.
- **Prompts and responses are recorded.** The conventions treat message content as opt-in. Here it is on by default because the project is synthetic; each payload is capped at 64 KB, enough for a full prompt at the default step cap, and the export dialog warns that exported files contain it.
- **Reasoning is shown only when it is real.** The reply schema has an optional `thought` field, and the activity feed shows what the real model wrote there, verbatim. The simulated brain writes no reasoning: each reply records the rule that fired and the values it matched, and the feed labels it as a fixed rule rather than model reasoning.
- **Views rebuilt from spans.** The activity feed, the file view and the prompt view read only span attributes: the project's files at the start of the run, each edit's file contents before and after, and the full message list of each model call. They therefore work the same for live runs, bundled samples and imported files, and follow the playback position. Prompts and tool arguments are set when a span starts, so they are visible while the call is still running.
- **Schema-constrained JSON instead of native tool calling.** WebLLM's native tool calling is still marked as work in progress and limited to a few larger models, so the real model is asked for a JSON object constrained by a JSON Schema, and the shared validator checks it.
- **Full prompt on every request.** WebLLM counts only the new part of the prompt when it detects a multi-turn chat, so the brain resets the chat before each request and sends the full conversation, so that the reported prompt tokens and prefill timings cover the whole prompt.
- **Cost as a what-if.** A model running in the browser has no price, so there is no cost figure. For real-model runs, a collapsed panel multiplies the run's reported token counts by prices the visitor enters; there are no default prices, and every figure is labelled as a what-if.
- **Lazy loading.** The page loads the viewer (about 35 KB gzip, plus React, which the site's other demos share). The agent worker starts on the first run. The WebLLM runtime and the model weights are fetched only on opt-in. The runtime is about 4.3 MB gzip in total, because the engine's client in the agent worker and the engine's own worker each include the library.

## Trace schema

```
invoke_agent trace-fixer        run config, brain, outcome, final test result, project files at the start
├─ pause                        step mode: time spent waiting for the visitor
└─ step N
   ├─ chat <model>              prompt, response, finish reason, events: retry, validation_error
   │                            reported only: gen_ai.usage.*, app.llm.* runtime statistics
   │                            brain-reported: app.policy.* (simulated), app.llm.request (WebLLM)
   └─ execute_tool <tool>       arguments, result, deadline, test counts
                                edit_file: file before and after, match count
```

Failures set the span status to Error with an `error.type` (`timeout`, `malformed_output`, `tool_error`, `test_failure`). Injected faults carry `app.fault.injected`.

## Testing

Vitest unit tests cover each layer without a browser:

- **Agent:** file system, tools, the tool-call validator, the loop, the step cap and all three fault types.
- **Golden and determinism tests:** a seeded run with a test-only clock matches a snapshot of its canonical trace, and ten seeded runs produce identical span trees, tool inputs and outputs and test results.
- **No fabricated data:** scripted runs carry no token or runtime-statistics attributes, and a WebLLM response with a missing field produces a span without that attribute.
- **Identical pipeline:** recorded WebLLM-style completions are replayed through the same loop, and the test checks that their spans and the simulated brain's share the same names, kinds, hierarchy, required attributes and events.
- **Transport and storage:** spans arrive open and then ended, an ended span is never replaced by an older open copy, and export → import → export reproduces the same document.
- **Viewer logic:** filters, sequence alignment for compare, URL state, playback clipping and the what-if arithmetic.
- **Detail views:** the activity feed, the rebuilt project at any point and in playback, line diffs, failed edits, full untruncated prompts, the WebLLM request body, and prompts present on spans that are still open.
- **Bundled samples:** every sample passes the span schema, the simulated-brain samples carry no usage attributes, and in the real-model sample usage appears only on `chat` spans.

Playwright tests load the page, run the agent in a real browser, check that the trace reaches the timeline and the inspector, and check that the activity, file and prompt views follow the selection.

## Limitations

- The agent has one task (two planted-bug variants) and four tools; it demonstrates the pipeline rather than general coding ability.
- The real model needs a browser with WebGPU, a download of several hundred megabytes and enough GPU memory. Small models may produce invalid tool calls or fail to fix the bug; those runs still produce complete traces.
- Traces stay in the browser. There is no exporter to a remote collector; export is to a file.
- The simulated-brain samples were recorded by a script in Node.js, so their timings reflect that environment. The Qwen2.5 1.5B sample was recorded in the browser and exported with the viewer's Export button. In it, the model repeats an edit that does not match the file until the step cap stops the run.
- Timing precision is limited by the browser's timer resolution, which is coarser on pages that are not cross-origin isolated.
