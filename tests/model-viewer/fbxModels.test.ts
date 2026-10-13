import { describe, expect, it } from "vitest";
import { readFbxModelFlags } from "../../src/modelviewer/fbxModels";

const enc = new TextEncoder();
const ascii = (text: string) => enc.encode(text).buffer as ArrayBuffer;

// Minimal binary FBX writer (version 7400, 32-bit offsets) for tests.
type Prop = ["S", string] | ["D", number] | ["I", number] | ["L", number];
interface Node { name: string; props?: Prop[]; children?: Node[] }

function encodeNode(node: Node, offset: number): Uint8Array {
  const propBytes: number[] = [];
  for (const [type, value] of node.props ?? []) {
    propBytes.push(type.charCodeAt(0));
    const b = new DataView(new ArrayBuffer(8));
    if (type === "S") {
      const s = enc.encode(value as string);
      const len = new DataView(new ArrayBuffer(4)); len.setUint32(0, s.length, true);
      propBytes.push(...new Uint8Array(len.buffer), ...s);
    } else if (type === "D") { b.setFloat64(0, value as number, true); propBytes.push(...new Uint8Array(b.buffer)); }
    else if (type === "L") { b.setBigInt64(0, BigInt(value as number), true); propBytes.push(...new Uint8Array(b.buffer)); }
    else { b.setInt32(0, value as number, true); propBytes.push(...new Uint8Array(b.buffer, 0, 4)); }
  }
  const name = enc.encode(node.name);
  const headerLength = 13 + name.length + propBytes.length;
  const children: Uint8Array[] = [];
  let cursor = offset + headerLength;
  for (const child of node.children ?? []) { const c = encodeNode(child, cursor); children.push(c); cursor += c.length; }
  if (node.children?.length) { children.push(new Uint8Array(13)); cursor += 13; }
  const out = new Uint8Array(cursor - offset);
  const view = new DataView(out.buffer);
  view.setUint32(0, cursor, true);
  view.setUint32(4, node.props?.length ?? 0, true);
  view.setUint32(8, propBytes.length, true);
  out[12] = name.length;
  out.set(name, 13);
  out.set(propBytes, 13 + name.length);
  let p = headerLength;
  for (const c of children) { out.set(c, p); p += c.length; }
  return out;
}

function binary(nodes: Node[]): ArrayBuffer {
  const header = new Uint8Array(27);
  header.set(enc.encode("Kaydara FBX Binary  \u0000"), 0);
  header[21] = 0x1a;
  new DataView(header.buffer).setUint32(23, 7400, true);
  const parts: Uint8Array[] = [header];
  let offset = 27;
  for (const n of nodes) { const e = encodeNode(n, offset); parts.push(e); offset += e.length; }
  parts.push(new Uint8Array(13));
  const out = new Uint8Array(offset + 13);
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out.buffer;
}

const model = (name: string, children: Node[]): Node => ({
  name: "Model",
  props: [["L", 1], ["S", `${name}\u0000\u0001Model`], ["S", "Mesh"]],
  children,
});
const p70 = (...ps: Node[]): Node => ({ name: "Properties70", children: ps });
const P = (name: string, type: string, value: Prop): Node => ({ name: "P", props: [["S", name], ["S", type], ["S", ""], ["S", ""], value] });

describe("readFbxModelFlags (binary)", () => {
  it("reads Culling, Visibility and Show per model", () => {
    const flags = readFbxModelFlags(binary([{ name: "Objects", children: [
      model("Grass.001", [p70(P("Visibility", "Visibility", ["D", 1])), { name: "Culling", props: [["S", "CullingOff"]] }]),
      model("Hidden", [p70(P("Visibility", "Visibility", ["D", 0])), { name: "Culling", props: [["S", "CullingOnCCW"]] }]),
      model("NotShown", [p70(P("Show", "bool", ["I", 0]))]),
    ] }]));
    expect([...flags.doubleSided]).toEqual(["Grass.001"]);
    expect([...flags.hidden].sort()).toEqual(["Hidden", "NotShown"]);
  });
});

describe("readFbxModelFlags (ASCII)", () => {
  it("reads the same settings from text FBX", () => {
    const text = `; FBX 7.4.0 project file
Objects:  {
  Model: 1, "Model::Leaves", "Mesh" {
    Properties70:  {
      P: "Visibility", "Visibility", "", "A",1
    }
    Culling: "CullingOff"
  }
  Model: 2, "Model::Helper", "Mesh" {
    Properties70:  {
      P: "Show", "bool", "", "",0
    }
    Culling: "CullingOnCCW"
  }
}`;
    const flags = readFbxModelFlags(ascii(text));
    expect([...flags.doubleSided]).toEqual(["Leaves"]);
    expect([...flags.hidden]).toEqual(["Helper"]);
  });
});
