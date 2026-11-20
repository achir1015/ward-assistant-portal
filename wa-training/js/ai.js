/* =========================================================
 * ai.js — 可選的 AI 助教（Google Gemini）
 * 比喻：內建範本像「現成教案」；AI 助教則是「幫你讀完 PDF、
 *       再依你的設定改寫教案」的助理。沒有金鑰也完全能用。
 *
 * PdfSource：用 pdf.js 讀 PDF，把指定頁轉成圖片
 *           （掃描版 PDF 也能讀，例如《照顧服務員訓練指引》）
 * GeminiTutor：把頁面圖片＋設定送給 Gemini，取回 JSON 大綱與 Q&A
 * ========================================================= */

const KEY_STORE = 'wa-training.geminiKey';
const MODEL_STORE = 'wa-training.geminiModel';

const AiSettings = {
  get key() { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } },
  set key(v) { try { v ? localStorage.setItem(KEY_STORE, v) : localStorage.removeItem(KEY_STORE); } catch {} },
  get model() { try { return localStorage.getItem(MODEL_STORE) || 'gemini-2.5-flash'; } catch { return 'gemini-2.5-flash'; } },
  set model(v) { try { localStorage.setItem(MODEL_STORE, v); } catch {} },
  get enabled() { return !!this.key; }
};

/* ---------- PDF 來源 ---------- */
class PdfSource {
  constructor(file, doc) { this.file = file; this.doc = doc; }
  static async open(file) {
    if (!window.pdfjsLib) throw new Error('PDF 元件載入失敗，請確認網路連線後重新整理。');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    const buf = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    return new PdfSource(file, doc);
  }
  get pageCount() { return this.doc.numPages; }

  /** 把一頁畫成 JPEG（回傳 dataURL）；maxW 控制解析度，避免手機記憶體爆掉 */
  async renderPage(n, maxW = 1400, quality = 0.72) {
    const page = await this.doc.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, maxW / v1.width);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const url = c.toDataURL('image/jpeg', quality);
    c.width = c.height = 0;
    return url;
  }

  /** 嘗試抽文字（文字版 PDF 才有） */
  async pageText(n) {
    const page = await this.doc.getPage(n);
    const tc = await page.getTextContent();
    return tc.items.map(i => i.str).join('').trim();
  }
}

/** 解析頁數字串：「12-15, 20」→ [12,13,14,15,20] */
function parsePageRange(str, max) {
  const out = new Set();
  String(str || '').split(/[,，、\s]+/).filter(Boolean).forEach(part => {
    const m = part.match(/^(\d+)\s*[-~－到至]\s*(\d+)$/);
    if (m) { let a = +m[1], b = +m[2]; if (a > b) [a, b] = [b, a]; for (let i = a; i <= b; i++) out.add(i); }
    else if (/^\d+$/.test(part)) out.add(+part);
  });
  return [...out].filter(n => n >= 1 && n <= max).sort((a, b) => a - b);
}

/* ---------- Gemini 助教 ---------- */
const GeminiTutor = {
  MAX_PAGES: 15,

  buildInstruction(session) {
    const cols = NATIONALITIES.filter(n => session.nationalities.includes(n.id)).map(n => n.lang);
    return `你是${HOSPITAL}${WARD}（${WARD_FULL}）的資深病房助理員，要為${session.audienceText}製作「${session.displayTopic}」實務教育訓練簡報。
請「只依據」附上的照護文件頁面內容（如果文件沒有提到，再用台灣護理實務常識補充，且不可與文件衝突）。同一主題的不同文案內容會不同，請忠於這份文件的步驟、數字與用語。
${session.sourceNotes ? '使用者指定的文案重點與特別要求：' + session.sourceNotes : ''}
語言：${session.lang.note}；學員${session.level === 'basic' ? '華語程度基礎，請用短句、常用字' : '具日常會話能力'}。
共 ${session.slideCount} 張投影片，固定結構：
1 封面（title 固定為「${session.coverTitle}」，subtitle 為「${session.subtitle}」，points 只放一行「${session.coverByline}」）
2 破題與議程（title 用一個引人思考的問題）
中間頁：目的與重要性、用物準備、操作步驟（可分 2–3 頁）、注意事項與感染管制、常見錯誤與正確做法${cols.length ? `、關鍵詞母語對照（中文＋${cols.join('、')}，每行格式「中文：印尼 xxx｜越南 xxx｜泰國 xxx」只列有選的語言）` : ''}
倒數第 2 張：總結與行動呼籲；最後 1 張：感謝與問答。
每張 points 3–5 點、每點不超過 30 字；notes 為口語化講者備註（2–3 句）。
${session.withImagePrompts ? `每張附 imagePrompt（圖像描述語），風格：${session.style.prompt}` : '【內容限定規則】不要提供任何視覺風格、配色、圖片、版面描述，imagePrompt 留空字串。'}
另外出 5 題 Q&A 驗收題（qa），題目簡短、答案具體（含關鍵數字或動作）。
只輸出 JSON。`;
  },

  schema: {
    type: 'OBJECT',
    properties: {
      slides: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        label: { type: 'STRING' }, title: { type: 'STRING' }, subtitle: { type: 'STRING' },
        points: { type: 'ARRAY', items: { type: 'STRING' } }, notes: { type: 'STRING' }, imagePrompt: { type: 'STRING' }
      }, required: ['label', 'title', 'points', 'notes'] } },
      qa: { type: 'ARRAY', items: { type: 'OBJECT', properties: { q: { type: 'STRING' }, a: { type: 'STRING' } }, required: ['q', 'a'] } }
    },
    required: ['slides', 'qa']
  },

  /** images：dataURL 陣列；texts：文字陣列；onStatus：進度回報 */
  async generate(session, { images = [], texts = [] }, onStatus = () => {}) {
    if (!AiSettings.key) throw new Error('尚未設定 Gemini 金鑰。');
    const parts = [{ text: this.buildInstruction(session) }];
    texts.forEach((t, i) => t && parts.push({ text: `【文件文字 ${i + 1}】\n${t}` }));
    images.forEach(u => parts.push({ inline_data: { mime_type: 'image/jpeg', data: u.split(',')[1] } }));
    if (!texts.length && !images.length) parts.push({ text: `（使用者未提供文件頁面，請依「${session.sourceTitle || session.topic.sourceHint}」常見內容與台灣護理實務撰寫）` });

    onStatus('AI 正在閱讀文件並撰寫大綱…（約 20–60 秒）');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(AiSettings.model)}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': AiSettings.key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: this.schema, temperature: 0.6 }
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || res.statusText;
      if (res.status === 400 && /API key/i.test(msg)) throw new Error('金鑰無效，請到「AI 設定」重新貼上。');
      if (res.status === 429) throw new Error('AI 免費額度暫時用完，請稍後再試，或先用內建範本。');
      throw new Error('AI 回應錯誤：' + msg);
    }
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    let obj;
    try { obj = JSON.parse(text); } catch { throw new Error('AI 回傳格式不正確，請再按一次產生。'); }
    const slides = (obj.slides || []).map((s, i) => new Slide({
      no: i + 1, kind: i === 0 ? 'cover' : (i === obj.slides.length - 1 ? 'thanks' : 'content'),
      label: s.label, title: s.title, subtitle: s.subtitle || '', points: s.points || [], notes: s.notes || '', imagePrompt: s.imagePrompt || ''
    }));
    // 封面一律套用規範文字，避免 AI 改寫
    if (slides[0]) {
      Object.assign(slides[0], { title: session.coverTitle, subtitle: session.subtitle, points: [session.coverByline], imagePrompt: session.style.prompt });
    }
    const qa = (obj.qa || []).slice(0, 5).map(x => new QAItem(x.q, x.a));
    while (qa.length < 5) qa.push(new QAItem('（請補題）', ''));
    return { slides, qa };
  },

  /** 只改寫單一張投影片 */
  async rewriteSlide(session, slide, wish) {
    if (!AiSettings.key) throw new Error('尚未設定 Gemini 金鑰。');
    const prompt = `你是${HOSPITAL}${WARD}病房助理員，正在為${session.audienceText}製作「${session.displayTopic}」教學簡報。
請依照需求改寫這一張投影片，語言：${session.lang.note}，學員${session.level === 'basic' ? '華語程度基礎' : '具日常會話能力'}。
目前內容：${JSON.stringify({ label: slide.label, title: slide.title, points: slide.points, notes: slide.notes })}
修改需求：${wish || '更生動、更口語、更好懂'}
只輸出 JSON：{"label":"","title":"","points":[],"notes":""}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(AiSettings.model)}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': AiSettings.key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.7 } })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('AI 回應錯誤：' + (data?.error?.message || res.statusText));
    const o = JSON.parse(data.candidates[0].content.parts.map(p => p.text || '').join(''));
    return { label: o.label || slide.label, title: o.title || slide.title, points: o.points?.length ? o.points : slide.points, notes: o.notes || slide.notes };
  }
};
