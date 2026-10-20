import type { Collector } from "../collector/collector";
import type { RunRequest } from "./runner";
import type { FromAgent, ToAgent } from "./worker-protocol";

/**
 * Main-thread handle on the agent worker. Each run gets a fresh MessageChannel:
 * the worker's span processor posts on one end, the collector listens on the other.
 */
export class AgentClient {
  private worker: Worker | undefined;
  private listeners = new Set<(msg: FromAgent) => void>();

  private get w(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./agent.worker.ts", import.meta.url), { type: "module", name: "agent" });
      this.worker.onmessage = (e: MessageEvent<FromAgent>) => this.listeners.forEach((l) => l(e.data));
      this.worker.onerror = (e) => console.error("Agent worker error:", e.message);
    }
    return this.worker;
  }

  on(listener: (msg: FromAgent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private send(msg: ToAgent, transfer: Transferable[] = []) {
    this.w.postMessage(msg, transfer);
  }

  /** Starts a run. `onRunId` fires once, with the store's run ID, when the first spans arrive. */
  run(request: RunRequest, collector: Collector, onRunId: (runId: string) => void): () => void {
    const channel = new MessageChannel();
    let seen = false;
    const disconnect = collector.connectPort(channel.port1, (result) => {
      if (!seen && result.runIds[0]) {
        seen = true;
        onRunId(result.runIds[0]);
      }
    });
    this.send({ type: "run", request, port: channel.port2 }, [channel.port2]);
    return () => {
      disconnect();
      channel.port1.close();
    };
  }

  step() {
    this.send({ type: "step" });
  }

  abort() {
    this.send({ type: "abort" });
  }

  modelStatus(modelId: string) {
    this.send({ type: "model-status", modelId });
  }

  removeModel(modelId: string) {
    this.send({ type: "model-remove", modelId });
  }
}
