const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const Preauditoria = require('../models/Preauditoria');
const AuditoriaFinal = require('../models/AuditoriaFinal');
const { protect } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roles');
const { analyzeWithGroq } = require('../services/groqAuditService');
const { analyzeSignatureImages } = require('../services/groqSignatureVisionService');
const { buildPdfBuffer, buildXlsxBuffer } = require('../utils/auditExports');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 20, fieldSize: 4 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    callback(isPdf ? null : new Error('Solo se permite un documento PDF.'), isPdf);
  },
});
const adminRoles = ['SUPER_ADMIN', 'ADMIN'];
const adminOnly = requireRole(...adminRoles);

function handlePdfUpload(req, res, next) {
  upload.single('documento')(req, res, (error) => {
    if (!error) return next();
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ msg: error.message || 'No fue posible recibir el PDF.' });
  });
}

function numericValue(value) {
  const text = String(value ?? '').replace(/[%,$\s]/g, '').replace(/,/g, '');
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function checkPeriodTotals(datosActividad) {
  const findings = [];
  const checks = [];
  const metas = datosActividad.metas || {};
  const consistency = { programadas: null, alcanzadas: null };
  for (const [label, key] of [['programada', 'programadas'], ['alcanzada', 'alcanzadas']]) {
    const values = metas[key] || {};
    const periods = ['eneAbr', 'mayAgo', 'sepDic'].map((period) => numericValue(values[period]));
    const total = numericValue(values.total);
    if (periods.every((value) => value !== null) && total !== null) {
      const sum = periods.reduce((acc, value) => acc + value, 0);
      const consistent = Math.abs(sum - total) <= 0.01;
      consistency[key] = consistent;
      checks.push({ nombre: `Suma de metas ${label}`, estado: consistent ? 'Coincide' : 'Requiere atención', detalle: consistent
        ? `Los tres periodos suman ${sum}, igual que el total registrado.`
        : `Los tres periodos suman ${sum}, pero el total registrado es ${total}.` });
      if (!consistent) findings.push({
        categoria: 'Consistencia de datos', gravedad: 'Media', titulo: `El total de meta ${label} no coincide con los periodos`,
        detalle: `Los tres periodos suman ${sum}, pero el total registrado es ${total}. Conviene revisar cuál de los datos debe corregirse.`,
      });
    } else {
      consistency[key] = null;
      checks.push({ nombre: `Suma de metas ${label}`, estado: 'No se pudo comprobar', detalle: 'Falta capturar alguna cantidad de los periodos o el total.' });
    }
  }

  const programmed = numericValue(metas.programadas?.total);
  const actual = numericValue(metas.alcanzadas?.total);
  const percentage = numericValue(metas.alcanzadas?.porcentaje);
  if (programmed !== null && programmed > 0 && actual !== null && percentage !== null) {
    if (consistency.programadas === false || consistency.alcanzadas === false) {
      checks.push({ nombre: 'Porcentaje de cumplimiento', estado: 'Pendiente de revisar', detalle: 'Primero es necesario corregir o confirmar los totales de las metas. Por ahora no se puede confirmar el porcentaje.' });
    } else {
      const expected = (actual / programmed) * 100;
      const consistent = Math.abs(expected - percentage) <= 1;
      checks.push({ nombre: 'Porcentaje de cumplimiento', estado: consistent ? 'Coincide' : 'Requiere atención', detalle: consistent
        ? `El porcentaje capturado (${percentage}%) coincide con el cálculo (${expected.toFixed(2)}%).`
        : `Con los totales registrados, el cálculo es ${expected.toFixed(2)}%, mientras que el formulario indica ${percentage}%.` });
      if (!consistent) findings.push({
        categoria: 'Consistencia de datos', gravedad: 'Media', titulo: 'El porcentaje no coincide con los totales registrados',
        detalle: `Con los totales registrados, el cálculo es ${expected.toFixed(2)}%, mientras que el formulario indica ${percentage}%.`,
      });
    }
  } else {
    checks.push({ nombre: 'Porcentaje de cumplimiento', estado: 'No se pudo comprobar', detalle: 'Se necesita un total programado mayor que cero, un total alcanzado y un porcentaje capturado.' });
  }
  return { findings, checks, consistency };
}

function formatFileSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} bytes`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function signatureStatusText(result) {
  return ({
    parece_firma: 'Se observa un trazo que parece una firma manuscrita.',
    sin_trazo_claro: 'La imagen no muestra un trazo de firma que pueda distinguirse con claridad.',
    poco_legible: 'La imagen está borrosa o tiene poca claridad.',
    no_parece_firma: 'La imagen no parece mostrar una firma manuscrita.',
    no_determinado: 'No fue posible determinar con claridad qué muestra la imagen.',
    no_adjunta: 'No se recibió una imagen para revisar.',
  })[result] || 'La imagen requiere revisión por una persona autorizada.';
}

function signatureFinding(signature, label) {
  if (!signature || ['parece_firma', 'no_adjunta'].includes(signature.resultado)) return null;
  return {
    categoria: 'Revisión visual',
    gravedad: signature.resultado === 'no_determinado' ? 'Informativa' : 'Media',
    titulo: `Conviene revisar la imagen de firma de ${label.toLowerCase()}`,
    detalle: `${signatureStatusText(signature.resultado)} ${signature.observacion || ''}`.trim(),
    fuente: 'revision_visual',
    evidenciaDocumento: '',
  };
}

function safeJson(value) {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function createPlainReport(analysis, activity, file, validations) {
  const parts = [
    'INFORME DE PREAUDITORÍA',
    `Fecha: ${new Date().toLocaleString('es-MX')}`,
    `Programa presupuestario: ${activity.clavePP || ''} ${activity.nombrePP || ''}`.trim(),
    `Unidad responsable: ${activity.unidad || 'No especificada'}`,
    `Actividad: ${activity.tituloActividad || 'No especificada'}`,
    `Documento: ${file.originalname}`,
    `Tamaño del documento: ${formatFileSize(file.size)}`,
    `Páginas: ${analysis.alcanceRevision?.paginasDocumento ?? 'No disponible'}`,
    `Texto enviado a revisión: ${analysis.alcanceRevision?.caracteresEnviados ?? 0} caracteres`,
    `Relación preliminar: ${analysis.nivelRelacion}`,
    '',
    'RESUMEN',
    analysis.resumen,
    '',
    'POSIBLES INCONSISTENCIAS Y OBSERVACIONES',
  ];
  if (!analysis.hallazgos.length) parts.push('No se identificaron hallazgos específicos con la información analizada. Esto no equivale a una certificación de cumplimiento.');
  analysis.hallazgos.forEach((item, index) => {
    parts.push(`${index + 1}. [${item.gravedad}] ${item.titulo} — ${item.detalle}`);
    if (item.evidenciaDocumento) parts.push(`   Fragmento localizado en el PDF: “${item.evidenciaDocumento}”`);
  });
  parts.push('', 'QUÉ SE REVISÓ DEL DOCUMENTO');
  validations.forEach((item) => parts.push(`- ${item.nombre}: ${item.estado}. ${item.detalle}`));
  if (analysis.alcanceRevision?.nota) parts.push(`Alcance de la revisión: ${analysis.alcanceRevision.nota}`);
  parts.push('', 'RECOMENDACIONES');
  if (!analysis.recomendaciones.length) parts.push('No se generaron recomendaciones específicas.');
  analysis.recomendaciones.forEach((item, index) => parts.push(`${index + 1}. ${item}`));
  if (analysis.limitaciones.length) {
    parts.push('', 'ASPECTOS QUE REQUIEREN REVISIÓN MANUAL');
    analysis.limitaciones.forEach((item) => parts.push(`- ${item}`));
  }
  parts.push('', 'Nota: este resultado es una revisión preliminar de apoyo. No confirma por sí mismo la autenticidad ni la validez legal de los documentos o firmas y no sustituye la revisión de las personas autorizadas.');
  return parts.join('\n');
}

function canAccessRecord(req, record) {
  return adminRoles.includes(req.user.role) || String(record.usuario) === String(req.user.id);
}

function finalOutcome(review) {
  if (review.resultado === 'corregidas_todas') {
    return 'La persona administradora registró que se atendieron todas las observaciones de la preauditoría. Los cambios declarados quedaron asentados en este informe. La aplicación no verificó de manera independiente dichos cambios.';
  }
  if (review.resultado === 'corregidas_parcialmente') {
    return 'La persona administradora registró que se atendieron algunas observaciones. Las observaciones restantes y las acciones declaradas quedaron asentadas para seguimiento.';
  }
  return 'La persona administradora registró que no se realizaron correcciones. La justificación y los aspectos que requieren seguimiento quedaron asentados en este informe.';
}

function buildFinalText(preaudit, review, outcome) {
  const lines = [
    'INFORME DE AUDITORÍA FINAL',
    `Preauditoría de origen: ${preaudit._id}`,
    `Fecha de consolidación: ${new Date().toLocaleString('es-MX')}`,
    `Responsable de la carga: ${preaudit.nombreUsuario} (${preaudit.correoUsuario})`,
    `Persona revisora: ${review.nombreRevisor}`,
    '',
    '1. RESULTADO DE LA PREAUDITORÍA',
    preaudit.informeTexto,
    '',
    '2. REVISIÓN ADMINISTRATIVA',
    `Resultado registrado: ${review.resultado}`,
    `Cambios realizados: ${review.cambiosRealizados}`,
    `Observaciones pendientes: ${review.observacionesPendientes || 'No indicadas'}`,
    '',
    '3. RESULTADO FINAL',
    outcome,
    '',
    'Nota: la revisión administrativa documenta lo declarado por la persona revisora; no constituye una verificación independiente de la autenticidad documental ni sustituye la decisión institucional.',
  ];
  return lines.join('\n');
}

// Crear una preauditoría a partir del PDF que ya genera la pantalla de evidencias.
router.post('/preauditorias', protect, handlePdfUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ msg: 'No se recibió el PDF de evidencias.' });
    if (!req.file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      return res.status(400).json({ msg: 'El archivo recibido no tiene una cabecera PDF válida.' });
    }

    const datosActividad = safeJson(req.body.datosActividad);
    if (!datosActividad || typeof datosActividad !== 'object' || Array.isArray(datosActividad)) {
      return res.status(400).json({ msg: 'Los datos de la actividad no tienen un formato válido.' });
    }
    if (!String(datosActividad.tituloActividad || '').trim()) {
      return res.status(400).json({ msg: 'Captura el título de la actividad antes de generar la preauditoría.' });
    }

    let pdfInfo;
    try {
      pdfInfo = await pdfParse(req.file.buffer);
    } catch (error) {
      return res.status(422).json({ msg: 'El PDF no pudo leerse. Verifica que no esté dañado o protegido con contraseña.' });
    }

    const textoDocumento = String(pdfInfo.text || '').replace(/\u0000/g, ' ').trim();
    if (!textoDocumento.length) {
      return res.status(422).json({ msg: 'El PDF se pudo abrir, pero no se encontró texto que pudiera leerse. No se generó una preauditoría para evitar indicar que el contenido fue revisado. Se requiere una versión con texto seleccionable o un proceso de lectura de documentos escaneados.' });
    }

    const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const duplicatePreaudit = await Preauditoria.exists({ usuario: req.user.id, 'archivo.sha256': sha256 });
    const duplicateFinal = await AuditoriaFinal.exists({ usuario: req.user.id, 'archivo.sha256': sha256 });
    const duplicate = Boolean(duplicatePreaudit || duplicateFinal);
    const requiredFields = [
      ['Clave del programa presupuestario', datosActividad.clavePP],
      ['Nombre del programa presupuestario', datosActividad.nombrePP],
      ['Unidad responsable', datosActividad.unidad],
      ['Justificación', datosActividad.justificacion],
      ['Descripción del beneficio institucional', datosActividad.descripcion],
      ['Evidencias registradas', Array.isArray(datosActividad.evidencias) ? datosActividad.evidencias.join(' ').trim() : ''],
    ];
    const missingFields = requiredFields.filter(([, value]) => !String(value ?? '').trim()).map(([label]) => label);
    const numericChecks = checkPeriodTotals(datosActividad);
    const mimeValid = req.file.mimetype === 'application/pdf';
    const textLimit = Number(process.env.GROQ_MAX_DOCUMENT_CHARS) || 24000;
    const charactersSent = Math.min(textoDocumento.length, textLimit);
    const textWasTruncated = textoDocumento.length > charactersSent;

    const signatureReview = await analyzeSignatureImages({
      titularDataUrl: req.body.firmaTitularDataUrl,
      enlaceDataUrl: req.body.firmaEnlaceDataUrl,
    });

    const signatureDetails = [
      `Titular: ${signatureStatusText(signatureReview.titular.resultado)} ${signatureReview.titular.observacion || ''}`.trim(),
      `Enlace: ${signatureStatusText(signatureReview.enlace.resultado)} ${signatureReview.enlace.observacion || ''}`.trim(),
      signatureReview.nota,
    ].join(' ');
    const validations = [
      { nombre: 'Documento recibido', estado: 'Correcto', detalle: `Se recibió el archivo PDF (${formatFileSize(req.file.size)}).` },
      { nombre: 'Documento abierto', estado: 'Revisado', detalle: `Se pudo abrir y contiene ${pdfInfo.numpages || 0} página(s).` },
      { nombre: 'Contenido del documento', estado: textWasTruncated ? 'Revisión parcial' : 'Enviado a revisión', detalle: textWasTruncated
        ? `Se recuperaron ${textoDocumento.length.toLocaleString('es-MX')} caracteres de texto y se enviaron ${charactersSent.toLocaleString('es-MX')} para su análisis. El resto del texto no se incluyó.`
        : `Se pudo leer el texto del PDF y se envió completo para su revisión automática. Texto recuperado: ${textoDocumento.length.toLocaleString('es-MX')} caracteres.` },
      { nombre: 'Información de la actividad', estado: missingFields.length ? 'Falta información' : 'Completa en los campos revisados', detalle: missingFields.length
        ? `Falta información en: ${missingFields.join(', ')}.`
        : 'Los datos principales de identificación y descripción están capturados.' },
      { nombre: 'Documento repetido', estado: duplicate ? 'Coincidencia encontrada' : 'Sin coincidencias', detalle: duplicate
        ? 'Ya se había revisado un archivo idéntico en esta cuenta.'
        : 'No se encontró otro registro de este mismo archivo en esta cuenta.' },
      ...numericChecks.checks,
      { nombre: 'Imágenes de las firmas', estado: signatureReview.revisadas ? 'Revisión visual realizada' : 'No se recibieron imágenes', detalle: signatureDetails },
    ];

    // No se guarda una preauditoría si Groq no revisó realmente el texto extraído.
    const groqResult = await analyzeWithGroq({ datosActividad, textoDocumento, validacionesTecnicas: validations });
    const analysis = groqResult.analysis;
    const technicalFindings = [...numericChecks.findings];
    if (!mimeValid) technicalFindings.push({
      categoria: 'Documento', gravedad: 'Baja', titulo: 'El tipo de archivo declarado no coincide',
      detalle: 'Aunque el archivo pudo abrirse como PDF, conviene revisar cómo fue generado o adjuntado.', fuente: 'otro', evidenciaDocumento: '',
    });
    if (missingFields.length) technicalFindings.push({
      categoria: 'Información incompleta', gravedad: 'Media', titulo: 'Faltan algunos datos de la actividad',
      detalle: `Revisa los siguientes campos: ${missingFields.join(', ')}.`, fuente: 'datos_actividad', evidenciaDocumento: '',
    });
    if (duplicate) technicalFindings.push({
      categoria: 'Documento repetido', gravedad: 'Media', titulo: 'El mismo archivo ya se había revisado',
      detalle: 'El archivo coincide exactamente con otro documento previamente procesado por esta cuenta.', fuente: 'otro', evidenciaDocumento: '',
    });
    const titularFinding = signatureFinding(signatureReview.titular, 'Titular');
    const enlaceFinding = signatureFinding(signatureReview.enlace, 'Enlace');
    if (titularFinding) technicalFindings.push(titularFinding);
    if (enlaceFinding) technicalFindings.push(enlaceFinding);
    analysis.hallazgos = [...technicalFindings, ...analysis.hallazgos];
    analysis.validaciones = validations;
    analysis.revisionFirmas = signatureReview;
    analysis.alcanceRevision = {
      paginasDocumento: pdfInfo.numpages || 0,
      caracteresExtraidos: textoDocumento.length,
      caracteresEnviados: groqResult.charactersSent,
      textoCompletoIncluido: !textWasTruncated,
      modeloContenido: groqResult.model,
      modeloFirmas: signatureReview.model,
      firmasRevisadasVisualmente: signatureReview.revisadas,
      nota: textWasTruncated
        ? `La revisión fue parcial: se incluyeron ${groqResult.charactersSent.toLocaleString('es-MX')} de ${textoDocumento.length.toLocaleString('es-MX')} caracteres recuperados. El resto del contenido requiere revisión manual.`
        : `Se incluyó todo el texto que el sistema pudo recuperar del PDF (${textoDocumento.length.toLocaleString('es-MX')} caracteres). Las imágenes, sellos y páginas escaneadas que no contengan texto seleccionable requieren revisión visual por una persona.`,
    };
    const informeTexto = createPlainReport(analysis, datosActividad, req.file, validations);
    const record = await Preauditoria.create({
      usuario: req.user.id,
      nombreUsuario: req.user.name,
      correoUsuario: req.user.email,
      datosActividad,
      archivo: {
        nombre: req.file.originalname.slice(0, 180),
        mimeType: req.file.mimetype,
        tamanioBytes: req.file.size,
        sha256,
        paginas: pdfInfo.numpages || 0,
        caracteresExtraidos: textoDocumento.length,
        textoExtraible: Boolean(textoDocumento.length),
      },
      analisis: analysis,
      informeTexto,
      estado: 'pendiente_revision',
      estadoNotificacion: 'nueva',
    });

    return res.status(201).json({
      message: 'Se ha realizado una preauditoría.',
      preauditoria: record,
    });
  } catch (error) {
    console.error('Error al generar la preauditoría:', error);
    return res.status(error.status || 500).json({ msg: error.message || 'No fue posible generar la preauditoría.' });
  }
});

// Pendientes propios: cada usuario solo consulta los registros que generó.
router.get('/preauditorias/mias', protect, async (req, res) => {
  try {
    const records = await Preauditoria.find({ usuario: req.user.id, estado: 'pendiente_revision' })
      .sort({ createdAt: -1 }).limit(100).lean();
    res.json(records);
  } catch (error) {
    console.error('Error al consultar preauditorías propias:', error);
    res.status(500).json({ msg: 'No fue posible consultar tus preauditorías.' });
  }
});

// Bandeja global de pendientes: solo administradores.
router.get('/preauditorias/pendientes', protect, adminOnly, async (req, res) => {
  try {
    const records = await Preauditoria.find({ estado: 'pendiente_revision' })
      .sort({ createdAt: -1 }).limit(100).lean();
    res.json(records);
  } catch (error) {
    console.error('Error al consultar preauditorías pendientes:', error);
    res.status(500).json({ msg: 'No fue posible consultar las preauditorías pendientes.' });
  }
});

// Consultar un registro: su propietario o un administrador.
router.get('/preauditorias/:id', protect, async (req, res) => {
  try {
    const record = await Preauditoria.findById(req.params.id).lean();
    if (!record) return res.status(404).json({ msg: 'La preauditoría ya no está pendiente o no existe.' });
    if (!canAccessRecord(req, record)) return res.status(403).json({ msg: 'No tienes permiso para consultar esta preauditoría.' });
    res.json(record);
  } catch (error) {
    res.status(400).json({ msg: 'Identificador de preauditoría no válido.' });
  }
});

// Marcar "Ver después" conserva la preauditoría en MongoDB y en la bandeja.
router.post('/preauditorias/:id/posponer', protect, async (req, res) => {
  try {
    const record = await Preauditoria.findById(req.params.id);
    if (!record) return res.status(404).json({ msg: 'La preauditoría no existe o ya fue consolidada.' });
    if (!canAccessRecord(req, record)) return res.status(403).json({ msg: 'No tienes permiso para modificar esta preauditoría.' });
    record.estadoNotificacion = 'pospuesta';
    await record.save();
    res.json({ message: 'La preauditoría se conservó en la bandeja de pendientes.' });
  } catch (error) {
    console.error('Error al posponer la preauditoría:', error);
    res.status(500).json({ msg: 'No fue posible actualizar la notificación.' });
  }
});

// Un administrador registra las correcciones y consolida el informe final.
router.post('/preauditorias/:id/revision', protect, adminOnly, async (req, res) => {
  try {
    const preaudit = await Preauditoria.findById(req.params.id);
    if (!preaudit) return res.status(404).json({ msg: 'La preauditoría ya no está pendiente o no existe.' });

    const { resultado, cambiosRealizados, observacionesPendientes = '' } = req.body || {};
    const allowedResults = ['corregidas_todas', 'corregidas_parcialmente', 'sin_correccion'];
    if (!allowedResults.includes(resultado)) {
      return res.status(400).json({ msg: 'Selecciona el resultado de la revisión administrativa.' });
    }
    if (typeof cambiosRealizados !== 'string' || cambiosRealizados.trim().length < 5) {
      return res.status(400).json({ msg: 'Describe los cambios realizados o explica por qué no se corrigieron las observaciones.' });
    }

    const existing = await AuditoriaFinal.findOne({ preauditoriaId: preaudit._id });
    if (existing) {
      await Preauditoria.deleteOne({ _id: preaudit._id });
      return res.json({ message: 'La auditoría final ya estaba consolidada.', auditoriaFinal: existing });
    }

    const review = {
      resultado,
      cambiosRealizados: cambiosRealizados.trim(),
      observacionesPendientes: String(observacionesPendientes).trim(),
      fecha: new Date(),
      nombreRevisor: req.user.name,
    };
    const outcome = finalOutcome(review);
    const finalRecord = await AuditoriaFinal.create({
      preauditoriaId: preaudit._id,
      usuario: preaudit.usuario,
      nombreUsuario: preaudit.nombreUsuario,
      correoUsuario: preaudit.correoUsuario,
      revisadoPor: req.user.id,
      nombreRevisor: req.user.name,
      datosActividad: preaudit.datosActividad,
      archivo: preaudit.archivo.toObject ? preaudit.archivo.toObject() : preaudit.archivo,
      resultadoPreauditoria: preaudit.analisis.toObject ? preaudit.analisis.toObject() : preaudit.analisis,
      informePreauditoria: preaudit.informeTexto,
      revision: review,
      resultadoFinal: outcome,
      informeTexto: buildFinalText(preaudit, review, outcome),
    });

    // La preauditoría temporal sale de pendientes. Su contenido íntegro queda consolidado en la auditoría final.
    await Preauditoria.deleteOne({ _id: preaudit._id });
    res.status(201).json({ message: 'La auditoría final se guardó correctamente.', auditoriaFinal: finalRecord });
  } catch (error) {
    console.error('Error al consolidar la auditoría final:', error);
    if (error.code === 11000) {
      return res.status(409).json({ msg: 'Esta preauditoría ya fue consolidada en una auditoría final.' });
    }
    res.status(500).json({ msg: 'No fue posible guardar la auditoría final.' });
  }
});

async function getFinalForUser(req, res, next) {
  try {
    const record = await AuditoriaFinal.findById(req.params.id).lean();
    if (!record) return res.status(404).json({ msg: 'Auditoría final no encontrada.' });
    if (!adminRoles.includes(req.user.role) && String(record.usuario) !== String(req.user.id)) {
      return res.status(403).json({ msg: 'No tienes permiso para exportar esta auditoría.' });
    }
    req.auditoriaFinal = record;
    next();
  } catch (error) {
    res.status(400).json({ msg: 'Identificador de auditoría no válido.' });
  }
}

router.get('/finales/:id', protect, getFinalForUser, (req, res) => res.json(req.auditoriaFinal));

router.get('/finales/:id/pdf', protect, getFinalForUser, async (req, res) => {
  try {
    const buffer = await buildPdfBuffer(req.auditoriaFinal);
    const fileName = `Auditoria_Final_${req.auditoriaFinal._id}.pdf`;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Content-Length': buffer.length });
    res.send(buffer);
  } catch (error) {
    console.error('Error al exportar PDF:', error);
    res.status(500).json({ msg: 'No fue posible generar el PDF.' });
  }
});

router.get('/finales/:id/excel', protect, getFinalForUser, (req, res) => {
  try {
    const buffer = buildXlsxBuffer(req.auditoriaFinal);
    const fileName = `Auditoria_Final_${req.auditoriaFinal._id}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  } catch (error) {
    console.error('Error al exportar Excel:', error);
    res.status(500).json({ msg: 'No fue posible generar el archivo Excel.' });
  }
});

module.exports = router;
