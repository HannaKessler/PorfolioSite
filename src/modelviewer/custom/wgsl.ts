import { ENV } from "../lighting";

const v3 = (c: readonly number[]) => `vec3f(${c.map((x) => x.toFixed(4)).join(", ")})`;
const ENV_WGSL = `
const ENV_ZENITH = ${v3(ENV.zenith)};
const ENV_HORIZON = ${v3(ENV.horizon)};
const ENV_FLOOR = ${v3(ENV.floor)};
const SOFTBOX_INTENSITY = ${ENV.softbox.intensity.toFixed(4)};
const SOFTBOX_EXPONENT = ${ENV.softbox.exponent.toFixed(4)};
`;

// WGSL counterparts of glsl.ts. Bind group 0: per frame; group 1: per part.
const COMMON = /* wgsl */ `
struct Frame {
  viewProj: mat4x4f,
  eye: vec4f,
  grid: vec4f,   // cell, fade distance, extent, lighting mode (1 = PBR)
  sky: vec4f,
  ground: vec4f,
  key: vec4f,    // direction to light, intensity
  fill: vec4f,
};
@group(0) @binding(0) var<uniform> frame: Frame;
`;

export const MESH_WGSL = /* wgsl */ `${COMMON}
struct Part {
  color: vec4f,  // linear rgb, opacity
  flags: vec4f,  // hasMap, hasAlphaMap, blend (1) or -alphaCutoff, smooth normals
  pbr: vec4f,    // metallic, roughness, unused, unused
};
@group(1) @binding(0) var<uniform> part: Part;
@group(1) @binding(1) var mapSampler: sampler;
@group(1) @binding(2) var mapTexture: texture_2d<f32>;
@group(1) @binding(3) var alphaSampler: sampler;
@group(1) @binding(4) var alphaTexture: texture_2d<f32>;

struct VertexOut {
  @builtin(position) clip: vec4f,
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) color: vec3f,
};

@vertex
fn vs(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f, @location(3) color: vec3f) -> VertexOut {
  var out: VertexOut;
  out.clip = frame.viewProj * vec4f(position, 1.0);
  out.position = position;
  out.normal = normal;
  out.uv = uv;
  out.color = color;
  return out;
}

const RECIPROCAL_PI = 0.3183098861837907;
${ENV_WGSL}
const PI = 3.141592653589793;
fn envGradient(d: vec3f) -> vec3f {
  return select(mix(ENV_HORIZON, ENV_FLOOR, min(1.0, -d.y * 4.0)), mix(ENV_HORIZON, ENV_ZENITH, sqrt(max(d.y, 0.0))), d.y >= 0.0);
}
fn envSpecular(r: vec3f, roughness: f32, k: vec3f) -> vec3f {
  let a = roughness * roughness;
  let g = mix(envGradient(r), mix(ENV_FLOOR, ENV_ZENITH, 0.5 * r.y + 0.5) * 0.9, a);
  let p = max(2.0 / (a * a + 1e-4) - 2.0, 1.0);
  let pc = 1.0 / (1.0 / SOFTBOX_EXPONENT + 1.0 / p);
  return g + SOFTBOX_INTENSITY * (pc + 2.0) / (SOFTBOX_EXPONENT + 2.0) * pow(max(dot(r, k), 0.0), pc);
}
fn envDiffuse(n: vec3f, k: vec3f) -> vec3f {
  let g = mix(ENV_FLOOR, mix(ENV_HORIZON, ENV_ZENITH, 0.6), 0.5 * n.y + 0.5);
  return g + SOFTBOX_INTENSITY * 2.0 / (SOFTBOX_EXPONENT + 1.0) * max(dot(n, k), 0.0);
}
fn envBrdfApprox(roughness: f32, nDotV: f32) -> vec2f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let r = roughness * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * nDotV)) * r.x + r.y;
  return vec2f(-1.04, 1.04) * a004 + r.zw;
}
fn shadePbr(base: vec3f, metallic: f32, roughnessIn: f32, n: vec3f, v: vec3f, key: vec4f) -> vec3f {
  let roughness = clamp(roughnessIn, 0.045, 1.0);
  let a = roughness * roughness;
  let f0 = mix(vec3f(0.04), base, metallic);
  let albedo = base * (1.0 - metallic);
  let nv = max(dot(n, v), 1e-4);
  let l = key.xyz;
  let h = normalize(l + v);
  let nl = max(dot(n, l), 0.0);
  let nh = max(dot(n, h), 0.0);
  let vh = max(dot(v, h), 0.0);
  let a2 = a * a;
  let d = nh * nh * (a2 - 1.0) + 1.0;
  let D = a2 / (PI * d * d);
  let Vis = 0.5 / max(nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2), 1e-5);
  let F = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
  let direct = ((1.0 - F) * albedo / PI + D * Vis * F) * nl * key.w;
  let ab = envBrdfApprox(roughness, nv);
  let r = reflect(-v, n);
  return direct + albedo * envDiffuse(n, l) + envSpecular(r, roughness, l) * (f0 * ab.x + ab.y);
}

fn rrtAndOdtFit(v: vec3f) -> vec3f {
  let a = v * (v + 0.0245786) - 0.000090537;
  let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
fn acesFilmic(colorIn: vec3f) -> vec3f {
  let inputMatrix = mat3x3f(vec3f(0.59719, 0.07600, 0.02840), vec3f(0.35458, 0.90834, 0.13383), vec3f(0.04823, 0.01566, 0.83777));
  let outputMatrix = mat3x3f(vec3f(1.60475, -0.10208, -0.00327), vec3f(-0.53108, 1.10813, -0.07276), vec3f(-0.07367, -0.00605, 1.07602));
  var color = inputMatrix * (colorIn / 0.6);
  color = outputMatrix * rrtAndOdtFit(color);
  return clamp(color, vec3f(0.0), vec3f(1.0));
}
fn linearToSrgb(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}

@fragment
fn fs(in: VertexOut, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4f {
  // Sample unconditionally (uniform control flow); a 1x1 white texture stands in for missing maps.
  let mapSample = textureSample(mapTexture, mapSampler, in.uv);
  let alphaSample = textureSample(alphaTexture, alphaSampler, in.uv);
  let flatNormal = normalize(cross(dpdx(in.position), dpdy(in.position)));

  var base = vec4f(part.color.rgb * in.color, 1.0);
  if (part.flags.x > 0.5) { base *= mapSample; }
  var alpha = base.a * part.color.a;
  if (part.flags.y > 0.5) { alpha *= alphaSample.g; }
  if (part.flags.z < 0.0 && alpha < -part.flags.z) { discard; }

  let viewDir = normalize(frame.eye.xyz - in.position);
  var n: vec3f;
  if (part.flags.w > 0.5) {
    n = normalize(in.normal);
    if (!frontFacing) { n = -n; }
  } else {
    n = flatNormal;
    if (dot(n, viewDir) < 0.0) { n = -n; }
  }

  if (frame.grid.w > 0.5) {
    return vec4f(linearToSrgb(acesFilmic(shadePbr(base.rgb, part.pbr.x, part.pbr.y, n, viewDir, frame.key))), select(1.0, alpha, part.flags.z > 0.5));
  }
  var diffuse = mix(frame.ground.rgb, frame.sky.rgb, 0.5 * n.y + 0.5);
  var spec = 0.0;
  for (var i = 0; i < 2; i++) {
    let light = select(frame.fill, frame.key, i == 0);
    let ndl = max(dot(n, light.xyz), 0.0);
    diffuse += ndl * light.w;
    let h = normalize(light.xyz + viewDir);
    spec += pow(max(dot(n, h), 0.0), 30.0) * ndl * light.w * 0.04;
  }
  let color = base.rgb * RECIPROCAL_PI * diffuse + spec;
  return vec4f(linearToSrgb(acesFilmic(color)), select(1.0, alpha, part.flags.z > 0.5));
}
`;

export const GRID_WGSL = /* wgsl */ `${COMMON}
struct VertexOut {
  @builtin(position) clip: vec4f,
  @location(0) position: vec3f,
};

@vertex
fn vs(@location(0) corner: vec2f) -> VertexOut {
  var out: VertexOut;
  let p = vec3f(corner.x * frame.grid.z + frame.eye.x, 0.0, corner.y * frame.grid.z + frame.eye.z);
  out.position = p;
  out.clip = frame.viewProj * vec4f(p, 1.0);
  return out;
}

fn lineAt(coord: vec2f, width: f32) -> f32 {
  let d = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
  return 1.0 - min(min(d.x, d.y) / width, 1.0);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  let cell = lineAt(in.position.xz / frame.grid.x, 1.0);
  let section = lineAt(in.position.xz / (frame.grid.x * 5.0), 1.5);
  let fade = pow(1.0 - min(distance(in.position.xz, frame.eye.xz) / frame.grid.y, 1.0), 1.5);
  let a = max(cell, section) * fade;
  if (a <= 0.0) { discard; }
  let color = select(vec3f(0.839, 0.827, 0.808), vec3f(0.702, 0.682, 0.655), section > cell);
  return vec4f(color, a);
}
`;

/** Full-screen triangle that downsamples one mip level into the next. */
export const MIPMAP_WGSL = /* wgsl */ `
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
struct VertexOut { @builtin(position) clip: vec4f, @location(0) uv: vec2f };
@vertex
fn vs(@builtin(vertex_index) i: u32) -> VertexOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: VertexOut;
  out.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}
@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  return textureSample(source, linearSampler, in.uv);
}
`;
