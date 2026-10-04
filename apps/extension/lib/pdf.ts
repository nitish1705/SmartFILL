import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Item {
  str: string;
  transform: number[];
}

/** Extract text from a PDF in the browser, one line per visual row. The file never leaves the device. */
export async function pdfToText(file: File): Promise<string> {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false, // the extension CSP forbids eval
    useSystemFonts: false,
  }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    const rows = new Map<number, Item[]>();
    for (const it of content.items as Item[]) {
      if (!('str' in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]! / 3); // items within ~3pt share a line
      rows.set(y, [...(rows.get(y) ?? []), it]);
    }
    pages.push(
      [...rows.entries()]
        .sort(([a], [b]) => b - a) // PDF y grows upwards
        .map(([, items]) => items.sort((a, b) => a.transform[4]! - b.transform[4]!).map((i) => i.str).join(' '))
        .join('\n'),
    );
  }
  return pages.join('\n');
}
