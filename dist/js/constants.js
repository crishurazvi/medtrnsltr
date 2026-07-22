export const DEFAULT_SYSTEM_PROMPT = `Ești un traducător medical de elită specializat în cardiologie intervențională.
Traduce următorul text din engleză în limba română.

REGULI STRICTE:
1. Păstrează formatarea Markdown (titluri #, ##, ###, liste, bold, tabele etc.).
2. Păstrează termenii medicali consacrați în cardiologie (de exemplu PCI, stent, balloon, Monorail, OTW), conform terminologiei medicale utilizate în România.
3. Traducerea trebuie să fie fidelă, profesională și fluentă.
4. Nu omite cifre, procente, unități, referințe, avertismente sau legende.
5. Nu adăuga introduceri, explicații ori comentarii.
6. Returnează numai textul tradus.`;

export const PCR_PRINT_STYLE = `
  @page { size: A4 portrait; margin: 20mm 15mm 20mm 15mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.55; color: #222; }
  .document-header { color: #00805a; font-size: 9pt; font-weight: 700; text-transform: uppercase; margin-bottom: 12px; }
  h1 { color: #d9531e; font-size: 16pt; text-transform: uppercase; border-bottom: 1px solid #d9531e; padding-bottom: 4px; margin: 22px 0 10px; }
  h2 { color: #1a365d; font-size: 13pt; text-transform: uppercase; margin: 18px 0 8px; }
  h3 { color: #2d3748; font-size: 11pt; margin: 14px 0 6px; }
  p { text-align: justify; margin: 0 0 9px; }
  blockquote { background: #f8f9fa; border: 1px solid #cbd5e0; border-left: 4px solid #d9531e; padding: 9px 12px; margin: 12px 0; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9.5pt; }
  th, td { border: 1px solid #cbd5e0; padding: 6px 8px; vertical-align: top; }
  th { background: #edf2f7; color: #1a365d; }
  img { max-width: 100%; }
  code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; }
  .page-reference { color: #718096; font-size: 8pt; margin: 18px 0 6px; page-break-after: avoid; }
  .print-toolbar { position: sticky; top: 0; display: flex; gap: 8px; padding: 10px; background: #102c42; color: white; margin: -8px -8px 18px; }
  .print-toolbar button { border: 0; border-radius: 7px; padding: 8px 12px; font-weight: 700; cursor: pointer; }
  @media print { .print-toolbar { display: none; } }
`;

export const PROJECT_STATUS = {
  pending: "În lucru",
  completed: "Finalizat",
};

export const CHUNK_STATUS = {
  pending: "Netradus",
  draft: "Tradus",
  approved: "Aprobat",
};
