/** POST a file to a Convex upload URL; returns its storage ID. Retries a
 * failed upload a few times. */
export async function uploadFile(
  url: string,
  file: Uint8Array,
  contentType = 'application/json',
) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: new Uint8Array(file),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
      return ((await response.json()) as { storageId: string }).storageId;
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
}
