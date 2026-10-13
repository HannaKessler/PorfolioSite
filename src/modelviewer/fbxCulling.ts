// FBX stores per-model face culling as a "Culling" child of each Model node
// ("CullingOff" = draw both sides, "CullingOnCCW"/"CullingOnCW" = one side).
// three.js's FBXLoader ignores it, so read it directly from the file.
// Returns the names of models whose culling is off.

export function fbxDoubleSidedModels(buffer: ArrayBuffer): Set<string> {
  const bytes = new Uint8Array(buffer);
  const magic = "Kaydara FBX Binary  ";
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, magic.length));
  return head === magic ? readBinary(buffer) : readAscii(new TextDecoder().decode(bytes));
}

function cleanName(raw: string): string {
  // Binary: "Name\0\x01Model"; ASCII: "Model::Name".
  return raw.split("\u0000")[0]!.replace(/^Model::/, "");
}

function readAscii(text: string): Set<string> {
  const result = new Set<string>();
  const re = /Model:\s*[^,]*,\s*"([^"]*)"\s*,\s*"[^"]*"\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    // Scan this Model block (balanced braces) for its Culling value.
    let depth = 1;
    let i = re.lastIndex;
    while (i < text.length && depth > 0) {
      const c = text[i++];
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
    const block = text.slice(re.lastIndex, i);
    if (/\bCulling:\s*"CullingOff"/.test(block)) result.add(cleanName(match[1]!));
  }
  return result;
}

function readBinary(buffer: ArrayBuffer): Set<string> {
  const view = new DataView(buffer);
  const version = view.getUint32(23, true);
  const wide = version >= 7500;
  const decoder = new TextDecoder("latin1");
  const result = new Set<string>();

  const readNode = (offset: number): { end: number; name: string; props: unknown[]; childStart: number } | null => {
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
        case "Y": p += 2; props.push(null); break;
        case "C": p += 1; props.push(null); break;
        case "I": case "F": p += 4; props.push(null); break;
        case "D": case "L": p += 8; props.push(null); break;
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

  const walk = (start: number, stop: number, parent: { name: string; props: unknown[] } | null) => {
    let offset = start;
    while (offset < stop) {
      const node = readNode(offset);
      if (!node) break;
      if (parent?.name === "Model" && node.name === "Culling" && node.props[0] === "CullingOff") {
        const modelName = parent.props.find((value) => typeof value === "string") as string | undefined;
        if (modelName !== undefined) result.add(cleanName(modelName));
      }
      if (node.childStart < node.end) walk(node.childStart, node.end, node);
      offset = node.end;
    }
  };

  walk(27, buffer.byteLength, null);
  return result;
}
