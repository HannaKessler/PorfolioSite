/** Inflate a zlib (RFC 1950) buffer to raw bytes. */
export async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "undefined") {
    try {
      const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // Some runtimes only expose raw deflate.
      const stream = new Blob([data.subarray(2, data.length - 4) as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
  }
  const { inflateSync } = await import("node:zlib");
  return new Uint8Array(inflateSync(data));
}
