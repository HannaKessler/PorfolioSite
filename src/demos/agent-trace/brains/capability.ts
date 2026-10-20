/** WebGPU capability check for the real-model option. Works on the main thread and in workers. */
export interface Capability {
  ok: boolean;
  shaderF16: boolean;
  reason?: string;
}

interface MinimalGpu {
  requestAdapter(options?: { powerPreference?: string }): Promise<{ features: { has(name: string): boolean } } | null>;
}

export async function checkWebGPU(nav: { gpu?: unknown } = globalThis.navigator ?? {}): Promise<Capability> {
  const gpu = nav.gpu as MinimalGpu | undefined;
  if (!gpu) return { ok: false, shaderF16: false, reason: "This browser does not support WebGPU." };
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return { ok: false, shaderF16: false, reason: "WebGPU is available but no GPU adapter was found." };
    return { ok: true, shaderF16: adapter.features.has("shader-f16") };
  } catch (e) {
    return { ok: false, shaderF16: false, reason: `WebGPU adapter request failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
