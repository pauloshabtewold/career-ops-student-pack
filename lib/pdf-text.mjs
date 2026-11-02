// Text layer of a PDF buffer, pages joined by newlines. Pure JS (unpdf bundles a serverless build of pdf.js), so it
// runs the same on macOS and Windows with no native build. Returns '' for an image-only PDF; throws on a corrupt one.
import { getDocumentProxy, extractText } from 'unpdf';

export async function extractPdfText(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.join('\n');
}
