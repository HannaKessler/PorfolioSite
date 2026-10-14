// Hand-written WebGPU renderer for the custom panes. No rendering library.
/// <reference types="@webgpu/types" />
import { materialFlags, type CustomMaterial, type CustomScene, type CustomTexture } from "./customScene";
import { multiply, normalize, perspective, transformPoint, type Vec3 } from "../mat4";
import { CLEAR_SRGB, LIGHTING, type CustomRenderer, type FrameParams, type GpuTimeListener } from "./renderer";
import { GRID_WGSL, MESH_WGSL, MIPMAP_WGSL } from "./wgsl";

export class WebGPUUnsupportedError extends Error {
  constructor() {
    super("WebGPU not supported in this browser");
  }
}

const SAMPLES = 4; // 4x MSAA, like the three.js pane's antialias: true
const DEPTH_FORMAT: GPUTextureFormat = "depth24plus";
const FRAME_BYTES = 64 + 6 * 16;

interface GpuPart {
  start: number;
  count: number;
  material: CustomMaterial;
  center: Vec3;
  bindGroup: GPUBindGroup;
  uniform: GPUBuffer;
}
interface GpuMesh {
  buffers: GPUBuffer[];
  index: GPUBuffer | null;
  parts: GpuPart[];
}

function mipLevels(width: number, height: number) {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

export async function createWebGPURenderer(canvas: HTMLCanvasElement, onGpuTime: GpuTimeListener = () => {}): Promise<CustomRenderer> {
  if (!("gpu" in navigator) || !navigator.gpu) throw new WebGPUUnsupportedError();
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new WebGPUUnsupportedError();
  // GPU frame times need the optional timestamp-query feature.
  const timing = adapter.features.has("timestamp-query");
  const device = await adapter.requestDevice(timing ? { requiredFeatures: ["timestamp-query"] } : undefined);
  const querySet = timing ? device.createQuerySet({ type: "timestamp", count: 2 }) : null;
  const resolveBuffer = timing ? device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null;
  const readBuffer = timing ? device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) : null;
  let reading = false;
  let uploadedBytes = 0;
  const context = canvas.getContext("webgpu");
  if (!context) throw new WebGPUUnsupportedError();
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  let lost = false;
  void device.lost.then(() => {
    lost = true;
  });

  const frameBuffer = device.createBuffer({ size: FRAME_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const frameLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
  });
  const frameGroup = device.createBindGroup({ layout: frameLayout, entries: [{ binding: 0, resource: { buffer: frameBuffer } }] });
  const partLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ],
  });

  const meshModule = device.createShaderModule({ code: MESH_WGSL });
  const gridModule = device.createShaderModule({ code: GRID_WGSL });
  const mipModule = device.createShaderModule({ code: MIPMAP_WGSL });

  const alphaBlend: GPUBlendState = {
    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  };

  const meshLayout = device.createPipelineLayout({ bindGroupLayouts: [frameLayout, partLayout] });
  const pipelines = new Map<string, GPURenderPipeline>();
  const meshPipeline = (cull: GPUCullMode, transparent: boolean) => {
    const key = `${cull}:${transparent}`;
    let pipeline = pipelines.get(key);
    if (!pipeline) {
      pipeline = device.createRenderPipeline({
        layout: meshLayout,
        vertex: {
          module: meshModule,
          entryPoint: "vs",
          buffers: [
            { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
            { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] },
            { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" }] },
            { arrayStride: 12, attributes: [{ shaderLocation: 3, offset: 0, format: "float32x3" }] },
          ],
        },
        fragment: { module: meshModule, entryPoint: "fs", targets: [{ format, blend: transparent ? alphaBlend : undefined }] },
        primitive: { topology: "triangle-list", cullMode: cull, frontFace: "ccw" },
        depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: !transparent, depthCompare: "less-equal" },
        multisample: { count: SAMPLES },
      });
      pipelines.set(key, pipeline);
    }
    return pipeline;
  };

  const gridPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout] }),
    vertex: { module: gridModule, entryPoint: "vs", buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] }] },
    fragment: { module: gridModule, entryPoint: "fs", targets: [{ format, blend: alphaBlend }] },
    primitive: { topology: "triangle-strip" },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: "less-equal" },
    multisample: { count: SAMPLES },
  });
  const gridBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(gridBuffer, 0, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));

  // Mipmaps are generated by repeatedly downsampling with a render pass: WebGPU has no generateMipmap.
  const mipSampler = device.createSampler({ minFilter: "linear", magFilter: "linear" });
  const mipPipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  const generateMips = (texture: GPUTexture, textureFormat: GPUTextureFormat) => {
    let pipeline = mipPipelines.get(textureFormat);
    if (!pipeline) {
      pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: mipModule, entryPoint: "vs" },
        fragment: { module: mipModule, entryPoint: "fs", targets: [{ format: textureFormat }] },
        primitive: { topology: "triangle-list" },
      });
      mipPipelines.set(textureFormat, pipeline);
    }
    const encoder = device.createCommandEncoder();
    for (let level = 1; level < texture.mipLevelCount; level++) {
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) },
          { binding: 1, resource: mipSampler },
        ],
      });
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }), loadOp: "clear", storeOp: "store" }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    }
    device.queue.submit([encoder.finish()]);
  };

  const white = device.createTexture({ size: [1, 1], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: white }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
  const whiteView = white.createView();
  const clampSampler = device.createSampler({ minFilter: "linear", magFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
  const repeatSampler = device.createSampler({ minFilter: "linear", magFilter: "linear", mipmapFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" });

  let meshes: GpuMesh[] = [];
  let textures: GPUTexture[] = [];
  let colorTarget: GPUTexture | null = null;
  let depthTarget: GPUTexture | null = null;

  const uploadTexture = (texture: CustomTexture, srgb: boolean): GPUTexture => {
    const textureFormat: GPUTextureFormat = srgb ? "rgba8unorm-srgb" : "rgba8unorm";
    const { width, height } = texture.image;
    const gpuTexture = device.createTexture({
      size: [width, height],
      format: textureFormat,
      mipLevelCount: mipLevels(width, height),
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    try {
      device.queue.copyExternalImageToTexture({ source: texture.image }, { texture: gpuTexture, premultipliedAlpha: false }, [width, height]);
    } catch {
      // Some implementations can't copy every image source; fall back to reading the pixels on the CPU.
      const scratch = new OffscreenCanvas(width, height);
      const context2d = scratch.getContext("2d", { colorSpace: "srgb" })!;
      context2d.drawImage(texture.image, 0, 0);
      const pixels = context2d.getImageData(0, 0, width, height, { colorSpace: "srgb" }).data;
      device.queue.writeTexture({ texture: gpuTexture }, pixels, { bytesPerRow: width * 4 }, [width, height]);
    }
    generateMips(gpuTexture, textureFormat);
    uploadedBytes += width * height * 4 * (4 / 3);
    textures.push(gpuTexture);
    return gpuTexture;
  };

  const release = () => {
    for (const mesh of meshes) {
      for (const buffer of mesh.buffers) buffer.destroy();
      mesh.index?.destroy();
      for (const part of mesh.parts) part.uniform.destroy();
    }
    for (const texture of textures) texture.destroy();
    meshes = [];
    textures = [];
    uploadedBytes = 0;
  };

  const buffer = (data: Float32Array | Uint32Array, usage: number) => {
    // Buffer sizes must be multiples of 4; all our arrays are 4-byte elements.
    const gpuBuffer = device.createBuffer({ size: Math.max(data.byteLength, 4), usage: usage | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(gpuBuffer, 0, data);
    uploadedBytes += data.byteLength;
    return gpuBuffer;
  };

  return {
    setScene(scene: CustomScene | null) {
      release();
      if (!scene) return;
      const cache = new Map<string, GPUTexture>();
      const viewFor = (texture: CustomTexture | null, srgb: boolean) => {
        if (!texture) return null;
        const key = `${scene.textures.indexOf(texture)}:${srgb}`;
        let gpuTexture = cache.get(key);
        if (!gpuTexture) cache.set(key, (gpuTexture = uploadTexture(texture, srgb)));
        return gpuTexture.createView();
      };
      for (const mesh of scene.meshes) {
        const buffers = [mesh.positions, mesh.normals, mesh.uvs, mesh.colors].map((data) => buffer(data, GPUBufferUsage.VERTEX));
        const index = mesh.indices ? buffer(mesh.indices, GPUBufferUsage.INDEX) : null;
        const parts = mesh.parts.map((part) => {
          const m = part.material;
          const map = viewFor(m.map, true);
          const alphaMap = viewFor(m.alphaMap, false);
          const uniform = buffer(
            new Float32Array([m.color[0], m.color[1], m.color[2], m.opacity, ...materialFlags(m)]),
            GPUBufferUsage.UNIFORM,
          );
          const bindGroup = device.createBindGroup({
            layout: partLayout,
            entries: [
              { binding: 0, resource: { buffer: uniform } },
              { binding: 1, resource: m.map && !m.map.repeat ? clampSampler : repeatSampler },
              { binding: 2, resource: map ?? whiteView },
              { binding: 3, resource: m.alphaMap && !m.alphaMap.repeat ? clampSampler : repeatSampler },
              { binding: 4, resource: alphaMap ?? whiteView },
            ],
          });
          return { start: part.start, count: part.count, material: m, center: part.center, bindGroup, uniform };
        });
        meshes.push({ buffers, index, parts });
      }
    },

    gpuTiming: timing,

    gpuBytes: () => Math.round(uploadedBytes),

    render(frame: FrameParams) {
      if (lost) return { drawCalls: 0, triangles: 0 };
      let drawCalls = 1;
      let triangles = 2;
      if (canvas.width !== frame.width || canvas.height !== frame.height || !colorTarget) {
        canvas.width = frame.width;
        canvas.height = frame.height;
        colorTarget?.destroy();
        depthTarget?.destroy();
        colorTarget = device.createTexture({ size: [frame.width, frame.height], format, sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
        depthTarget = device.createTexture({ size: [frame.width, frame.height], format: DEPTH_FORMAT, sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      }
      const projection = perspective(frame.fovY, frame.width / Math.max(frame.height, 1), frame.near, frame.far, true);
      const key = normalize(LIGHTING.key.direction as unknown as Vec3);
      const fill = normalize(LIGHTING.fill.direction as unknown as Vec3);
      const data = new Float32Array(FRAME_BYTES / 4);
      data.set(multiply(projection, frame.view), 0);
      data.set([...frame.eye, 1], 16);
      data.set([frame.gridCell, frame.gridFade, frame.gridFade, 0], 20);
      data.set([...LIGHTING.skyColor, 1], 24);
      data.set([...LIGHTING.groundColor, 1], 28);
      data.set([...key, LIGHTING.key.intensity], 32);
      data.set([...fill, LIGHTING.fill.intensity], 36);
      device.queue.writeBuffer(frameBuffer, 0, data);

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: colorTarget.createView(),
            resolveTarget: context.getCurrentTexture().createView(),
            clearValue: { r: CLEAR_SRGB[0], g: CLEAR_SRGB[1], b: CLEAR_SRGB[2], a: 1 },
            loadOp: "clear",
            storeOp: "discard",
          },
        ],
        depthStencilAttachment: { view: depthTarget!.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
        ...(querySet ? { timestampWrites: { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {}),
      });
      pass.setBindGroup(0, frameGroup);
      pass.setPipeline(gridPipeline);
      pass.setVertexBuffer(0, gridBuffer);
      pass.draw(4);

      const draws = meshes.flatMap((mesh) => mesh.parts.map((part) => ({ mesh, part })));
      const depth = (p: Vec3) => transformPoint(frame.view, p)[2];
      const opaque = draws.filter((d) => !d.part.material.transparent);
      const transparent = draws.filter((d) => d.part.material.transparent).sort((a, b) => depth(a.part.center) - depth(b.part.center));
      for (const { mesh, part } of [...opaque, ...transparent]) {
        const m = part.material;
        pass.setPipeline(meshPipeline(m.side === "double" ? "none" : m.side === "back" ? "front" : "back", m.transparent));
        pass.setBindGroup(1, part.bindGroup);
        mesh.buffers.forEach((b, slot) => pass.setVertexBuffer(slot, b));
        drawCalls++;
        triangles += part.count / 3;
        if (mesh.index) {
          pass.setIndexBuffer(mesh.index, "uint32");
          pass.drawIndexed(part.count, 1, part.start);
        } else {
          pass.draw(part.count, 1, part.start);
        }
      }
      pass.end();
      // Read the pass's start/end timestamps back without stalling: skip
      // frames while the previous readback is still mapping.
      const measure = querySet && resolveBuffer && readBuffer && !reading;
      if (measure) {
        encoder.resolveQuerySet(querySet, 0, 2, resolveBuffer, 0);
        encoder.copyBufferToBuffer(resolveBuffer, 0, readBuffer, 0, 16);
      }
      device.queue.submit([encoder.finish()]);
      if (measure) {
        reading = true;
        readBuffer.mapAsync(GPUMapMode.READ).then(
          () => {
            const [begin, end] = new BigUint64Array(readBuffer.getMappedRange());
            readBuffer.unmap();
            reading = false;
            if (end! > begin!) onGpuTime(Number(end! - begin!) / 1e6);
          },
          () => {
            reading = false;
          },
        );
      }
      return { drawCalls, triangles };
    },

    dispose() {
      release();
      querySet?.destroy();
      resolveBuffer?.destroy();
      readBuffer?.destroy();
      colorTarget?.destroy();
      depthTarget?.destroy();
      white.destroy();
      gridBuffer.destroy();
      frameBuffer.destroy();
      context.unconfigure();
      device.destroy();
    },
  };
}
