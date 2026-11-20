/* =========================================================
 * docx.js — 在瀏覽器裡直接組出 Word（.docx）檔
 * 比喻：.docx 其實是一個「壓縮包」，裡面放幾份 XML 說明書；
 *       我們用 JSZip 把說明書打包起來，就成為 Word 檔。
 * 不需要伺服器，手機離線也能產生。
 * ========================================================= */

const Docx = (() => {
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const FONT = '<w:rFonts w:ascii="Microsoft JhengHei" w:hAnsi="Microsoft JhengHei" w:eastAsia="微軟正黑體" w:cs="Microsoft JhengHei"/>';

  /** 文字片段 run：opts = { size(pt), bold, color } */
  function run(text, o = {}) {
    const rpr = [FONT];
    if (o.bold) rpr.push('<w:b/>');
    if (o.color) rpr.push(`<w:color w:val="${o.color}"/>`);
    if (o.size) rpr.push(`<w:sz w:val="${o.size * 2}"/><w:szCs w:val="${o.size * 2}"/>`);
    const lines = String(text ?? '').split('\n');
    return lines.map((ln, i) => `<w:r><w:rPr>${rpr.join('')}</w:rPr>${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(ln)}</w:t></w:r>`).join('');
  }

  /** 段落：runs 可以是字串或 run() 結果陣列 */
  function para(content, o = {}) {
    const ppr = [];
    if (o.align) ppr.push(`<w:jc w:val="${o.align}"/>`);
    ppr.push(`<w:spacing w:before="${o.before ?? 60}" w:after="${o.after ?? 60}" w:line="${o.line ?? 300}" w:lineRule="auto"/>`);
    if (o.indent) ppr.push(`<w:ind w:left="${o.indent}" w:hanging="${o.hanging ?? 0}"/>`);
    if (o.shade) ppr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>`);
    if (o.pageBreakBefore) ppr.push('<w:pageBreakBefore/>');
    if (o.keepNext) ppr.push('<w:keepNext/>');
    const body = Array.isArray(content) ? content.join('') : run(content, o);
    return `<w:p><w:pPr>${ppr.join('')}</w:pPr>${body}</w:p>`;
  }

  const bullet = (text, o = {}) => para([run('•  ', { size: o.size || 12, color: o.dot || 'A3244F' }), run(text, { size: o.size || 12 })], { indent: 480, hanging: 300 });

  /** 表格：rows = [[cell, cell], ...]，cell = { text|xml, width, fill, height, bold } */
  function table(rows, o = {}) {
    const border = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b => `<w:${b} w:val="single" w:sz="6" w:space="0" w:color="${o.borderColor || '7A8796'}"/>`).join('')}</w:tblBorders>`;
    const tr = rows.map(r => {
      const h = r.height ? `<w:trPr><w:trHeight w:val="${r.height}" w:hRule="atLeast"/><w:cantSplit/></w:trPr>` : '<w:trPr><w:cantSplit/></w:trPr>';
      const cells = (r.cells || r).map(c => {
        const tcpr = [`<w:tcW w:w="${c.width || 2000}" w:type="dxa"/>`];
        if (c.fill) tcpr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${c.fill}"/>`);
        if (c.span) tcpr.push(`<w:gridSpan w:val="${c.span}"/>`);
        tcpr.push('<w:vAlign w:val="' + (c.vAlign || 'top') + '"/>');
        const inner = c.xml || para(c.text ?? '', { size: c.size || 12, bold: c.bold, color: c.color, align: c.align, before: 40, after: 40 });
        return `<w:tc><w:tcPr>${tcpr.join('')}</w:tcPr>${inner}</w:tc>`;
      }).join('');
      return `<w:tr>${h}${cells}</w:tr>`;
    }).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="${o.width || 9638}" w:type="dxa"/>${border}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>${tr}</w:tbl>`;
  }

  /** 打包成 Blob */
  async function pack(bodyXml, { landscape = false, title = '' } = {}) {
    const W = landscape ? 16838 : 11906, H = landscape ? 11906 : 16838;
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="${W}" w:h="${H}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
    zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(HOSPITAL + ' ' + WARD)}</dc:creator></cp:coreProperties>`);
    zip.file('word/document.xml', doc);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /* ---------- 共用：文件抬頭 ---------- */
  function header(session, docTitle) {
    return [
      para(`${HOSPITAL} ${WARD_FULL}（${WARD}）`, { size: 12, color: '5A6573', align: 'center', after: 0 }),
      para(`${session.displayTopic}　${docTitle}`, { size: 20, bold: true, color: '7A1E3F', align: 'center', before: 60, after: 60 }),
      para(`簡報人：病房助理員 ${session.presenter.display}　｜　護理指導員：護理師${session.instructor.name}${session.date ? '　｜　日期：' + session.date : ''}`, { size: 11, color: '5A6573', align: 'center', after: 200 })
    ].join('');
  }

  /* =========================================================
   * 三份文件
   * ========================================================= */

  /** ① Q&A 題目與空白作答版 */
  function qaBlank(session) {
    const info = table([[
      { text: '姓名：', width: 2700, size: 12 },
      { text: '國籍：□印尼　□越南　□泰國', width: 4238, size: 12 },
      { text: '得分：　　／ 100', width: 2700, size: 12 }
    ]], { borderColor: 'B9C2CC' });
    const qs = session.qa.map((x, i) => [
      para([run(`第 ${i + 1} 題（20 分）　`, { size: 13, bold: true, color: '1F3A5F' }), run(x.q, { size: 13, bold: true })], { before: 240, after: 80, keepNext: true }),
      table([{ height: 1250, cells: [{ text: '作答：', width: 9638, size: 11, color: '8A94A0' }] }], { borderColor: 'B9C2CC' })
    ].join('')).join('');
    const body = header(session, '課後驗收 Q&A（作答卷）') + info +
      para('請用中文或你的母語作答，可以畫圖說明。', { size: 11, color: '5A6573', before: 160 }) + qs +
      para('護理指導員簽名：＿＿＿＿＿＿＿＿　　評核日期：＿＿＿＿＿＿＿＿', { size: 12, before: 400 });
    return pack(body, { title: `${session.displayTopic} Q&A 作答卷` });
  }

  /** ② 完整 Q&A 解答版 */
  function qaAnswer(session) {
    const rows = [{ cells: [
      { text: '題號', width: 900, fill: '1F3A5F', color: 'FFFFFF', bold: true, align: 'center' },
      { text: '題目', width: 3700, fill: '1F3A5F', color: 'FFFFFF', bold: true },
      { text: '參考答案', width: 5038, fill: '1F3A5F', color: 'FFFFFF', bold: true }
    ] }].concat(session.qa.map((x, i) => ({ cells: [
      { text: String(i + 1), width: 900, align: 'center', bold: true, fill: i % 2 ? 'FFFFFF' : 'F6EEF1' },
      { text: x.q, width: 3700, bold: true, fill: i % 2 ? 'FFFFFF' : 'F6EEF1' },
      { text: x.a, width: 5038, fill: i % 2 ? 'FFFFFF' : 'F6EEF1' }
    ] })));
    const body = header(session, '課後驗收 Q&A（完整解答）') + table(rows) +
      para('評分建議：每題 20 分，答出關鍵動作或數字即給分；錯誤觀念請當場示範更正。', { size: 11, color: '5A6573', before: 240 }) +
      para(`依據文件：${session.sourceTitle || session.topic.sourceHint}${session.sourcePages ? `（第 ${session.sourcePages} 頁）` : ''}`, { size: 11, color: '5A6573' });
    return pack(body, { title: `${session.displayTopic} Q&A 解答` });
  }

  /** ③ 簡報大綱（封面依 45／40／32pt 規範） */
  function outline(session) {
    const parts = [];
    parts.push(para(session.coverTitle, { size: 45, bold: true, color: '7A1E3F', align: 'center', before: 600, line: 260 }));
    parts.push(para(session.subtitle, { size: 40, bold: true, color: '1F3A5F', align: 'center', before: 240, line: 260 }));
    parts.push(para(session.coverByline, { size: 32, color: '3A4350', align: 'center', before: 240, line: 260 }));
    parts.push(para(`學員：${session.audienceText}　｜　依據：${session.sourceTitle || session.topic.sourceHint}`, { size: 12, color: '5A6573', align: 'center', before: 400 }));
    session.slides.forEach((s, i) => {
      parts.push(para([run(`投影片 ${s.no}　`, { size: 12, bold: true, color: 'A3244F' }), run(s.label, { size: 12, color: '5A6573' })], { pageBreakBefore: i === 0, before: 240, after: 0, keepNext: true }));
      parts.push(para(s.title, { size: 18, bold: true, color: '1F3A5F', before: 40, keepNext: true }));
      if (s.subtitle && s.kind !== 'cover') parts.push(para(s.subtitle, { size: 14, color: '3A4350' }));
      s.points.forEach(p => parts.push(bullet(p)));
      if (s.notes) parts.push(para([run('講者備註　', { size: 11, bold: true, color: '5A6573' }), run(s.notes, { size: 11, color: '3A4350' })], { shade: 'F1F3F6', indent: 240, before: 80, after: 160 }));
      if (session.withImagePrompts && s.imagePrompt) parts.push(para('圖像描述語：' + s.imagePrompt, { size: 10, color: '7A8796', indent: 240 }));
    });
    return pack(parts.join(''), { landscape: true, title: `${session.displayTopic} 簡報大綱` });
  }

  return { qaBlank, qaAnswer, outline };
})();
