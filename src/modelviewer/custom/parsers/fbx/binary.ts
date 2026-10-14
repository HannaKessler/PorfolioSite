// Binary FBX 7.x (including 64-bit offsets for version ≥ 7500).
import { inflateZlib } from "./inflate";
import type { FbxNode, FbxTree } from "./tree";

const MAGIC = "Kaydara FBX Binary  ";

export function isBinaryFbx(data: Uint8Array): boolean {
  if (data.length < MAGIC.length) return false;
  for (let i = 0; i < MAGIC.length; i++) if (data[i] !== MAGIC.charCodeAt(i)) return false;
  return true;
}

export async function parseBinaryFbx(data: Uint8Array): Promise<FbxTree> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();
  let o = 23;
  const version = view.getUint32(o, true);
  o += 4;
  if (version < 6400) throw new Error(`FBX version ${version} is not supported.`);
  const wide = version >= 7500;

  const readU = (): number => {
    const v = wide ? Number(view.getBigUint64(o, true)) : view.getUint32(o, true);
    o += wide ? 8 : 4;
    return v;
  };

  const readArray = async (type: string): Promise<number[] | boolean[]> => {
    const arrayLength = view.getUint32(o, true);
    const encoding = view.getUint32(o + 4, true);
    const compressedLength = view.getUint32(o + 8, true);
    o += 12;
    let bytes: Uint8Array;
    if (encoding === 0) {
      bytes = data.subarray(o, o + compressedLength);
      o += compressedLength;
    } else {
      const compressed = data.subarray(o, o + compressedLength);
      o += compressedLength;
      bytes = await inflateZlib(compressed);
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out: number[] | boolean[] = [];
    let p = 0;
    switch (type) {
      case "f":
        for (let i = 0; i < arrayLength; i++, p += 4) (out as number[]).push(dv.getFloat32(p, true));
        break;
      case "d":
        for (let i = 0; i < arrayLength; i++, p += 8) (out as number[]).push(dv.getFloat64(p, true));
        break;
      case "i":
        for (let i = 0; i < arrayLength; i++, p += 4) (out as number[]).push(dv.getInt32(p, true));
        break;
      case "l":
        for (let i = 0; i < arrayLength; i++, p += 8) (out as number[]).push(Number(dv.getBigInt64(p, true)));
        break;
      case "b":
      case "c":
        for (let i = 0; i < arrayLength; i++, p += 1) (out as boolean[]).push((dv.getUint8(p) & 1) === 1);
        break;
    }
    return out;
  };

  const readProperty = async (): Promise<unknown> => {
    const type = String.fromCharCode(view.getUint8(o++));
    switch (type) {
      case "Y": { const v = view.getInt16(o, true); o += 2; return v; }
      case "C": return view.getUint8(o++) & 1;
      case "I": { const v = view.getInt32(o, true); o += 4; return v; }
      case "F": { const v = view.getFloat32(o, true); o += 4; return v; }
      case "D": { const v = view.getFloat64(o, true); o += 8; return v; }
      case "L": { const v = Number(view.getBigInt64(o, true)); o += 8; return v; }
      case "S":
      case "R": {
        const length = view.getUint32(o, true);
        o += 4;
        const slice = data.subarray(o, o + length);
        o += length;
        return type === "S" ? decoder.decode(slice) : slice.slice();
      }
      case "f":
      case "d":
      case "l":
      case "i":
      case "b":
      case "c":
        return readArray(type);
      default:
        throw new Error(`Unknown FBX property type '${type}' at offset ${o - 1}.`);
    }
  };

  const parseNode = async (): Promise<FbxNode | null> => {
    const start = o;
    const endOffset = readU();
    const numProperties = readU();
    readU(); // propertyListLen
    const nameLen = view.getUint8(o++);
    const name = decoder.decode(data.subarray(o, o + nameLen));
    o += nameLen;
    if (endOffset === 0) return null;

    const propertyList: unknown[] = [];
    for (let i = 0; i < numProperties; i++) propertyList.push(await readProperty());

    const node: FbxNode = { name, propertyList, singleProperty: numProperties === 1 && o === endOffset };
    const id = propertyList[0];
    if (typeof id === "number") node.id = id;
    if (typeof propertyList[1] === "string" && propertyList[1]) node.attrName = (propertyList[1] as string).split("\u0000")[0]!;
    if (typeof propertyList[2] === "string" && propertyList[2]) node.attrType = propertyList[2] as string;

    while (o < endOffset) {
      const child = await parseNode();
      if (child) attach(name, node, child);
    }
    if (o !== endOffset) o = endOffset; // tolerate padding
    void start;
    return node;
  };

  const tree: FbxTree = {};
  const footerGuard = () => {
    if (data.length % 16 === 0) return ((o + 160 + 16) & ~0xf) >= data.length;
    return o + 160 + 16 >= data.length;
  };
  while (!footerGuard() && o + (wide ? 25 : 13) < data.length) {
    const node = await parseNode();
    if (!node) break;
    tree[node.name] = node;
  }
  return tree;
}

function attach(parentName: string, node: FbxNode, sub: FbxNode): void {
  if (sub.singleProperty) {
    const value = sub.propertyList?.[0];
    if (Array.isArray(value)) {
      node[sub.name] = sub;
      sub.a = value as FbxNode["a"];
    } else {
      node[sub.name] = value as never;
    }
  } else if (parentName === "Connections" && sub.name === "C") {
    const row: unknown[] = [];
    (sub.propertyList ?? []).forEach((p, i) => {
      if (i !== 0) row.push(p);
    });
    (node.connections ??= []).push(row);
  } else if (sub.name === "Properties70") {
    for (const key of Object.keys(sub)) if (key !== "name" && key !== "propertyList" && key !== "singleProperty") node[key] = sub[key];
  } else if (parentName === "Properties70" && sub.name === "P") {
    let innerName = String(sub.propertyList?.[0] ?? "");
    let type1 = String(sub.propertyList?.[1] ?? "");
    const type2 = String(sub.propertyList?.[2] ?? "");
    const flag = String(sub.propertyList?.[3] ?? "");
    if (innerName.startsWith("Lcl ")) innerName = innerName.replace("Lcl ", "Lcl_");
    if (type1.startsWith("Lcl ")) type1 = type1.replace("Lcl ", "Lcl_");
    let value: unknown;
    if (type1 === "Color" || type1 === "ColorRGB" || type1 === "Vector" || type1 === "Vector3D" || type1.startsWith("Lcl_")) {
      value = [sub.propertyList?.[4], sub.propertyList?.[5], sub.propertyList?.[6]].map(Number);
    } else value = sub.propertyList?.[4];
    node[innerName] = { type: type1, type2, flag, value };
  } else if (node[sub.name] === undefined) {
    if (typeof sub.id === "number") {
      node[sub.name] = { [sub.id]: sub };
    } else {
      node[sub.name] = sub;
    }
  } else if (typeof sub.id === "number") {
    const existing = node[sub.name] as Record<string, FbxNode>;
    if (existing[sub.id] === undefined) existing[sub.id] = sub;
    else {
      // Duplicate geometry layer elements, etc.
      let i = 0;
      while (existing[`${sub.id}_${i}`]) i++;
      existing[`${sub.id}_${i}`] = sub;
    }
  } else if (Array.isArray(node[sub.name])) {
    (node[sub.name] as FbxNode[]).push(sub);
  } else {
    node[sub.name] = [node[sub.name], sub];
  }
}
