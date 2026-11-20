/* =========================================================
 * app.js — 畫面控制（把領域模型接到畫面上）
 * 結構：Store（存取草稿）→ Wizard（步驟切換）→ 各步驟的 render/bind
 * ========================================================= */
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const DRAFT_KEY = 'wa-training.draft.v1';
  const TOUR_KEY = 'wa-training.tourSeen';

  /* ---------- 草稿儲存（只存在這台裝置） ---------- */
  const Store = {
    load() { try { return TrainingSession.fromJSON(JSON.parse(localStorage.getItem(DRAFT_KEY))); } catch { return new TrainingSession(); } },
    save(s) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(s)); } catch {} },
    flag(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } }
  };

  const session = Store.load();
  let pdf = null;           // PdfSource（不存檔，重新整理後需重選）
  let current = 0;          // 目前步驟
  let slideIdx = 0;         // 目前編輯的投影片
  const save = () => Store.save(session);

  /* ---------- 步驟定義 ---------- */
  const STEPS = [
    { name: '主題', sub: '月份主題', help: '第一步，選擇本月的教學主題。主題表上的九個月份都已經內建範本，點一下就會帶入建議的依據文件與講師。如果要教別的主題，請選最後的自訂主題。' },
    { name: '人員', sub: '簡報者與指導者', help: '第二步，填寫簡報人的員工編號、姓名，以及護理指導員的姓名。這些資料會依照規定的格式，出現在第一頁封面。' },
    { name: '學員', sub: '國籍與程度', help: '第三步，勾選學員的國籍，例如印尼、越南、泰國。簡報會加入母語關鍵詞對照頁，並依照華語程度，用比較簡單的句子。' },
    { name: '依據文件', sub: '照護 PDF', help: '第四步，寫下依據的衛教單張名稱。同一個主題，不同文案內容會不同，所以請把這份文件的重點寫在「文案重點」。如果要讓 AI 讀內容，請選擇 PDF，並填寫相關的頁數。檔案只在你的裝置上讀取。' },
    { name: '簡報設定', sub: '頁數與風格', help: '第五步，設定投影片張數、簡報語言和視覺風格。視覺風格只會寫進 NotebookLM 的指令裡。' },
    { name: '預覽修改', sub: '逐頁調整', help: '第六步，選一種產生方式：內建範本內容、依文案架構交給 NotebookLM，或 AI 讀 PDF 產生。然後點左邊的頁碼，就能預覽並修改每一頁的文字。下方分頁可以修改 Q&A 五題。' },
    { name: '輸出', sub: 'Word 與指令', help: '最後一步，下載三份 Word 檔：作答卷、完整解答和簡報大綱。也可以用分享按鈕傳到 LINE 或 Gmail。複製 NotebookLM 指令後，貼到 NotebookLM 產生精美投影片。' }
  ];

  /* ---------- 共用小工具 ---------- */
  function toast(msg, ms = 2400) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fileBase = () => `RCW_${session.displayTopic}_${(session.date || new Date().toISOString().slice(0, 10)).replace(/-/g, '')}`;

  /* =========================================================
   * Wizard：步驟切換
   * ========================================================= */
  function renderSteps() {
    $('#steps').innerHTML = STEPS.map((s, i) => `<li><button type="button" data-go="${i}" ${i === current ? 'aria-current="step"' : ''} class="${i < current ? 'done' : ''}">
      <span class="num">${String(i + 1).padStart(2, '0')}</span><span class="lbl">${s.name}<small>${s.sub}</small></span></button></li>`).join('');
    $$('#steps [data-go]').forEach(b => b.onclick = () => go(+b.dataset.go));
  }
  function go(i) {
    i = Math.max(0, Math.min(STEPS.length - 1, i));
    if (i >= 5 && !session.slides.length) generateFromTemplate(true);
    current = i;
    $$('.step').forEach(el => el.hidden = +el.dataset.step !== i);
    renderSteps();
    $('#btnBack').disabled = i === 0;
    $('#btnNext').innerHTML = i === STEPS.length - 1 ? '重新開始<svg class="ico"><use href="#i-reset"/></svg>' : '下一步<svg class="ico"><use href="#i-right"/></svg>';
    $('#pos').textContent = `${i + 1} / ${STEPS.length}　${session.displayTopic}`;
    if (i === 5) { renderSlides(); renderQA(); }
    if (i === 6) renderOutput();
    const cur = $(`#steps [data-go="${i}"]`); cur && cur.scrollIntoView({ inline: 'center', block: 'nearest' });
    window.scrollTo({ top: 0 });
  }
  $('#btnBack').onclick = () => go(current - 1);
  $('#btnNext').onclick = () => {
    if (current === STEPS.length - 1) { $('#topicGrid').scrollIntoView(); go(0); return; }
    go(current + 1);
  };
  $$('[data-say]').forEach(b => b.onclick = () => {
    const text = STEPS[+b.dataset.say].help;
    if (!Narrator.supported) return toast('這台裝置不支援語音朗讀');
    Narrator.speak(text); toast('朗讀中…', 1500);
  });

  /* =========================================================
   * Step 1 主題
   * ========================================================= */
  const MONTHS = ['', '一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
  function renderTopics() {
    $('#topicGrid').innerHTML = TOPIC_LIBRARY.map(t => `<button type="button" class="topic" role="radio" aria-checked="${session.topicId === t.id}" data-topic="${t.id}">
      <span class="m">${MONTHS[t.month]}</span><span class="n">${t.name}</span><span class="p">主講 ${t.pair.join('／')}</span></button>`).join('') +
      `<button type="button" class="topic" role="radio" aria-checked="${session.topicId === 'custom'}" data-topic="custom">
      <span class="m">自訂</span><span class="n">其他主題</span><span class="p">自行輸入主題名稱</span></button>`;
    $$('[data-topic]').forEach(b => b.onclick = () => selectTopic(b.dataset.topic));
    $('#customWrap').hidden = session.topicId !== 'custom';
  }
  function selectTopic(id) {
    if (session.topicId === id) return;
    session.topicId = id;
    const t = session.topic;
    session.topicName = t.name;
    session.sourceTitle = t.sourceHint;
    // 依主題表帶入主講姓名（員工編號與姓氏請自行補上）
    if (id !== 'custom') {
      if (id === 'evac') { session.presenter = new Person({ empNo: 'N1918', name: '潘全偉' }); session.instructor = new Person({ name: '程新元' }); }
      else { session.presenter = new Person({ empNo: '', name: t.pair[0] }); session.instructor = new Person({ name: t.pair[1] }); }
    }
    session.slides = []; session.qa = []; session.generatedBy = '';
    save(); renderTopics(); fillForm();
    toast(`已選擇「${session.displayTopic}」`);
  }
  $('#customTopic').oninput = e => { session.customTopic = e.target.value.trim(); session.topicName = session.customTopic; session.sourceTitle = `${session.customTopic}衛教單張`; session.slides = []; session.qa = []; save(); };
  $('#date').oninput = e => { session.date = e.target.value; save(); };

  /* =========================================================
   * Step 2–5 表單綁定
   * ========================================================= */
  function fillForm() {
    $('#customTopic').value = session.customTopic;
    $('#date').value = session.date;
    $('#empNo').value = session.presenter.empNo;
    $('#presenterName').value = session.presenter.name;
    $('#instructorName').value = session.instructor.name;
    $('#subtitle').value = session.subtitle;
    $('#audienceSize').value = session.audienceSize;
    $('#sourceTitle').value = session.sourceTitle;
    $('#sourcePages').value = session.sourcePages;
    $('#sourceNotes').value = session.sourceNotes || '';
    $('#slideCount').value = String(session.slideCount);
    $('#deckLang').value = session.deckLang;
    $('#withImg').checked = session.withImagePrompts;
    $$('input[name=level]').forEach(r => r.checked = r.value === session.level);
    $$('#natChips input').forEach(c => c.checked = session.nationalities.includes(c.value));
    $$('#styleCards input').forEach(r => r.checked = r.value === session.styleId);
    updateCoverNote();
  }
  function updateCoverNote() {
    $('#coverPreviewNote').innerHTML = `<b>封面預覽</b><br>[標題 45pt] ${esc(session.coverTitle)}<br>[次標題 40pt] ${esc(session.subtitle)}<br>[小標題 32pt] ${esc(session.coverByline)}`;
  }
  // 封面相關欄位變動時，同步更新已產生的封面頁
  function syncCover() {
    const c = session.slides.find(s => s.kind === 'cover');
    if (c) { c.title = session.coverTitle; c.subtitle = session.subtitle; c.points = [session.coverByline]; }
    updateCoverNote(); save();
  }
  $('#empNo').oninput = e => { session.presenter.empNo = e.target.value.trim(); syncCover(); };
  $('#presenterName').oninput = e => { session.presenter.name = e.target.value.trim(); syncCover(); };
  $('#instructorName').oninput = e => { session.instructor.name = e.target.value.trim(); syncCover(); };
  $('#subtitle').oninput = e => { session.subtitle = e.target.value; syncCover(); };
  $('#audienceSize').oninput = e => { session.audienceSize = e.target.value; save(); };

  $('#natChips').innerHTML = NATIONALITIES.map(n => `<label class="chip"><input type="checkbox" value="${n.id}">${n.label}</label>`).join('');
  $$('#natChips input').forEach(c => c.onchange = () => {
    session.nationalities = $$('#natChips input:checked').map(x => x.value);
    session.slides = []; save();
  });
  $$('input[name=level]').forEach(r => r.onchange = () => { session.level = r.value; save(); });

  $('#sourceTitle').oninput = e => { session.sourceTitle = e.target.value; save(); };
  $('#sourceNotes').oninput = e => { session.sourceNotes = e.target.value; save(); };
  $('#sourcePages').oninput = e => { session.sourcePages = e.target.value.trim(); save(); previewPdf(); };
  $('#pdfFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    $('#pdfName').textContent = f.name;
    $('#pdfInfo').textContent = '讀取中…';
    try {
      pdf = await PdfSource.open(f);
      session.sourceFileName = f.name; save();
      $('#drop').classList.add('has');
      $('#pdfInfo').textContent = `共 ${pdf.pageCount} 頁，${(f.size / 1048576).toFixed(1)} MB。請在下方填寫相關頁數。`;
      previewPdf();
    } catch (err) {
      pdf = null; $('#pdfInfo').textContent = '無法讀取這個 PDF：' + err.message;
    }
  };
  async function previewPdf() {
    if (!pdf) return;
    const pages = parsePageRange(session.sourcePages, pdf.pageCount);
    const n = pages[0] || 1;
    try {
      $('#pdfPreview').src = await pdf.renderPage(n, 420, 0.7);
      $('#pdfPreview').alt = `第 ${n} 頁預覽`;
      $('#pdfPreviewWrap').hidden = false;
    } catch {}
  }

  $('#slideCount').onchange = e => { session.slideCount = +e.target.value; session.slides = []; save(); };
  $('#deckLang').innerHTML = DECK_LANGS.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
  $('#deckLang').onchange = e => { session.deckLang = e.target.value; save(); };
  const SWATCH = { business: ['#a3244f', '#1f3a5f', '#4a4f5a'], tech: ['#ff2e88', '#141826', '#38e1ff'], clay: ['#f7b9cf', '#a9d3f2', '#fff4e8'], warm: ['#f2a65a', '#f6e1c6', '#7a5235'] };
  $('#styleCards').innerHTML = VISUAL_STYLES.map(s => `<label class="style-card"><input type="radio" name="style" value="${s.id}"><div><b>${s.name}</b><span>${s.desc}</span>
    <div class="swatch">${SWATCH[s.id].map(c => `<i style="background:${c}"></i>`).join('')}</div></div></label>`).join('');
  $$('#styleCards input').forEach(r => r.onchange = () => {
    session.styleId = r.value;
    const c = session.slides.find(s => s.kind === 'cover'); if (c) c.imagePrompt = session.style.prompt;
    save();
  });
  $('#withImg').onchange = e => { session.withImagePrompts = e.target.checked; save(); };

  /* =========================================================
   * Step 6 產生與逐頁修改
   * ========================================================= */
  function generateFromTemplate(silent) {
    session.slides = OutlineBuilder.build(session);
    session.qa = OutlineBuilder.buildQA(session);
    session.generatedBy = 'template';
    slideIdx = 0; save();
    $('#genStatus').textContent = `已用內建「${session.displayTopic}」範本產生 ${session.slides.length} 張投影片與 Q&A 五題。`;
    if (!silent) { renderSlides(); renderQA(); toast('已產生大綱'); }
  }
  $('#btnGenTpl').onclick = () => generateFromTemplate(false);
  $('#btnGenFrame').onclick = () => {
    session.slides = OutlineBuilder.buildFrame(session);
    if (!session.qa.length) session.qa = OutlineBuilder.buildQA(session);
    session.generatedBy = 'frame'; slideIdx = 0; save();
    $('#genStatus').textContent = `已排好 ${session.slides.length} 頁架構，各頁內容將由 NotebookLM 依「${session.sourceTitle}」撰寫。Q&A 請依文案修改。`;
    renderSlides(); renderQA(); toast('已產生文案架構');
  };

  $('#btnGenAi').onclick = async () => {
    if (!AiSettings.enabled) { openAi(); toast('請先設定 Gemini 金鑰'); return; }
    const btn = $('#btnGenAi'); btn.disabled = true;
    const status = t => { $('#genStatus').textContent = t; };
    try {
      const images = [], texts = [];
      if (pdf) {
        let pages = parsePageRange(session.sourcePages, pdf.pageCount);
        if (!pages.length) {
          if (pdf.pageCount > GeminiTutor.MAX_PAGES) throw new Error(`PDF 有 ${pdf.pageCount} 頁，請在第 4 步填寫相關頁數（最多 ${GeminiTutor.MAX_PAGES} 頁）。`);
          pages = Array.from({ length: pdf.pageCount }, (_, i) => i + 1);
        }
        pages = pages.slice(0, GeminiTutor.MAX_PAGES);
        for (const [k, n] of pages.entries()) {
          status(`準備 PDF 第 ${n} 頁（${k + 1}/${pages.length}）…`);
          const txt = await pdf.pageText(n).catch(() => '');
          if (txt.length > 200) texts.push(`第 ${n} 頁：${txt}`);
          else images.push(await pdf.renderPage(n));   // 掃描版：改送圖片
        }
      } else if (session.sourceFileName) {
        status('重新整理後需要重新選擇 PDF，這次先依文件名稱與護理實務產生。');
      }
      const { slides, qa } = await GeminiTutor.generate(session, { images, texts }, status);
      if (!slides.length) throw new Error('AI 沒有產生內容，請再試一次。');
      session.slides = slides; session.qa = qa; session.generatedBy = 'ai'; slideIdx = 0; save();
      status(`AI 已產生 ${slides.length} 張投影片與 Q&A 五題，請逐頁檢查是否正確。`);
      renderSlides(); renderQA(); toast('AI 產生完成');
    } catch (err) {
      status(err.message); toast(err.message, 4000);
    } finally { btn.disabled = false; }
  };

  const ART = { cover: 'a-heart', agenda: 'a-chat', terms: 'a-chat', summary: 'a-flag', thanks: 'a-q' };
  function artFor(s) {
    if (ART[s.kind]) return ART[s.kind];
    const l = s.label;
    if (/目的/.test(l)) return 'a-target';
    if (/用物|準備/.test(l)) return 'a-kit';
    if (/步驟|演練|流程/.test(l)) return 'a-steps';
    if (/注意|安全|感染|檢核/.test(l)) return 'a-shield';
    if (/錯誤/.test(l)) return 'a-x';
    return 'a-steps';
  }
  function slideHTML(s, total) {
    if (s.kind === 'cover') {
      return `<div class="slide cover slide-enter"><div class="s-hosp">${esc(HOSPITAL)}　${esc(WARD_FULL)}</div>
        <div class="s-title">${esc(s.title)}</div><div class="s-sub">${esc(s.subtitle)}</div>
        <div class="s-by">${esc(s.points[0] || '')}</div></div>`;
    }
    return `<div class="slide ${s.kind} slide-enter"><div class="s-tag">${String(s.no).padStart(2, '0')} · ${esc(s.label)}</div>
      <div class="s-title">${esc(s.title)}</div>${s.subtitle ? `<div class="s-sub">${esc(s.subtitle)}</div>` : ''}
      <ul>${s.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
      <div class="s-foot"><span>${esc(WARD)} · ${esc(session.displayTopic)}</span><span>${s.no} / ${total}</span></div>
      <svg class="s-art" aria-hidden="true"><use href="#${artFor(s)}"/></svg></div>`;
  }
  function renderSlides() {
    if (!session.slides.length) generateFromTemplate(true);
    slideIdx = Math.min(slideIdx, session.slides.length - 1);
    $('#slideList').innerHTML = session.slides.map((s, i) => `<li><button type="button" data-si="${i}" aria-current="${i === slideIdx}">
      <span class="sn">${String(s.no).padStart(2, '0')}</span><span class="st">${esc(s.label)}</span></button></li>`).join('');
    $$('#slideList [data-si]').forEach(b => b.onclick = () => { slideIdx = +b.dataset.si; renderSlides(); });
    const s = session.slides[slideIdx];
    $('#slideFrame').innerHTML = slideHTML(s, session.slides.length);
    $('#eLabel').value = s.label; $('#eTitle').value = s.title; $('#eSub').value = s.subtitle;
    $('#ePoints').value = s.points.join('\n'); $('#eNotes').value = s.notes; $('#eImg').value = s.imagePrompt;
    $('#eImgWrap').hidden = !(session.withImagePrompts || s.kind === 'cover');
    $('#eSubWrap').hidden = !(s.kind === 'cover' || s.subtitle);
    $('#btnPrevSlide').disabled = slideIdx === 0;
    $('#btnNextSlide').disabled = slideIdx === session.slides.length - 1;
    const cur = $(`#slideList [data-si="${slideIdx}"]`); cur && cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  // 編輯欄位 → 即時更新模型與預覽（不重繪整個清單，避免游標跳掉）
  function bindEdit(id, apply) {
    $(id).oninput = e => {
      const s = session.slides[slideIdx]; if (!s) return;
      apply(s, e.target.value); save();
      $('#slideFrame').innerHTML = slideHTML(s, session.slides.length).replace(' slide-enter', '');
      const st = $(`#slideList [data-si="${slideIdx}"] .st`); if (st) st.textContent = s.label;
    };
  }
  bindEdit('#eLabel', (s, v) => s.label = v);
  bindEdit('#eTitle', (s, v) => s.title = v);
  bindEdit('#eSub', (s, v) => s.subtitle = v);
  bindEdit('#ePoints', (s, v) => s.points = v.split('\n').map(x => x.trim()).filter(Boolean));
  bindEdit('#eNotes', (s, v) => s.notes = v);
  bindEdit('#eImg', (s, v) => s.imagePrompt = v);
  $('#btnPrevSlide').onclick = () => { slideIdx--; renderSlides(); };
  $('#btnNextSlide').onclick = () => { slideIdx++; renderSlides(); };
  const renumber = () => session.slides.forEach((s, i) => s.no = i + 1);
  $('#btnAddSlide').onclick = () => {
    session.slides.splice(slideIdx + 1, 0, new Slide({ kind: 'content', label: '新增頁', title: '（請輸入標題）', points: ['（請輸入重點）'], notes: '' }));
    renumber(); slideIdx++; save(); renderSlides(); $('#eTitle').focus();
  };
  // 刪除用頁內確認（不用 confirm 視窗）
  $('#btnDelSlide').onclick = () => {
    const b = $('#btnDelSlide');
    if (session.slides[slideIdx].kind === 'cover') return toast('封面頁不能刪除');
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = '再按一次確認刪除'; setTimeout(() => { delete b.dataset.armed; b.innerHTML = '<svg class="ico"><use href="#i-trash"/></svg>刪除此頁'; }, 3000); return; }
    delete b.dataset.armed; b.innerHTML = '<svg class="ico"><use href="#i-trash"/></svg>刪除此頁';
    session.slides.splice(slideIdx, 1); renumber(); slideIdx = Math.max(0, slideIdx - 1); save(); renderSlides();
    if (session.slides.length < 10) toast(`目前 ${session.slides.length} 張，規定不少於 10 張`, 3500);
  };
  $('#btnRewrite').onclick = async () => {
    if (!AiSettings.enabled) { openAi(); toast('請先設定 Gemini 金鑰'); return; }
    const s = session.slides[slideIdx], b = $('#btnRewrite');
    b.disabled = true; b.textContent = 'AI 改寫中…';
    try {
      Object.assign(s, await GeminiTutor.rewriteSlide(session, s, $('#eWish').value));
      if (s.kind === 'cover') syncCover();
      save(); renderSlides(); toast('已改寫這一頁');
    } catch (err) { toast(err.message, 4000); }
    finally { b.disabled = false; b.innerHTML = '<svg class="ico"><use href="#i-spark"/></svg>AI 改寫這頁'; }
  };

  // 分頁：投影片 / Q&A
  $$('[data-tab]').forEach(t => t.onclick = () => {
    $$('[data-tab]').forEach(x => x.setAttribute('aria-selected', x === t));
    $$('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== t.dataset.tab);
  });
  function renderQA() {
    $('#qaList').innerHTML = session.qa.map((x, i) => `<div class="qa-item"><span class="qn">Q${i + 1}</span>
      <label class="f">題目<input type="text" data-q="${i}" value="${esc(x.q)}"></label>
      <label class="f">參考答案<textarea rows="2" data-a="${i}">${esc(x.a)}</textarea></label></div>`).join('');
    $$('[data-q]').forEach(el => el.oninput = () => { session.qa[+el.dataset.q].q = el.value; save(); });
    $$('[data-a]').forEach(el => el.oninput = () => { session.qa[+el.dataset.a].a = el.value; save(); });
  }

  /* =========================================================
   * Step 7 輸出
   * ========================================================= */
  const DOCS = {
    qaBlank: { make: () => Docx.qaBlank(session), name: () => `${fileBase()}_QA作答卷.docx` },
    qaAnswer: { make: () => Docx.qaAnswer(session), name: () => `${fileBase()}_QA完整解答.docx` },
    outline: { make: () => Docx.outline(session), name: () => `${fileBase()}_簡報大綱.docx` }
  };
  function renderOutput() {
    if (!session.slides.length) generateFromTemplate(true);
    $('#promptBox').value = PromptBuilder.notebookLM(session);
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  $$('[data-dl]').forEach(b => b.onclick = async () => {
    if (!window.JSZip) return toast('Word 元件載入失敗，請確認網路後重新整理');
    const d = DOCS[b.dataset.dl];
    try { download(await d.make(), d.name()); toast('已下載：' + d.name()); }
    catch (err) { toast('產生失敗：' + err.message, 4000); }
  });
  $('#btnShare').onclick = async () => {
    if (!window.JSZip) return toast('Word 元件載入失敗，請確認網路後重新整理');
    const files = await Promise.all(Object.values(DOCS).map(async d => new File([await d.make()], d.name(), { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })));
    if (navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ files, title: `${session.displayTopic} 教學資料`, text: `${session.coverTitle}：Q&A 作答卷、完整解答、簡報大綱` }); }
      catch (err) { if (err.name !== 'AbortError') toast('分享失敗：' + err.message); }
    } else {
      files.forEach((f, i) => setTimeout(() => download(f, f.name), i * 600));
      toast('這台裝置不支援直接分享，已改為下載三份檔案', 3500);
    }
  };
  $('#btnMail').onclick = () => {
    const subject = `${session.coverTitle}｜簡報大綱與 Q&A`;
    let body = PromptBuilder.plainOutline(session);
    if (body.length > 1600) body = body.slice(0, 1600) + '\n…（完整內容請見附件 Word 檔）';
    body += '\n\n※ 請附上「Q&A 作答卷」「Q&A 完整解答」「簡報大綱」三份 Word 檔。';
    location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
  $('#btnCopy').onclick = async () => {
    const box = $('#promptBox');
    try { await navigator.clipboard.writeText(box.value); toast('已複製，請到 NotebookLM 貼上'); }
    catch { box.removeAttribute('readonly'); box.focus(); box.select(); document.execCommand && document.execCommand('copy'); box.setAttribute('readonly', ''); toast('已選取文字，請按「拷貝」'); }
  };

  /* =========================================================
   * AI 設定對話框
   * ========================================================= */
  function syncAiLabel() {
    $('#aiLabel').textContent = AiSettings.enabled ? 'AI 已啟用' : 'AI 設定';
    $('#btnAi').classList.toggle('ai-on', AiSettings.enabled);
  }
  function openAi() {
    $('#aiKey').value = AiSettings.key; $('#aiModel').value = AiSettings.model;
    const d = $('#aiDialog'); d.showModal ? d.showModal() : d.setAttribute('open', '');
  }
  $('#btnAi').onclick = openAi;
  $('#aiDialog').addEventListener('close', () => {
    const v = $('#aiDialog').returnValue;
    if (v === 'save') { AiSettings.key = $('#aiKey').value.trim(); AiSettings.model = $('#aiModel').value; toast(AiSettings.enabled ? 'AI 已啟用' : '未填金鑰'); }
    if (v === 'clear') { AiSettings.key = ''; toast('已清除金鑰'); }
    syncAiLabel();
  });

  /* =========================================================
   * 語音教學導覽：一步一步帶著做
   * ========================================================= */
  const TOUR = [
    { target: null, text: '歡迎使用外傭技術教育簡報產生器！我是小護士，接下來用一分鐘，帶你看完整個流程。可以隨時按暫停或靜音。', before: () => go(0) },
    { target: '#steps', text: '左邊（手機在上方）是七個步驟。照著順序，一項一項設定，就能完成簡報輸出。' },
    { target: '#topicGrid', text: '第一步，選本月教學主題。主題表上的九個主題都有內建範本，例如七月的逃生滑墊。', before: () => go(0) },
    { target: '#empNo', text: '第二步，填簡報人的員工編號、姓名，以及護理指導員。封面會自動排成規定的格式。', before: () => go(1) },
    { target: '#natChips', text: '第三步，勾選學員國籍：印尼、越南或泰國。簡報會多一頁母語關鍵詞對照。', before: () => go(2) },
    { target: '#drop', text: '第四步，寫下依據的衛教單張和文案重點。同一個主題，文案不同，簡報內容就會跟著不同。也可以選擇 PDF，讓 AI 幫你讀。', before: () => go(3) },
    { target: '#styleCards', text: '第五步，選投影片張數、語言和視覺風格。風格會寫進 NotebookLM 的指令。', before: () => go(4) },
    { target: '#slideFrame', text: '第六步，按產生，就會看到每一頁的預覽。點左邊頁碼，可以修改任何一頁的文字需求。', before: () => go(5) },
    { target: '#outCards', text: '最後，下載 Q&A 作答卷、完整解答和簡報大綱三份 Word，或按分享傳到 LINE、Gmail。', before: () => go(6) },
    { target: '#promptBox', text: '再把 NotebookLM 指令複製起來，貼到 NotebookLM 的自訂簡報，就能產生圖文並茂的投影片。祝教學順利！', before: () => go(6) }
  ];
  function startTour() {
    Narrator.pickVoice();
    const back = current;
    new GuideTour(TOUR, { onClose: () => { Store.flag(TOUR_KEY, '1'); go(back === 6 ? 6 : 0); } }).start();
  }
  $('#btnTour').onclick = startTour;

  /* ---------- 啟動 ---------- */
  // 在工作站裡開啟時（iframe），隱藏「回工作站」按鈕，改用工作站上方的返回列
  try { if (window.top !== window) $('#btnHome').hidden = true; } catch {}
  renderTopics(); fillForm(); syncAiLabel(); go(0);
  if (!Store.flag(TOUR_KEY)) {
    // 第一次使用：顯示導覽（語音需使用者點擊後才會播放，所以先用文字邀請）
    setTimeout(() => toast('第一次使用？按上方「語音教學導覽」看一分鐘介紹', 5000), 600);
  }
})();
