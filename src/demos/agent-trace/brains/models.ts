/**
 * Real models the visitor can opt into. VRAM figures are WebLLM's own
 * `vram_required_MB` from prebuiltAppConfig (a unit test keeps them in sync);
 * download sizes are the q4f16_1 Hugging Face repository totals.
 */
export interface ModelOption {
  /** q4f16_1 build; used when the GPU supports shader-f16. */
  id: string;
  /** q4f32_1 build for GPUs without shader-f16. */
  f32Id: string;
  label: string;
  vramMB: number;
  f32VramMB: number;
  /** Approximate download of the q4f16_1 build. */
  downloadLabel: string;
}

export const DEFAULT_MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

export const MODEL_OPTIONS: ModelOption[] = [
  { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", f32Id: "Qwen2.5-0.5B-Instruct-q4f32_1-MLC", label: "Qwen2.5 0.5B Instruct", vramMB: 945, f32VramMB: 1060, downloadLabel: "about 290 MB" },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", f32Id: "Llama-3.2-1B-Instruct-q4f32_1-MLC", label: "Llama 3.2 1B Instruct", vramMB: 879, f32VramMB: 1129, downloadLabel: "about 705 MB" },
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", f32Id: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC", label: "Qwen2.5 1.5B Instruct", vramMB: 1630, f32VramMB: 1889, downloadLabel: "about 880 MB" },
  { id: "Qwen3-1.7B-q4f16_1-MLC", f32Id: "Qwen3-1.7B-q4f32_1-MLC", label: "Qwen3 1.7B", vramMB: 2037, f32VramMB: 2635, downloadLabel: "about 984 MB" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", f32Id: "Llama-3.2-3B-Instruct-q4f32_1-MLC", label: "Llama 3.2 3B Instruct", vramMB: 2264, f32VramMB: 2952, downloadLabel: "about 1.8 GB" },
];

/** The build to load on this GPU, its VRAM need, and the download label (only known for q4f16_1). */
export function resolveModel(option: ModelOption, shaderF16: boolean): { modelId: string; vramMB: number; downloadLabel?: string } {
  return shaderF16
    ? { modelId: option.id, vramMB: option.vramMB, downloadLabel: option.downloadLabel }
    : { modelId: option.f32Id, vramMB: option.f32VramMB };
}
