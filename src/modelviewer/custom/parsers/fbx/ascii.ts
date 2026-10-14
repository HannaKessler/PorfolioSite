// ASCII FBX: indent-based nodes, Properties70, Connections, and `*N { a: … }` arrays.
import type { FbxNode, FbxTree } from "./tree";

function parseNumberArray(value: string): number[] {
  return value.split(",").map((s) => parseFloat(s.trim())).filter((n) => !Number.isNaN(n));
}

export function parseAsciiFbx(text: string): FbxTree {
  // Normalise `Name: *N {` / `a: …` blocks so large arrays stay on the `a` property.
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const tree: FbxTree = {};
  const stack: FbxNode[] = [];
  let indent = 0;
  const lines = text.split("\n");

  const current = () => stack[stack.length - 1];
  const parent = () => stack[stack.length - 2];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*;/.test(line) || /^\s*$/.test(line)) continue;

    const begin = line.match(new RegExp(`^\\t{${indent}}(\\w+):(.*)\\{`));
    const prop = line.match(new RegExp(`^\\t{${indent}}(\\w+):[\\s\\t]*(.*)$`));
    const end = indent > 0 ? line.match(new RegExp(`^\\t{${indent - 1}}\\}`)) : null;

    if (begin) {
      const nodeName = begin[1]!.trim();
      const attrs = begin[2]!.split(",").map((a) => a.trim().replace(/^"/, "").replace(/"$/, ""));
      let id: number | string = attrs[0] ?? "";
      if (attrs[0] !== "") {
        const n = parseInt(attrs[0]!, 10);
        id = Number.isNaN(n) ? attrs[0]! : n;
      }
      const attrName = attrs.length > 1 ? attrs[1]!.replace(/^(\w+)::/, "") : "";
      const attrType = attrs.length > 2 ? attrs[2]! : "";
      const node: FbxNode = { name: nodeName };
      if (typeof id === "number") node.id = id;
      if (attrName) node.attrName = attrName;
      if (attrType) node.attrType = attrType;

      if (indent === 0) {
        tree[nodeName] = node;
      } else {
        const cur = current()!;
        if (nodeName in cur) {
          if (nodeName === "PoseNode") {
            (cur.PoseNode as FbxNode[]).push(node);
          } else {
            const existing = cur[nodeName];
            if (existing && typeof existing === "object" && !Array.isArray(existing) && (existing as FbxNode).id !== undefined) {
              const prev = existing as FbxNode;
              cur[nodeName] = { [String(prev.id)]: prev };
            }
            if (typeof id === "number") (cur[nodeName] as Record<string, FbxNode>)[id] = node;
          }
        } else if (typeof id === "number") {
          cur[nodeName] = { [id]: node };
        } else if (nodeName !== "Properties70") {
          cur[nodeName] = nodeName === "PoseNode" ? [node] : node;
        }
      }
      stack.push(node);
      indent++;
      continue;
    }

    if (end) {
      stack.pop();
      indent--;
      continue;
    }

    if (prop) {
      let propName = prop[1]!.replace(/^"/, "").replace(/"$/, "").trim();
      let propValue = prop[2]!.replace(/^"/, "").replace(/"$/, "").trim();
      const cur = current();
      if (!cur) continue;

      if (propName === "Content" && propValue === ",") {
        propValue = (lines[++i] ?? "").replace(/"/g, "").replace(/,$/, "").trim();
      }

      if (cur.name === "Properties70" || propName === "P") {
        // P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
        const raw = prop[2]!;
        const parts = raw.split('",').map((p) => p.trim().replace(/^"/, "").replace(/\s/g, "_"));
        // First four fields are quoted strings; the rest is the value.
        // Re-parse more carefully:
        const quoted: string[] = [];
        let rest = raw.trim();
        for (let q = 0; q < 4; q++) {
          if (rest.startsWith('"')) {
            const endQ = rest.indexOf('"', 1);
            quoted.push(rest.slice(1, endQ));
            rest = rest.slice(endQ + 1).replace(/^,\s*/, "");
          } else {
            const comma = rest.indexOf(",");
            quoted.push((comma < 0 ? rest : rest.slice(0, comma)).trim());
            rest = comma < 0 ? "" : rest.slice(comma + 1).trim();
          }
        }
        let innerName = quoted[0]!.replace(/\s/g, "_");
        let type1 = quoted[1]!.replace(/\s/g, "_");
        const type2 = quoted[2]!;
        const flag = quoted[3]!;
        if (innerName.startsWith("Lcl_")) {/* already */}
        else if (quoted[0]!.startsWith("Lcl ")) innerName = quoted[0]!.replace("Lcl ", "Lcl_").replace(/\s/g, "_");
        if (type1.startsWith("Lcl_")) {/* ok */}
        else if (quoted[1]!.startsWith("Lcl ")) type1 = quoted[1]!.replace("Lcl ", "Lcl_").replace(/\s/g, "_");
        let value: unknown = rest.replace(/^,/, "").trim();
        switch (type1) {
          case "int":
          case "enum":
          case "bool":
          case "ULongLong":
          case "double":
          case "Number":
          case "FieldOfView":
            value = parseFloat(String(value));
            break;
          case "Color":
          case "ColorRGB":
          case "Vector":
          case "Vector3D":
          case "Lcl_Translation":
          case "Lcl_Rotation":
          case "Lcl_Scaling":
            value = parseNumberArray(String(value));
            break;
        }
        (parent() ?? cur)[innerName] = { type: type1, type2, flag, value };
        void parts;
        continue;
      }

      if (propName === "C") {
        const bits = propValue.split(",").map((s) => s.trim().replace(/^"/, "").replace(/"$/, ""));
        // bits[0] = OO/OP; bits[1]=from; bits[2]=to; rest = relationship
        const from = parseInt(bits[1]!, 10);
        const to = parseInt(bits[2]!, 10);
        const row: unknown[] = [from, to, ...bits.slice(3)];
        (cur.connections ??= []).push(row);
        continue;
      }

      if (propName === "Node") cur.id = Number(propValue);

      if (propName in cur && Array.isArray(cur[propName])) {
        (cur[propName] as unknown[]).push(propValue);
      } else if (propName !== "a") {
        cur[propName] = propValue;
      } else {
        cur.a = propValue as never;
      }

      // Multi-line arrays end without a trailing comma.
      if (propName === "a") {
        let collected = propValue;
        while (collected.endsWith(",")) {
          const next = lines[++i];
          if (next === undefined) break;
          collected += next.trim();
        }
        cur.a = parseNumberArray(collected);
      }
      continue;
    }

    // Continuation of a large array (no indent match) — already handled above via trailing comma.
    if (current()?.a !== undefined && typeof current()!.a === "string") {
      const cur = current()!;
      let collected = String(cur.a) + line;
      while (collected.endsWith(",")) {
        const next = lines[++i];
        if (next === undefined) break;
        collected += next.trim();
      }
      cur.a = parseNumberArray(collected);
    }
  }

  return tree;
}
