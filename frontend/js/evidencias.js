(() => {
	const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	})[character]);

	const readAsDataURL = (file) => new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});

	function render(container) {
		container.innerHTML = `<header class="section-heading"><p class="eyebrow">Documentación</p><h1>Captura de evidencias</h1></header>
			<form id="evidenceForm" class="evidence-form">
				<h2>Encabezado</h2>
				<div class="evidence-grid evidence-header-fields">
					<label>Clave del PP<input name="clavePP" value="E030"></label>
					<label>Nombre del PP<input name="nombrePP" value="EDUCACIÓN SUPERIOR EN UNIVERSIDADES TECNOLÓGICAS"></label>
					<label>Unidad responsable<input name="unidad" value="DA2F"></label>
					<label>Universidad<input name="universidad" value="UNIVERSIDAD TECNOLÓGICA DE PUEBLA"></label>
					<label class="span-all">Título de la actividad<input name="tituloActividad"></label>
				</div>
				<h2>Metas programadas y alcanzadas</h2>
				<div class="table-scroll"><table class="data-table evidence-meta-table"><thead><tr><th>Cuatrimestre</th><th>Enero - Abril</th><th>Mayo - Agosto</th><th>Septiembre - Diciembre</th><th>Total</th><th>%</th></tr></thead><tbody>
					<tr><th>Meta programada</th>${['eneAbr','mayAgo','sepDic','total','porcentaje'].map((key) => `<td><input aria-label="Meta programada ${key}" name="prog-${key}"></td>`).join('')}</tr>
					<tr><th>Meta alcanzada</th>${['eneAbr','mayAgo','sepDic','total','porcentaje'].map((key) => `<td><input aria-label="Meta alcanzada ${key}" name="alc-${key}"></td>`).join('')}</tr>
				</tbody></table></div>
				<div class="evidence-grid">
					<label class="span-all">Justificación<textarea name="justificacion" rows="3"></textarea></label>
					<label class="span-all">Descripción del beneficio institucional<textarea name="descripcion" rows="4"></textarea></label>
					<label class="span-all">Evidencias, una por línea<textarea name="evidencias" rows="4"></textarea></label>
				</div>
				<h2>Titular y enlace</h2>
				<div class="evidence-grid">
					<fieldset><legend>Titular</legend><label>Nombre<input name="titularNombre"></label><label>Puesto<input name="titularPuesto"></label><label>Firma (imagen)<input name="titularFirma" type="file" accept="image/png,image/jpeg"></label></fieldset>
					<fieldset><legend>Enlace</legend><label>Nombre<input name="enlaceNombre"></label><label>Puesto<input name="enlacePuesto"></label><label>Firma (imagen)<input name="enlaceFirma" type="file" accept="image/png,image/jpeg"></label></fieldset>
				</div>
				<label class="file-picker">Documentos PDF adjuntos<input id="evidencePdfs" type="file" accept="application/pdf" multiple></label>
				<p id="pdfFilesLabel" class="field-caption">Sin documentos seleccionados</p>
				<p id="evidenceMessage" class="inline-message" role="status" hidden></p>
				<button class="button button-primary" type="button" id="buildEvidencePdf">Generar y unir PDF</button>
			</form>
			<section class="evidence-document" id="evidenceDocument" aria-label="Vista previa del documento"></section>
			<section class="pdf-preview" id="evidencePreview" hidden><h2>Previsualización del PDF</h2><iframe title="Previsualización del PDF" loading="lazy"></iframe><a class="button button-secondary" id="downloadEvidencePdf" download="Evidencia_Unificada.pdf">Descargar PDF</a></section>`;

		const form = container.querySelector('#evidenceForm');
		const documentView = container.querySelector('#evidenceDocument');
		const message = container.querySelector('#evidenceMessage');
		const filesInput = container.querySelector('#evidencePdfs');
		const filesLabel = container.querySelector('#pdfFilesLabel');
		const imageData = { titular: '', enlace: '' };
		let pdfUrl = '';

		function formValue(name) { return form.elements[name]?.value || ''; }

		function refreshDocument() {
			const lines = formValue('evidencias').split('\n').map((line) => line.trim()).filter(Boolean);
			const descriptions = formValue('descripcion').split('\n').map((line) => line.trim()).filter(Boolean);
			documentView.innerHTML = `<div class="document-letterhead"><img src="public/Membrete_UTP.jpg" alt="Membrete UTP"><p>Clave y Nombre del PP: ${escapeHTML(formValue('clavePP'))} ${escapeHTML(formValue('nombrePP'))}<br>Unidad Responsable: ${escapeHTML(formValue('unidad'))} ${escapeHTML(formValue('universidad'))}</p></div>
				<h2>Título de la actividad: ${escapeHTML(formValue('tituloActividad'))}</h2>
				<table><tbody><tr><th>Justificación</th></tr><tr><td>${escapeHTML(formValue('justificacion'))}</td></tr><tr><th>Descripción del beneficio institucional</th></tr><tr><td><ul>${descriptions.map((line) => `<li>${escapeHTML(line)}</li>`).join('')}</ul></td></tr><tr><th>Evidencias</th></tr><tr><td><ol>${lines.map((line) => `<li>${escapeHTML(line)}</li>`).join('')}</ol></td></tr></tbody></table>
				<div class="signature-preview"><div><p>Titular: ${escapeHTML(formValue('titularNombre'))}</p><p>Puesto: ${escapeHTML(formValue('titularPuesto'))}</p>${imageData.titular ? `<img src="${imageData.titular}" alt="Firma del titular">` : ''}</div><div><p>Enlace: ${escapeHTML(formValue('enlaceNombre'))}</p><p>Puesto: ${escapeHTML(formValue('enlacePuesto'))}</p>${imageData.enlace ? `<img src="${imageData.enlace}" alt="Firma del enlace">` : ''}</div></div>`;
		}

		form.addEventListener('input', refreshDocument);
		form.addEventListener('change', async (event) => {
			const target = event.target;
			if (target.name === 'titularFirma' || target.name === 'enlaceFirma') {
				const file = target.files?.[0];
				const key = target.name === 'titularFirma' ? 'titular' : 'enlace';
				imageData[key] = file ? await readAsDataURL(file) : '';
				refreshDocument();
			}
		});

		filesInput.addEventListener('change', () => {
			const files = Array.from(filesInput.files || []);
			const invalid = files.find((file) => file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'));
			if (invalid) {
				filesInput.value = '';
				window.SIDII.showMessage(message, 'Solo se permiten archivos PDF.');
				filesLabel.textContent = 'Sin documentos seleccionados';
				return;
			}
			filesLabel.textContent = files.length ? `${files.length} archivo(s) seleccionado(s)` : 'Sin documentos seleccionados';
			window.SIDII.showMessage(message, '');
		});

		container.querySelector('#buildEvidencePdf').addEventListener('click', async (event) => {
			const button = event.currentTarget;
			if (!window.PDFLib) {
				window.SIDII.showMessage(message, 'No se pudo cargar pdf-lib. Verifica la conexión y vuelve a intentarlo.');
				return;
			}
			button.disabled = true;
			window.SIDII.showMessage(message, 'Generando documento...');
			try {
				const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
				const pdf = await PDFDocument.create();
				const font = await pdf.embedFont(StandardFonts.Helvetica);
				const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
				let page = pdf.addPage([595.28, 841.89]);
				let y = 800;
				const margin = 48;
				const lineHeight = 15;

				function addPageIfNeeded(height = lineHeight) {
					if (y - height < 45) { page = pdf.addPage([595.28, 841.89]); y = 800; }
				}
				function drawLine(text, options = {}) {
					const fontSize = options.size || 10;
					const maxWidth = 595.28 - margin * 2;
					const words = String(text || '-').replace(/[\r\t]/g, ' ').split(/\s+/);
					let line = '';
					for (const word of words) {
						const candidate = line ? `${line} ${word}` : word;
						if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && line) {
							addPageIfNeeded();
							page.drawText(line, { x: margin, y, size: fontSize, font: options.bold ? bold : font, color: rgb(0.12, 0.1, 0.1) });
							y -= lineHeight;
							line = word;
						} else line = candidate;
					}
					addPageIfNeeded();
					page.drawText(line || '-', { x: margin, y, size: fontSize, font: options.bold ? bold : font, color: rgb(0.12, 0.1, 0.1) });
					y -= options.gap || lineHeight;
				}

				drawLine('UNIVERSIDAD TECNOLÓGICA DE PUEBLA', { size: 15, bold: true, gap: 22 });
				drawLine('CAPTURA DE EVIDENCIAS', { size: 13, bold: true, gap: 24 });
				drawLine(`Clave y nombre del PP: ${formValue('clavePP')} ${formValue('nombrePP')}`);
				drawLine(`Unidad responsable: ${formValue('unidad')} ${formValue('universidad')}`);
				drawLine(`Título de la actividad: ${formValue('tituloActividad')}`, { bold: true, gap: 22 });
				drawLine('METAS PROGRAMADAS Y ALCANZADAS', { bold: true });
				for (const [title, prefix] of [['Meta programada', 'prog'], ['Meta alcanzada', 'alc']]) {
					drawLine(`${title}: Ene-Abr ${formValue(`${prefix}-eneAbr`) || 0} | May-Ago ${formValue(`${prefix}-mayAgo`) || 0} | Sep-Dic ${formValue(`${prefix}-sepDic`) || 0} | Total ${formValue(`${prefix}-total`) || 0} | ${formValue(`${prefix}-porcentaje`) || 0}%`);
				}
				drawLine('JUSTIFICACIÓN', { bold: true, gap: 18 });
				drawLine(formValue('justificacion'));
				drawLine('DESCRIPCIÓN DEL BENEFICIO INSTITUCIONAL', { bold: true, gap: 18 });
				formValue('descripcion').split('\n').filter(Boolean).forEach((line) => drawLine(`- ${line}`));
				drawLine('EVIDENCIAS', { bold: true, gap: 18 });
				formValue('evidencias').split('\n').filter(Boolean).forEach((line, index) => drawLine(`${index + 1}. ${line}`));
				drawLine(`Titular: ${formValue('titularNombre')} | ${formValue('titularPuesto')}`);
				drawLine(`Enlace: ${formValue('enlaceNombre')} | ${formValue('enlacePuesto')}`);
				for (const key of ['titular', 'enlace']) {
					if (!imageData[key]) continue;
					try {
						const imageBytes = await fetch(imageData[key]).then((response) => response.arrayBuffer());
						const image = imageData[key].startsWith('data:image/png') ? await pdf.embedPng(imageBytes) : await pdf.embedJpg(imageBytes);
						addPageIfNeeded(70);
						page.drawImage(image, { x: key === 'titular' ? margin : 330, y: y - 50, width: 110, height: 45 });
					} catch (error) { console.warn('No se pudo incluir una firma en el PDF:', error); }
				}

				for (const file of Array.from(filesInput.files || [])) {
					const attached = await PDFDocument.load(await file.arrayBuffer());
					const pages = await pdf.copyPages(attached, attached.getPageIndices());
					pages.forEach((attachedPage) => pdf.addPage(attachedPage));
				}
				const bytes = await pdf.save();
				if (pdfUrl) URL.revokeObjectURL(pdfUrl);
				pdfUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
				const preview = container.querySelector('#evidencePreview');
				preview.hidden = false;
				preview.querySelector('iframe').src = pdfUrl;
				const download = container.querySelector('#downloadEvidencePdf');
				download.href = pdfUrl;
				download.click();
				window.SIDII.showMessage(message, 'PDF generado y descargado.', 'success');
			} catch (error) {
				console.error('Error al generar el PDF:', error);
				window.SIDII.showMessage(message, 'No se pudo generar el PDF. Revisa que los archivos adjuntos sean PDF válidos.');
			} finally {
				button.disabled = false;
			}
		});

		refreshDocument();
		window.addEventListener('beforeunload', () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, { once: true });
	}

	window.SIDII.renderEvidencias = render;
})();
