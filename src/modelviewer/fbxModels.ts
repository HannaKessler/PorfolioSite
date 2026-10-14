// Per-model FBX settings that three.js's FBXLoader ignores but that change
// what the model looks like:
//  - "Culling" child node: "CullingOff" means both sides are drawn.
//  - Properties70 "Visibility" (number, 0 = hidden) and "Show" (bool) hide a
//    model in the authoring tool.
// Read directly from the file (binary or ASCII), keyed by model name.

export interface FbxModelFlags {
  doubleSided: Set<string>;
  hidden: Set<string>;
}

export function readFbxModelFlags(buffer: ArrayBuffer): FbxModelFlags {
  const bytes = new Uint8Array(buffer);
  const magic = "Kaydara FBX Binary  ";
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, magic.length));
  return head === magic ? readBinary(buffer) : readAscii(new TextDecoder().decode(bytes));
}

function cleanName(raw: string): string {
  // Binary: "Name\0\x01Model"; ASCII: "Model::Name".
  return raw.split("\u0000")[0]!.replace(/^Model::/, "");
}

function isHiddenProperty(name: unknown, value: unknown): boolean {
  return (name === "Visibility" || name === "Show") && Number(value) === 0;
}

function readAscii(text: string): FbxModelFlags {
  const flags: FbxModelFlags = { doubleSided: new Set(), hidden: new Set() };
  const re = /Model:\s*[^,]*,\s*"([^"]*)"\s*,\s*"[^"]*"\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < text.length && depth > 0) {
      const c = text[i++];
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
    const block = text.slice(re.lastIndex, i);
    const name = cleanName(match[1]!);
    if (/\bCulling:\s*"CullingOff"/.test(block)) flags.doubleSided.add(name);
    const props = /P:\s*"(Visibility|Show)"\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*([-\d.eE+]+)/g;
    let p: RegExpExecArray | null;
    while ((p = props.exec(block))) if (isHiddenProperty(p[1], p[2])) flags.hidden.add(name);
  }
  return flags;
}

interface BinaryNode {
  end: number;
  name: string;
  props: unknown[];
  childStart: number;
}

function readBinary(buffer: ArrayBuffer): FbxModelFlags {
  const view = new DataView(buffer);
  const version = view.getUint32(23, true);
  const wide = version >= 7500;
  const decoder = new TextDecoder("latin1");
  const flags: FbxModelFlags = { doubleSided: new Set(), hidden: new Set() };

  const readNode = (offset: number): BinaryNode | null => {
    const end = wide ? Number(view.getBigUint64(offset, true)) : view.getUint32(offset, true);
    const numProps = wide ? Number(view.getBigUint64(offset + 8, true)) : view.getUint32(offset + 4, true);
    const headerSize = wide ? 24 : 12;
    if (end === 0) return null;
    const nameLength = view.getUint8(offset + headerSize);
    const name = decoder.decode(new Uint8Array(buffer, offset + headerSize + 1, nameLength));
    let p = offset + headerSize + 1 + nameLength;
    const props: unknown[] = [];
    for (let k = 0; k < numProps; k++) {
      const type = String.fromCharCode(view.getUint8(p++));
      switch (type) {
        case "S":
        case "R": {
          const length = view.getUint32(p, true);
          props.push(type === "S" ? decoder.decode(new Uint8Array(buffer, p + 4, length)) : null);
          p += 4 + length;
          break;
        }
        case "Y": props.push(view.getInt16(p, true)); p += 2; break;
        case "C": props.push(view.getUint8(p)); p += 1; break;
        case "I": props.push(view.getInt32(p, true)); p += 4; break;
        case "F": props.push(view.getFloat32(p, true)); p += 4; break;
        case "D": props.push(view.getFloat64(p, true)); p += 8; break;
        case "L": props.push(Number(view.getBigInt64(p, true))); p += 8; break;
        case "f": case "d": case "l": case "i": case "b": {
          const compressedLength = view.getUint32(p + 8, true);
          p += 12 + compressedLength;
          props.push(null);
          break;
        }
        default:
          throw new Error(`Unknown FBX property type ${type}`);
      }
    }
    return { end, name, props, childStart: p };
  };

  const modelName = (model: BinaryNode) => {
    const raw = model.props.find((value) => typeof value === "string") as string | undefined;
    return raw === undefined ? undefined : cleanName(raw);
  };

  const walk = (start: number, stop: number, parent: BinaryNode | null, model: BinaryNode | null) => {
    let offset = start;
    while (offset < stop) {
      const node = readNode(offset);
      if (!node) break;
      const owner = node.name === "Model" && parent?.name === "Objects" ? node : model;
      if (model && parent === model && node.name === "Culling" && node.props[0] === "CullingOff") {
        const name = modelName(model);
        if (name !== undefined) flags.doubleSided.add(name);
      }
      if (model && parent?.name === "Properties70" && node.name === "P" && isHiddenProperty(node.props[0], node.props[4])) {
        const name = modelName(model);
        if (name !== undefined) flags.hidden.add(name);
      }
      if (node.childStart < node.end) walk(node.childStart, node.end, node, owner);
      offset = node.end;
    }
  };

  walk(27, buffer.byteLength, null, null);
  return flags;
}
