/**
 * Sends a file to a Convex upload URL and returns its storage id. Uses
 * XMLHttpRequest rather than fetch because only it reports upload progress
 * (0 to 1), so a big photo on a slow connection shows it's moving.
 */
export function postFile(url: string, file: File, onProgress?: (fraction: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.min(0.99, event.loaded / event.total));
    };
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error("The upload didn't go through. Try again."));
        return;
      }
      try {
        const { storageId } = JSON.parse(request.responseText) as { storageId?: unknown };
        if (typeof storageId !== "string") throw new Error();
        onProgress?.(1);
        resolve(storageId);
      } catch {
        reject(new Error("The upload didn't go through. Try again."));
      }
    };
    request.onerror = () => reject(new Error("The upload was cut off. Check the connection and try again."));
    request.send(file);
  });
}
