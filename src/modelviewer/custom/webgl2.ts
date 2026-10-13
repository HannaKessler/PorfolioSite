// Hand-written WebGL2 renderer for the custom panes. No rendering library.
import type { CustomMaterial, CustomScene, CustomTexture } from "./customScene";
import { multiply, normalize, perspective, transformPoint, type Vec3 } from "../mat4";
import { CLEAR_SRGB, LIGHTING, type CustomRenderer, type FrameParams } from "./renderer";
import { GRID_FS, GRID_VS, MESH_FS, MESH_VS } from "./glsl";

interface GpuPart {
  start: number;
  count: number;
  material: CustomMaterial;
  center: Vec3;
  map: WebGLTexture | null;
  alphaMap: WebGLTexture | null;
}
interface GpuMesh {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  indexed: boolean;
  smooth: boolean;
  parts: GpuPart[];
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Shader error: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Link error: ${gl.getProgramInfoLog(program)}`);
  return program;
}

function uniforms(gl: WebGL2RenderingContext, program: WebGLProgram, names: string[]) {
  return Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)])) as Record<string, WebGLUniformLocation | null>;
}

export function createWebGL2Renderer(canvas: HTMLCanvasElement): CustomRenderer {
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error("WebGL2 isn't available in this browser.");

  const meshProgram = compile(gl, MESH_VS, MESH_FS);
  const meshU = uniforms(gl, meshProgram, ["uViewProj", "uMap", "uAlphaMap", "uColor", "uFlags", "uEye", "uSky", "uGround", "uKey", "uFill"]);
  const gridProgram = compile(gl, GRID_VS, GRID_FS);
  const gridU = uniforms(gl, gridProgram, ["uViewProj", "uGrid", "uEye"]);

  const gridVao = gl.createVertexArray()!;
  const gridBuffer = gl.createBuffer()!;
  gl.bindVertexArray(gridVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const white = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, white);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));

  let meshes: GpuMesh[] = [];
  let textures: WebGLTexture[] = [];

  const uploadTexture = (texture: CustomTexture, srgb: boolean): WebGLTexture => {
    const handle = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // already flipped when decoded
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, texture.image);
    gl.generateMipmap(gl.TEXTURE_2D);
    const wrap = texture.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    textures.push(handle);
    return handle;
  };

  const release = () => {
    for (const mesh of meshes) {
      gl.deleteVertexArray(mesh.vao);
      for (const buffer of mesh.buffers) gl.deleteBuffer(buffer);
    }
    for (const texture of textures) gl.deleteTexture(texture);
    meshes = [];
    textures = [];
  };

  return {
    setScene(scene) {
      release();
      if (!scene) return;
      // Colour maps are sRGB, opacity maps are linear data: upload each image once per use.
      const cache = new Map<string, WebGLTexture>();
      const textureFor = (texture: CustomTexture | null, srgb: boolean) => {
        if (!texture) return null;
        const key = `${scene.textures.indexOf(texture)}:${srgb}`;
        let handle = cache.get(key);
        if (!handle) cache.set(key, (handle = uploadTexture(texture, srgb)));
        return handle;
      };
      for (const mesh of scene.meshes) {
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        const buffers: WebGLBuffer[] = [];
        for (const [location, data, size] of [[0, mesh.positions, 3], [1, mesh.normals, 3], [2, mesh.uvs, 2], [3, mesh.colors, 3]] as const) {
          const buffer = gl.createBuffer()!;
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
          buffers.push(buffer);
        }
        if (mesh.indices) {
          const buffer = gl.createBuffer()!;
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
          buffers.push(buffer);
        }
        gl.bindVertexArray(null);
        meshes.push({
          vao,
          buffers,
          indexed: !!mesh.indices,
          smooth: mesh.hasNormals,
          parts: mesh.parts.map((part) => ({
            ...part,
            map: textureFor(part.material.map, true),
            alphaMap: textureFor(part.material.alphaMap, false),
          })),
        });
      }
    },

    render(frame: FrameParams) {
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
      }
      gl.viewport(0, 0, frame.width, frame.height);
      gl.clearColor(CLEAR_SRGB[0], CLEAR_SRGB[1], CLEAR_SRGB[2], 1);
      gl.clearDepth(1);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const projection = perspective(frame.fovY, frame.width / Math.max(frame.height, 1), frame.near, frame.far, false);
      const viewProj = multiply(projection, frame.view);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      // Grid first, blended, without writing depth (as in the three.js pane).
      gl.useProgram(gridProgram);
      gl.uniformMatrix4fv(gridU.uViewProj!, false, viewProj);
      gl.uniform4f(gridU.uGrid!, frame.gridCell, frame.gridFade, frame.gridFade, 0);
      gl.uniform3fv(gridU.uEye!, frame.eye);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      gl.bindVertexArray(gridVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.useProgram(meshProgram);
      gl.uniformMatrix4fv(meshU.uViewProj!, false, viewProj);
      gl.uniform3fv(meshU.uEye!, frame.eye);
      gl.uniform3fv(meshU.uSky!, LIGHTING.skyColor);
      gl.uniform3fv(meshU.uGround!, LIGHTING.groundColor);
      const key = normalize(LIGHTING.key.direction as unknown as Vec3);
      const fill = normalize(LIGHTING.fill.direction as unknown as Vec3);
      gl.uniform4f(meshU.uKey!, key[0], key[1], key[2], LIGHTING.key.intensity);
      gl.uniform4f(meshU.uFill!, fill[0], fill[1], fill[2], LIGHTING.fill.intensity);
      gl.uniform1i(meshU.uMap!, 0);
      gl.uniform1i(meshU.uAlphaMap!, 1);

      // Opaque parts first, then transparent ones back to front without depth writes.
      const draws = meshes.flatMap((mesh) => mesh.parts.map((part) => ({ mesh, part })));
      const opaque = draws.filter((d) => !d.part.material.transparent);
      const view = frame.view;
      const depth = (p: Vec3) => transformPoint(view, p)[2]; // more negative = farther
      const transparent = draws.filter((d) => d.part.material.transparent).sort((a, b) => depth(a.part.center) - depth(b.part.center));

      for (const { mesh, part } of [...opaque, ...transparent]) {
        const m = part.material;
        if (m.side === "double") gl.disable(gl.CULL_FACE);
        else {
          gl.enable(gl.CULL_FACE);
          gl.cullFace(m.side === "back" ? gl.FRONT : gl.BACK);
        }
        if (m.transparent) {
          gl.enable(gl.BLEND);
          gl.depthMask(false);
        } else {
          gl.disable(gl.BLEND);
          gl.depthMask(true);
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, part.map ?? white);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, part.alphaMap ?? white);
        gl.uniform4f(meshU.uColor!, m.color[0], m.color[1], m.color[2], m.opacity);
        gl.uniform4f(meshU.uFlags!, part.map ? 1 : 0, part.alphaMap ? 1 : 0, m.transparent ? 1 : 0, mesh.smooth && !m.flatShading ? 1 : 0);
        gl.bindVertexArray(mesh.vao);
        if (mesh.indexed) gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_INT, part.start * 4);
        else gl.drawArrays(gl.TRIANGLES, part.start, part.count);
      }
      gl.bindVertexArray(null);
      gl.depthMask(true);
    },

    dispose() {
      release();
      gl.deleteProgram(meshProgram);
      gl.deleteProgram(gridProgram);
      gl.deleteVertexArray(gridVao);
      gl.deleteBuffer(gridBuffer);
      gl.deleteTexture(white);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
