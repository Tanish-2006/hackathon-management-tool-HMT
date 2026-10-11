import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const here = fileURLToPath(new URL('.', import.meta.url));
const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

const shape = (placeholder, paragraphs) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paragraphs
    .map((text) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p>`)
    .join('')}</p:txBody></p:sp>`;
const slide = (shapes) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${ns}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld></p:sld>`;
const picture = '<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill/><p:spPr/></p:pic>';

const zip = new JSZip();
zip.file('ppt/slides/slide3.xml', slide(picture));
zip.file('ppt/slides/slide1.xml', slide(shape('<p:ph type="ctrTitle"/>', ['Campus Food Rescue']) + shape('<p:ph type="subTitle" idx="1"/>', ['Problem: 30% of hostel meals are thrown away', 'Students &amp; mess staff confirm it'])));
zip.file('ppt/slides/slide2.xml', slide(shape('<p:ph type="title"/>', ['Who has this problem']) + shape('<p:ph idx="1"/>', ['Hostel mess managers', 'NGOs collecting surplus food'])));
zip.file('ppt/slides/_rels/slide2.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>');
zip.file('ppt/notesSlides/notesSlide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes ${ns}><p:cSld><p:spTree>${shape('<p:ph type="sldImg"/>', [])}${shape('<p:ph type="body" idx="1"/>', ['Interviewed 12 managers last week'])}${shape('<p:ph type="sldNum" sz="quarter" idx="5"/>', ['2'])}</p:spTree></p:cSld></p:notes>`);
zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/></p:sldIdLst></p:presentation>`);
zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>');
zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>');
writeFileSync(`${here}sample-deck.pptx`, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

const pages = [
  ['Campus Food Rescue', 'Problem: hostel meals are wasted every night'],
  ['Pilot plan', 'Two hostels, four weeks, measure kg saved'],
];
const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
for (const [title, body] of pages) {
  const stream = `BT /F1 28 Tf 72 700 Td (${title}) Tj ET\nBT /F1 14 Tf 72 660 Td (${body}) Tj ET`;
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`);
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
}
let pdf = '%PDF-1.4\n';
const offsets = objects.map((body, i) => {
  const offset = pdf.length;
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  return offset;
});
const xref = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(`${here}sample-deck.pdf`, pdf, 'latin1');
console.log('wrote sample-deck.pptx and sample-deck.pdf');
