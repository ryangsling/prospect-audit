export function attachmentName(response: Response, fallback: string) {
  return response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? fallback;
}

export function saveDownload(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export async function downloadResponse(response: Response, fallbackName: string) {
  saveDownload(await response.blob(), attachmentName(response, fallbackName));
}
