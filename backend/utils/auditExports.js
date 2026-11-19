const path = require('path');
const fs = require('fs');

function xmlEscape(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = makeCrcTable();
function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | (Math.floor(now.getSeconds() / 2) & 31);
  const dosDate = (((Math.max(1980, now.getFullYear()) - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

  for (const [name, content] of files) {
    const filename = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, filename, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += local.length + filename.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function columnName(index) {
  let value = index + 1;
  let result = '';
  while (value) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function worksheetXml(rows) {
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const reference = `${columnName(colIndex)}${rowIndex + 1}`;
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
}

function buildXlsxBuffer(finalAudit) {
  const activity = finalAudit.datosActividad || {};
  const analysis = finalAudit.resultadoPreauditoria || {};
  const review = finalAudit.revision || {};
  const findings = Array.isArray(analysis.hallazgos) ? analysis.hallazgos : [];
  const activityRows = [
    ['INFORME DE AUDITORÍA FINAL', ''],
    ['Fecha de generación', new Date(finalAudit.createdAt || Date.now()).toLocaleString('es-MX')],
    ['Persona responsable de la carga', finalAudit.nombreUsuario || ''],
    ['Correo de la persona responsable', finalAudit.correoUsuario || ''],
    ['Persona revisora', finalAudit.nombreRevisor || ''],
    ['Programa presupuestario', `${activity.clavePP || ''} ${activity.nombrePP || ''}`.trim()],
    ['Unidad responsable', activity.unidad || ''],
    ['Título de la actividad', activity.tituloActividad || ''],
    ['Nivel preliminar de relación', analysis.nivelRelacion || 'No determinada'],
    ['Resumen de la preauditoría', analysis.resumen || ''],
    ['Páginas del documento', String(analysis.alcanceRevision?.paginasDocumento ?? '')],
    ['Texto recuperado del PDF (caracteres)', String(analysis.alcanceRevision?.caracteresExtraidos ?? '')],
    ['Texto enviado a revisión (caracteres)', String(analysis.alcanceRevision?.caracteresEnviados ?? '')],
    ['Alcance de la revisión', analysis.alcanceRevision?.nota || 'Sin información'],
    ['Resultado de la revisión administrativa', review.resultado || ''],
    ['Cambios registrados', review.cambiosRealizados || ''],
    ['Observaciones pendientes', review.observacionesPendientes || ''],
    ['Resultado final', finalAudit.resultadoFinal || ''],
    ['Aviso', 'La revisión administrativa registra lo declarado por la persona revisora; no constituye una verificación independiente de la autenticidad documental.'],
  ];
  const findingRows = [['Categoría', 'Gravedad', 'Hallazgo', 'Detalle', 'Fragmento localizado en el PDF']];
  findings.forEach((item) => findingRows.push([item.categoria, item.gravedad, item.titulo, item.detalle, item.evidenciaDocumento || '']));
  if (findingRows.length === 1) findingRows.push(['Sin hallazgos estructurados', '', '', '']);
  const checkRows = [['Qué se revisó', 'Resultado', 'Detalle']];
  (analysis.validaciones || []).forEach((item) => checkRows.push([item.nombre, item.estado, item.detalle]));
  const recommendationRows = [['Recomendaciones'], ...((analysis.recomendaciones || []).map((item) => [item]))];
  const sheets = [
    { name: 'Auditoria final', rows: activityRows },
    { name: 'Hallazgos', rows: findingRows },
    { name: 'Comprobaciones', rows: checkRows.length > 1 ? checkRows : [['Qué se revisó', 'Resultado', 'Detalle'], ['Sin datos', '', '']] },
    { name: 'Recomendaciones', rows: recommendationRows },
  ];

  const sheetOverrides = sheets.map((sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const workbookSheets = sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
  const relationships = sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetOverrides}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`],
    ...sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet.rows)]),
  ];
  return zipStore(files);
}

function buildPdfBuffer(finalAudit) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    const margin = 46;
    const pageWidth = 595.28;
    const pageContentWidth = pageWidth - margin * 2;
    const letterheadPath = path.join(__dirname, '../../frontend/public/Membrete_UTP.jpg');
    if (!fs.existsSync(letterheadPath)) {
      reject(new Error('No se encontró el membrete institucional para generar el informe PDF.'));
      return;
    }
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 112, right: margin, bottom: 48, left: margin },
      info: { Title: 'Informe de auditoría final SIDII UTP', Author: 'SIDII UTP' },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const activity = finalAudit.datosActividad || {};
    const analysis = finalAudit.resultadoPreauditoria || {};
    const review = finalAudit.revision || {};
    const scope = analysis.alcanceRevision || {};
    const signatures = analysis.revisionFirmas || {};

    function drawLetterhead() {
      doc.image(letterheadPath, margin, 27, { width: 252, height: 39, fit: [252, 39] });
      const rightX = 310;
      const rightWidth = pageContentWidth - (rightX - margin);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#353535')
        .text('Clave y nombre del PP', rightX, 28, { width: rightWidth, align: 'right' });
      doc.font('Helvetica').fontSize(7.5).fillColor('#353535')
        .text(`${activity.clavePP || ''} ${activity.nombrePP || ''}`.trim() || 'No especificado', rightX, 38, { width: rightWidth, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#353535')
        .text('Unidad responsable', rightX, 52, { width: rightWidth, align: 'right' });
      doc.font('Helvetica').fontSize(7.5).fillColor('#353535')
        .text(activity.unidad || 'No especificada', rightX, 62, { width: rightWidth, align: 'right' });
      doc.moveTo(margin, 88).lineTo(pageWidth - margin, 88).lineWidth(0.8).strokeColor('#B8AEB1').stroke();
      doc.x = margin;
      doc.y = 105;
    }

    function section(title) {
      doc.moveDown(0.55);
      const y = doc.y;
      doc.save().rect(margin, y - 3, pageContentWidth, 19).fill('#F1EAED').restore();
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#701B3B')
        .text(title, margin + 7, y, { width: pageContentWidth - 14 });
      doc.moveDown(0.55);
    }

    function line(label, value) {
      doc.font('Helvetica-Bold').fontSize(8.8).fillColor('#262626').text(`${label} `, { continued: true });
      doc.font('Helvetica').fontSize(8.8).fillColor('#262626').text(String(value || 'No especificado'), { paragraphGap: 3 });
    }

    function bodyText(value, options = {}) {
      doc.font('Helvetica').fontSize(options.size || 9).fillColor('#262626')
        .text(String(value || 'No se proporcionó información.'), {
          width: pageContentWidth,
          align: options.align || 'left',
          indent: options.indent || 0,
          paragraphGap: options.paragraphGap ?? 4,
          lineGap: 1.5,
        });
    }

    function displaySignature(signature) {
      if (!signature) return 'No se recibió una imagen para revisar.';
      const status = ({
        parece_firma: 'Se observa un trazo que parece una firma manuscrita.',
        sin_trazo_claro: 'No se distingue claramente un trazo de firma.',
        poco_legible: 'La imagen está borrosa o tiene poca claridad.',
        no_parece_firma: 'La imagen no parece mostrar una firma manuscrita.',
        no_determinado: 'No fue posible determinar qué muestra la imagen.',
        no_adjunta: 'No se recibió una imagen para revisar.',
      })[signature.resultado] || 'Requiere revisión visual.';
      return `${status} ${signature.observacion || ''}`.trim();
    }

    doc.on('pageAdded', drawLetterhead);
    drawLetterhead();

    doc.font('Helvetica-Bold').fontSize(15).fillColor('#262626')
      .text('INFORME DE AUDITORÍA FINAL', { align: 'center' });
    doc.moveDown(0.25).font('Helvetica').fontSize(8).fillColor('#555555')
      .text(`Fecha de generación: ${new Date(finalAudit.createdAt || Date.now()).toLocaleString('es-MX')}`, { align: 'center' });

    section('1. Datos de la actividad');
    line('Título de la actividad:', activity.tituloActividad);
    line('Documento revisado:', finalAudit.archivo?.nombre || 'No especificado');
    line('Responsable de la carga:', `${finalAudit.nombreUsuario || ''} (${finalAudit.correoUsuario || ''})`);
    line('Persona que realizó la revisión:', finalAudit.nombreRevisor);

    section('2. Resultado del análisis');
    line('Relación preliminar con la actividad:', analysis.nivelRelacion);
    bodyText(analysis.resumen || 'No se generó un resumen.');

    if (analysis.hallazgos?.length) {
      section('3. Posibles inconsistencias y observaciones');
      analysis.hallazgos.forEach((item, index) => {
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#262626')
          .text(`${index + 1}. ${item.titulo || 'Observación'} (${item.gravedad || 'Informativa'})`, { paragraphGap: 2 });
        bodyText(item.detalle || '', { indent: 12, size: 8.5 });
        if (item.evidenciaDocumento) {
          doc.font('Helvetica-Oblique').fontSize(8).fillColor('#555555')
            .text(`Fragmento localizado en el PDF: “${item.evidenciaDocumento}”`, { indent: 15, paragraphGap: 5 });
        }
      });
    }

    section('4. Qué se revisó del documento');
    if (scope.paginasDocumento) line('Páginas del documento:', scope.paginasDocumento);
    if (Number.isFinite(scope.caracteresExtraidos)) line('Texto recuperado del PDF:', `${scope.caracteresExtraidos.toLocaleString('es-MX')} caracteres`);
    if (Number.isFinite(scope.caracteresEnviados)) line('Texto enviado para revisión:', `${scope.caracteresEnviados.toLocaleString('es-MX')} caracteres`);
    if (scope.nota) bodyText(scope.nota, { size: 8.5 });
    (analysis.validaciones || []).forEach((item) => {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#262626').text(`${item.nombre || 'Comprobación'}: ${item.estado || 'Sin resultado'}`, { continued: true });
      doc.font('Helvetica').text(`. ${item.detalle || ''}`, { paragraphGap: 4 });
    });
    if (signatures.titular || signatures.enlace) {
      doc.moveDown(0.35);
      line('Imagen de firma del titular:', displaySignature(signatures.titular));
      line('Imagen de firma del enlace:', displaySignature(signatures.enlace));
      bodyText(signatures.nota || 'La revisión visual no confirma quién firmó ni la autenticidad o validez de las firmas.', { size: 8 });
    }

    if (analysis.recomendaciones?.length) {
      section('5. Recomendaciones');
      analysis.recomendaciones.forEach((item, index) => bodyText(`${index + 1}. ${item}`, { size: 8.8 }));
    }

    section('6. Revisión administrativa');
    line('Resultado registrado:', review.resultado === 'corregidas_todas' ? 'Se registró que se atendieron todas las observaciones' : review.resultado === 'corregidas_parcialmente' ? 'Se registró que se atendieron algunas observaciones' : 'Se registró que no se realizaron correcciones');
    line('Cambios realizados:', review.cambiosRealizados);
    line('Aspectos que permanecen pendientes:', review.observacionesPendientes || 'No se indicaron');
    line('Fecha de revisión:', new Date(review.fecha || finalAudit.createdAt || Date.now()).toLocaleString('es-MX'));

    section('7. Resultado final');
    bodyText(finalAudit.resultadoFinal || 'No se proporcionó un resultado final.');
    doc.moveDown(0.8);
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#555555')
      .text('Este informe es una herramienta de apoyo. La revisión visual no comprueba la identidad de las personas que aparecen como firmantes ni la autenticidad legal de las firmas. Las correcciones se documentan conforme a lo declarado por la persona revisora; la validación y decisión institucional corresponden al personal autorizado.', {
        width: pageContentWidth, align: 'justify', paragraphGap: 3,
      });
    doc.end();
  });
}

module.exports = { buildPdfBuffer, buildXlsxBuffer };
