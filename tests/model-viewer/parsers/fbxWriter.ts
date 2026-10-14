// Minimal binary FBX writer for tests: 7.4 (32-bit offsets) or 7.5 (64-bit),
// scalar and array properties, optional zlib-compressed arrays.
import { deflateSync } from "node:zlib";

const enc = new TextEncoder();

export type Prop =
  | ["S", string]
  | ["D", number]
  | ["I", number]
  | ["L", number]
  | ["R", Uint8Array]
  | ["d" | "i", number[], { zip?: boolean }?];

export interface Node {
  name: string;
  props?: Prop[];
  children?: Node[];
}

function bytes(write: (v: DataView) => void, size: number): number[] {
  const v = new DataView(new ArrayBuffer(size));
  write(v);
  return [...new Uint8Array(v.buffer)];
}

function encodeProps(props: Prop[]): number[] {
  const out: number[] = [];
  for (const prop of props) {
    const type = prop[0];
    out.push(type.charCodeAt(0));
    switch (type) {
      case "S":
      case "R": {
        const data = type === "S" ? enc.encode(prop[1] as string) : (prop[1] as Uint8Array);
        out.push(...bytes((v) => v.setUint32(0, data.length, true), 4), ...data);
        break;
      }
      case "D": out.push(...bytes((v) => v.setFloat64(0, prop[1] as number, true), 8)); break;
      case "I": out.push(...bytes((v) => v.setInt32(0, prop[1] as number, true), 4)); break;
      case "L": out.push(...bytes((v) => v.setBigInt64(0, BigInt(prop[1] as number), true), 8)); break;
      case "d":
      case "i": {
        const values = prop[1] as number[];
        const size = type === "d" ? 8 : 4;
        let raw = new Uint8Array(values.length * size);
        const dv = new DataView(raw.buffer);
        values.forEach((x, i) => (type === "d" ? dv.setFloat64(i * 8, x, true) : dv.setInt32(i * 4, x, true)));
        const zip = !!(prop[2] as { zip?: boolean } | undefined)?.zip;
        if (zip) raw = new Uint8Array(deflateSync(raw));
        out.push(
          ...bytes((v) => {
            v.setUint32(0, values.length, true);
            v.setUint32(4, zip ? 1 : 0, true);
            v.setUint32(8, raw.length, true);
          }, 12),
          ...raw,
        );
        break;
      }
    }
  }
  return out;
}

function encodeNode(node: Node, offset: number, wide: boolean): Uint8Array {
  const propBytes = encodeProps(node.props ?? []);
  const name = enc.encode(node.name);
  const head = wide ? 25 : 13;
  const headerLength = head + name.length + propBytes.length;
  const children: Uint8Array[] = [];
  let cursor = offset + headerLength;
  for (const child of node.children ?? []) {
    const c = encodeNode(child, cursor, wide);
    children.push(c);
    cursor += c.length;
  }
  if (node.children?.length) {
    children.push(new Uint8Array(head));
    cursor += head;
  }
  const out = new Uint8Array(cursor - offset);
  const view = new DataView(out.buffer);
  if (wide) {
    view.setBigUint64(0, BigInt(cursor), true);
    view.setBigUint64(8, BigInt(node.props?.length ?? 0), true);
    view.setBigUint64(16, BigInt(propBytes.length), true);
  } else {
    view.setUint32(0, cursor, true);
    view.setUint32(4, node.props?.length ?? 0, true);
    view.setUint32(8, propBytes.length, true);
  }
  out[head - 1] = name.length;
  out.set(name, head);
  out.set(propBytes, head + name.length);
  let p = headerLength;
  for (const c of children) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export function writeBinaryFbx(nodes: Node[], version = 7400): Uint8Array {
  const wide = version >= 7500;
  const header = new Uint8Array(27);
  header.set(enc.encode("Kaydara FBX Binary  \u0000"), 0);
  header[21] = 0x1a;
  new DataView(header.buffer).setUint32(23, version, true);
  const parts: Uint8Array[] = [header];
  let offset = 27;
  for (const n of nodes) {
    const e = encodeNode(n, offset, wide);
    parts.push(e);
    offset += e.length;
  }
  const terminator = new Uint8Array(wide ? 25 : 13);
  const footer = new Uint8Array(176); // real files end with a ~160-byte footer
  parts.push(terminator, footer);
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

// Convenience builders.
export const P = (name: string, type: string, ...values: Prop[]): Node => ({
  name: "P",
  props: [["S", name], ["S", type], ["S", ""], ["S", "A"], ...values],
});
export const p70 = (...ps: Node[]): Node => ({ name: "Properties70", children: ps });
export const C = (kind: string, from: number, to: number, rel?: string): Node => ({
  name: "C",
  props: [["S", kind], ["L", from], ["L", to], ...(rel ? ([["S", rel]] as Prop[]) : [])],
});
