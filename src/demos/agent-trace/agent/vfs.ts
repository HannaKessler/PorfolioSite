/** In-memory file system for the agent's virtual project. Paths are POSIX-style and relative. */
export class Vfs {
  private files: Map<string, string>;

  constructor(initial: Record<string, string> | Map<string, string> = {}) {
    this.files = new Map(initial instanceof Map ? initial : Object.entries(initial));
  }

  static normalize(path: string): string {
    const parts: string[] = [];
    for (const part of path.replace(/\\/g, "/").split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    return parts.join("/");
  }

  has(path: string): boolean {
    return this.files.has(Vfs.normalize(path));
  }

  read(path: string): string | undefined {
    return this.files.get(Vfs.normalize(path));
  }

  write(path: string, contents: string): void {
    this.files.set(Vfs.normalize(path), contents);
  }

  list(): string[] {
    return [...this.files.keys()].sort();
  }

  /** A frozen copy of every file, used to hand the project to the test worker. */
  snapshot(): Record<string, string> {
    return Object.fromEntries([...this.files.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}
