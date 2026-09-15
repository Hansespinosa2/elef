export async function readUtf8Markdown(read: () => Promise<ArrayBuffer>): Promise<string> {
  const bytes = await read();
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
