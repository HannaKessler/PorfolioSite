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
out vec4 outColor;

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
