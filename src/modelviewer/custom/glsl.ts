import { ENV } from "../lighting";

const v3 = (c: readonly number[]) => `vec3(${c.map((x) => x.toFixed(4)).join(", ")})`;

/** Physically based shading shared by both custom renderers (GLSL flavour). */
const PBR_GLSL = /* glsl */ `
const float PI = 3.141592653589793;
const vec3 ENV_ZENITH = ${v3(ENV.zenith)};
const vec3 ENV_HORIZON = ${v3(ENV.horizon)};
const vec3 ENV_FLOOR = ${v3(ENV.floor)};
const float SOFTBOX_INTENSITY = ${ENV.softbox.intensity.toFixed(4)};
const float SOFTBOX_EXPONENT = ${ENV.softbox.exponent.toFixed(4)};

vec3 envGradient(vec3 d) {
  return d.y >= 0.0 ? mix(ENV_HORIZON, ENV_ZENITH, sqrt(d.y)) : mix(ENV_HORIZON, ENV_FLOOR, min(1.0, -d.y * 4.0));
}
// Environment radiance pre-blurred for a GGX lobe of this roughness: the
// gradient fades toward its hemisphere average, and the softbox lobe widens
// (two Phong lobes convolved) with its energy kept.
vec3 envSpecular(vec3 r, float roughness, vec3 k) {
  float a = roughness * roughness;
  vec3 g = mix(envGradient(r), mix(ENV_FLOOR, ENV_ZENITH, 0.5 * r.y + 0.5) * 0.9, a);
  float p = max(2.0 / (a * a + 1e-4) - 2.0, 1.0);
  float pc = 1.0 / (1.0 / SOFTBOX_EXPONENT + 1.0 / p);
  return g + SOFTBOX_INTENSITY * (pc + 2.0) / (SOFTBOX_EXPONENT + 2.0) * pow(max(dot(r, k), 0.0), pc);
}
// Irradiance divided by pi (so diffuse = albedo * envDiffuse).
vec3 envDiffuse(vec3 n, vec3 k) {
  vec3 g = mix(ENV_FLOOR, mix(ENV_HORIZON, ENV_ZENITH, 0.6), 0.5 * n.y + 0.5);
  return g + SOFTBOX_INTENSITY * 2.0 / (SOFTBOX_EXPONENT + 1.0) * max(dot(n, k), 0.0);
}
vec2 envBrdfApprox(float roughness, float nDotV) {
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = roughness * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * nDotV)) * r.x + r.y;
  return vec2(-1.04, 1.04) * a004 + r.zw;
}
// Cook-Torrance: GGX distribution, height-correlated Smith visibility, Schlick Fresnel.
vec3 shadePbr(vec3 base, float metallic, float roughness, vec3 n, vec3 v, vec4 key) {
  roughness = clamp(roughness, 0.045, 1.0);
  float a = roughness * roughness;
  vec3 f0 = mix(vec3(0.04), base, metallic);
  vec3 albedo = base * (1.0 - metallic);
  float nv = max(dot(n, v), 1e-4);
  vec3 l = key.xyz;
  vec3 h = normalize(l + v);
  float nl = max(dot(n, l), 0.0);
  float nh = max(dot(n, h), 0.0);
  float vh = max(dot(v, h), 0.0);
  float a2 = a * a;
  float d = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * d * d);
  float Vis = 0.5 / max(nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2), 1e-5);
  vec3 F = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
  vec3 direct = ((1.0 - F) * albedo / PI + D * Vis * F) * nl * key.w;
  vec2 ab = envBrdfApprox(roughness, nv);
  vec3 r = reflect(-v, n);
  vec3 ambient = albedo * envDiffuse(n, l) + envSpecular(r, roughness, l) * (f0 * ab.x + ab.y);
  return direct + ambient;
}
`;

export const MESH_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec3 aColor;
uniform mat4 uViewProj;
out vec3 vPosition;
out vec3 vNormal;
out vec2 vUv;
out vec3 vColor;
void main() {
  vPosition = aPosition;
  vNormal = aNormal;
  vUv = aUv;
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}`;

export const MESH_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vPosition;
in vec3 vNormal;
in vec2 vUv;
in vec3 vColor;
uniform sampler2D uMap;
uniform sampler2D uAlphaMap;
uniform vec4 uColor;     // linear rgb, opacity
uniform vec4 uFlags;     // hasMap, hasAlphaMap, blend (1) or -alphaCutoff, smooth normals
uniform vec3 uEye;
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec4 uKey;       // direction to light (normalized), intensity
uniform vec4 uFill;
uniform vec4 uPbr;       // metallic, roughness, mode (1 = PBR), unused
out vec4 outColor;
${PBR_GLSL}

const float RECIPROCAL_PI = 0.3183098861837907;

vec3 rrtAndOdtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFilmic(vec3 color) {
  const mat3 inputMatrix = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outputMatrix = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = inputMatrix * (color / 0.6);
  color = outputMatrix * rrtAndOdtFit(color);
  return clamp(color, 0.0, 1.0);
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main() {
  vec4 base = vec4(uColor.rgb * vColor, 1.0);
  if (uFlags.x > 0.5) base *= texture(uMap, vUv);
  float alpha = base.a * uColor.a;
  if (uFlags.y > 0.5) alpha *= texture(uAlphaMap, vUv).g;
  if (uFlags.z < 0.0 && alpha < -uFlags.z) discard;

  vec3 viewDir = normalize(uEye - vPosition);
  vec3 n;
  if (uFlags.w > 0.5) {
    n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n; // double-sided: light the back face with its own normal
  } else {
    n = normalize(cross(dFdx(vPosition), dFdy(vPosition)));
    if (dot(n, viewDir) < 0.0) n = -n;
  }

  if (uPbr.z > 0.5) {
    outColor = vec4(linearToSrgb(acesFilmic(shadePbr(base.rgb, uPbr.x, uPbr.y, n, viewDir, uKey))), uFlags.z > 0.5 ? alpha : 1.0);
    return;
  }
  vec3 irradiance = mix(uGround, uSky, 0.5 * n.y + 0.5);
  vec3 diffuse = irradiance;
  float spec = 0.0;
  for (int i = 0; i < 2; i++) {
    vec4 light = i == 0 ? uKey : uFill;
    float ndl = max(dot(n, light.xyz), 0.0);
    diffuse += ndl * light.w;
    vec3 h = normalize(light.xyz + viewDir);
    spec += pow(max(dot(n, h), 0.0), 30.0) * ndl * light.w * 0.04;
  }
  vec3 color = base.rgb * RECIPROCAL_PI * diffuse + spec;
  outColor = vec4(linearToSrgb(acesFilmic(color)), uFlags.z > 0.5 ? alpha : 1.0);
}`;

export const GRID_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aCorner;
uniform mat4 uViewProj;
uniform vec4 uGrid; // cell, fade distance, extent, unused
uniform vec3 uEye;
out vec3 vPosition;
void main() {
  vec3 p = vec3(aCorner.x * uGrid.z + uEye.x, 0.0, aCorner.y * uGrid.z + uEye.z);
  vPosition = p;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

export const GRID_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vPosition;
uniform vec4 uGrid;
uniform vec3 uEye;
out vec4 outColor;
float lineAt(vec2 coord, float width) {
  vec2 d = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
  return 1.0 - min(min(d.x, d.y) / width, 1.0);
}
void main() {
  float cell = lineAt(vPosition.xz / uGrid.x, 1.0);
  float section = lineAt(vPosition.xz / (uGrid.x * 5.0), 1.5);
  float fade = 1.0 - min(distance(vPosition.xz, uEye.xz) / uGrid.y, 1.0);
  fade = pow(fade, 1.5);
  vec3 cellColor = vec3(0.839, 0.827, 0.808);    // #d6d3ce
  vec3 sectionColor = vec3(0.702, 0.682, 0.655); // #b3aea7
  float a = max(cell, section) * fade;
  if (a <= 0.0) discard;
  outColor = vec4(section > cell ? sectionColor : cellColor, a);
}`;
