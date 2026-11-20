/* =========================================================
 * domain.js — 領域模型
 *
 * 用「備課」來比喻整個流程：
 *   TrainingSession（一堂課）
 *     ├─ Presenter    講師（病房助理員）
 *     ├─ Instructor   護理指導員
 *     ├─ Audience     學員（外傭國籍、語言程度）
 *     ├─ SourceDoc    依據文件（照護 PDF）
 *     ├─ VisualStyle  視覺風格（只給 NotebookLM 指令用）
 *     ├─ Slide[]      投影片大綱（可逐頁修改）
 *     └─ QAItem[]     課後驗收 Q&A 五題
 *
 *   OutlineBuilder：依主題範本「排課」→ 產生投影片大綱
 *   PromptBuilder ：把整堂課翻譯成 NotebookLM 看得懂的指令
 * ========================================================= */

const HOSPITAL = '臺北市立聯合醫院忠孝院區';
const WARD = 'RCW';
const WARD_FULL = '呼吸照護病房';
const SUBTITLE_DEFAULT = '提升 RCW 照護品質，落實感染管制';

/* ---------- 學員國籍 ---------- */
const NATIONALITIES = [
  { id: 'id', label: '印尼', lang: '印尼文', col: 1 },
  { id: 'vi', label: '越南', lang: '越南文', col: 2 },
  { id: 'th', label: '泰國', lang: '泰文', col: 3 }
];

/* ---------- 視覺風格（取自 docx 範例與 NotebookLM 常用風格） ---------- */
const VISUAL_STYLES = [
  { id: 'business', name: '專業企業商務', desc: '深粉紅藍、深灰沉穩配色，結構化版面',
    prompt: '畫面中央是溫馨的團隊和諧，請以專業企業商務風格設計簡報，採用深粉紅藍、深灰等沉穩配色，搭配清晰的資料圖表、結構化版面與正式排版，展現權威感與可信度。' },
  { id: 'tech', name: '科技潮流', desc: '電能粉紅、深色網格、霓虹光暈',
    prompt: '科技潮流配色（如：電能粉紅、深色網格、霓虹光暈）、精密醫療防護感、硬朗直角排版。' },
  { id: 'clay', name: '3D 立體插畫', desc: '柔和粉藍、等角立體場景、親切人物',
    prompt: '3D 等角立體插畫風格，柔和的粉紅與淺藍配色，搭配親切的醫護人物角色與立體場景，資訊以標籤與箭頭清楚標示。' },
  { id: 'warm', name: '溫馨照護手繪', desc: '暖色手繪、圖卡式步驟',
    prompt: '溫馨手繪插畫風格，暖色調，步驟以圖卡與編號呈現，文字少、圖像多，適合語言程度不同的學員。' }
];

/* ---------- 簡報語言 ---------- */
const DECK_LANGS = [
  { id: 'zh', name: '繁體中文', note: '台灣繁體中文通用語' },
  { id: 'zh-en', name: '中文＋英文對照', note: '標題中英對照，內文以繁體中文為主' },
  { id: 'en', name: 'English', note: 'English, simple vocabulary' }
];

/* =========================================================
 * 值物件與實體
 * ========================================================= */
class Person {
  constructor({ empNo = '', name = '' } = {}) { this.empNo = empNo; this.name = name; }
  get display() { return [this.empNo, this.name].filter(Boolean).join(' '); }
}

class Slide {
  /** kind：cover / agenda / content / terms / summary / thanks */
  constructor({ no, kind = 'content', label = '', title = '', subtitle = '', points = [], notes = '', imagePrompt = '' }) {
    Object.assign(this, { no, kind, label, title, subtitle, points: [...points], notes, imagePrompt });
  }
  clone() { return new Slide(this); }
}

class QAItem {
  constructor(q = '', a = '') { this.q = q; this.a = a; }
}

class TrainingSession {
  constructor() {
    this.topicId = 'evac';
    this.topicName = '逃生滑墊';
    this.customTopic = '';
    this.date = '';
    this.subtitle = SUBTITLE_DEFAULT;
    this.presenter = new Person({ empNo: 'N1918', name: '潘全偉' });
    this.instructor = new Person({ name: '程新元' });
    this.nationalities = ['id', 'vi', 'th'];
    this.level = 'basic';          // basic 基礎華語 / mid 日常會話
    this.audienceSize = '';
    this.sourceTitle = '逃生滑墊使用說明、病房火災應變流程';
    this.sourceFileName = '';
    this.sourcePages = '';         // 例如 "282-290"
    this.sourceNotes = '';         // 文案重點／特別要求：同一主題、不同文案，內容就不同
    this.contentMode = 'template'; // template 範本內容 / frame 依文案架構 / ai AI 讀 PDF
    this.styleId = 'business';
    this.deckLang = 'zh';
    this.slideCount = 11;
    this.withImagePrompts = false; // 依 docx「內容限定規則」預設不產生每頁圖像描述
    this.slides = [];
    this.qa = [];
    this.generatedBy = '';         // 'template' | 'ai'
  }

  get topic() {
    return TOPIC_LIBRARY.find(t => t.id === this.topicId) || makeCustomTopic(this.customTopic);
  }
  get displayTopic() { return this.topicId === 'custom' ? (this.customTopic || '自訂主題') : this.topicName; }
  get style() { return VISUAL_STYLES.find(s => s.id === this.styleId) || VISUAL_STYLES[0]; }
  get lang() { return DECK_LANGS.find(l => l.id === this.deckLang) || DECK_LANGS[0]; }
  get audienceText() {
    const names = NATIONALITIES.filter(n => this.nationalities.includes(n.id)).map(n => n.label + '籍');
    return (names.length ? names.join('、') : '外籍') + '看護（外傭）';
  }
  /** 封面主標題：臺北市立聯合醫院忠孝院區 RCW [主題]教學護理實務 */
  get coverTitle() { return `${HOSPITAL} ${WARD} ${this.displayTopic}教學護理實務`; }
  get coverByline() {
    return `簡報人：病房助理員 ${this.presenter.display || '[員工編號 員工姓名]'} | 護理指導員：護理師${this.instructor.name || '[員工姓名]'}`;
  }

  /** 存檔用（localStorage） */
  toJSON() { return { ...this }; }
  static fromJSON(o) {
    const s = new TrainingSession();
    if (!o) return s;
    Object.assign(s, o);
    s.presenter = new Person(o.presenter);
    s.instructor = new Person(o.instructor);
    s.slides = (o.slides || []).map(x => new Slide(x));
    s.qa = (o.qa || []).map(x => new QAItem(x.q, x.a));
    return s;
  }
}

/* =========================================================
 * OutlineBuilder：依範本排出投影片大綱
 * 就像把食材（主題範本）依食譜（固定頁型）擺盤
 * ========================================================= */
const OutlineBuilder = {
  build(session) {
    const t = session.topic;
    const topicName = session.displayTopic;
    const slides = [];
    const add = s => slides.push(new Slide({ no: slides.length + 1, ...s }));

    // 1. 封面（字級規範：標題 45pt／次標題 40pt／小標題 32pt）
    add({
      kind: 'cover', label: '封面頁',
      title: session.coverTitle,
      subtitle: session.subtitle,
      points: [session.coverByline],
      notes: `大家好，我是病房助理員${session.presenter.name || ''}。今天由護理師${session.instructor.name || ''}陪我們一起學「${topicName}」。` +
        `請大家放輕鬆，聽不懂可以隨時舉手，我們會用簡單的中文、慢慢說，也會實際示範。`,
      imagePrompt: session.style.prompt
    });

    // 2. 破題與議程
    add({
      kind: 'agenda', label: '破題與議程',
      title: t.hook,
      points: ['為什麼要做（目的）', '要準備什麼（用物）', '怎麼做（步驟）', '哪裡要小心（注意事項）', '課後驗收 Q&A 五題'],
      notes: `先問大家一個問題：${t.hook} 今天我們分五個部分，最後會有五題小測驗，請大家認真聽。`
    });

    // 3. 目的
    add({
      kind: 'content', label: '目的與重要性',
      title: `為什麼要做好「${topicName}」？`,
      points: t.purposes,
      notes: `這一頁講目的。重點是：${t.purposes[0]}。請記住，做對了，病人舒服、我們也安全。`
    });

    // 4. 用物準備
    add({
      kind: 'content', label: '用物準備',
      title: '開始前，先把東西準備好',
      points: t.supplies,
      notes: '我現在一樣一樣拿給大家看，請跟著我說出名稱。東西準備齊全，做的時候就不會手忙腳亂。'
    });

    // 5、6. 操作步驟
    add({ kind: 'content', label: '操作步驟（一）', title: t.stepsA.title, points: t.stepsA.items,
      notes: '這一頁我會一邊說一邊示範，一個步驟做完再做下一個。請大家看清楚順序。' });
    add({ kind: 'content', label: '操作步驟（二）', title: t.stepsB.title, points: t.stepsB.items,
      notes: '接著第二部分。等一下請兩位同學上來練習，其他人幫忙檢查有沒有漏掉步驟。' });

    // 7. 注意事項／感染管制
    add({ kind: 'content', label: '注意事項與感染管制', title: '安全第一：這幾點一定要記住', points: t.cautions,
      notes: `這一頁是安全重點。特別提醒：${t.cautions[0]}。` });

    // 8. 常見錯誤 vs 正確做法
    add({
      kind: 'content', label: '常見錯誤與正確做法',
      title: '這樣做不對！正確應該這樣做',
      points: t.errors.map(([w, r]) => `✗ ${w} → ✓ ${r}`),
      notes: `這些都是病房裡常看到的錯誤。看到以下情形要馬上報告護理師：${t.report}。`
    });

    // 9. 三語關鍵詞（依學員國籍）
    const cols = NATIONALITIES.filter(n => session.nationalities.includes(n.id));
    if (cols.length) {
      add({
        kind: 'terms', label: '關鍵詞母語對照',
        title: '關鍵詞，用你的語言記住',
        points: t.terms.map(row => `${row[0]}：` + cols.map(c => `${c.label} ${row[c.col]}`).join('｜')),
        notes: '請大家用自己的語言唸一次這些關鍵詞，再用中文唸一次。（母語翻譯請由學員或通譯協助確認。）'
      });
    }

    // 10. 總結與行動呼籲
    add({
      kind: 'summary', label: '總結與行動呼籲',
      title: '重點回顧與下一步行動',
      points: [t.stepsA.items[0], t.cautions[0], `立即報告：${t.report}`, `行動呼籲：${t.action}`],
      notes: `最後幫大家整理重點。請記住一句話：${t.action} 明天上班就開始做！`
    });

    // 11. 感謝與問答
    add({
      kind: 'thanks', label: '感謝與問答',
      title: '感謝聆聽',
      points: ['Q&A 時間：有問題請舉手', '課後驗收：Q&A 五題（紙本作答）', `聯絡：病房助理員 ${session.presenter.display}／護理師 ${session.instructor.name}`],
      notes: '謝謝大家今天認真學習！現在發下 Q&A 五題，請寫完交給我。有任何問題，上班時隨時可以問我或護理師。'
    });

    // 依設定頁數補頁（大於 11 頁時加入「實作演練」「情境題」等頁）
    const extras = [
      { label: '實作演練', title: '換你試試看：分組實作演練', points: ['兩人一組，一人操作、一人檢查', '依步驟清單逐項打勾', '護理指導員現場回饋'], notes: '請兩人一組，照著步驟清單練習。做完互相交換角色。' },
      { label: '情境練習', title: '情境題：如果是你，會怎麼做？', points: [`情境：照護中發現「${t.report.split('、')[0]}」`, '你的第一個動作是？', '要報告誰？要說什麼？'], notes: '請大家想一想，再分享答案。重點是：發現異常，先保護病人、再立即報告。' },
      { label: '每日檢核', title: '每天上班的自我檢核清單', points: t.cautions.slice(0, 3).map(c => '□ ' + c), notes: '這張清單可以拍照存在手機裡，每天上班檢查一次。' }
    ];
    let i = 0;
    while (slides.length < session.slideCount && i < extras.length) {
      slides.splice(slides.length - 2, 0, new Slide({ kind: 'content', ...extras[i++] }));
    }
    slides.forEach((s, idx) => { s.no = idx + 1; });
    return slides;
  },

  /**
   * 依文案架構：只保留「頁型＋撰寫指引」，內容交給 NotebookLM 依來源 PDF 撰寫。
   * 比喻：範本是「現成菜單」；架構模式是「只給餐盤格子」，菜色看當天食材（文案）。
   */
  buildFrame(session) {
    const src = session.sourceTitle || session.topic.sourceHint;
    const tpl = this.build(session);
    const guide = {
      '破題與議程': ['（依來源文件）用一個問題或情境引起學員注意', '列出今天的 4–5 個學習重點'],
      '目的與重要性': ['（依來源文件）列出這項照護的目的 3–4 點', '說明做不好會發生什麼風險'],
      '用物準備': ['（依來源文件）列出需要準備的用物與規格'],
      '操作步驟（一）': ['（依來源文件）前半段步驟，依順序 4–5 點', '標出關鍵數字（溫度、角度、時間、次數）'],
      '操作步驟（二）': ['（依來源文件）後半段步驟，依順序 4–5 點', '包含結束後的整理與紀錄'],
      '注意事項與感染管制': ['（依來源文件）安全與感染管制重點 3–4 點'],
      '常見錯誤與正確做法': ['（依來源文件）整理 3–4 組「錯誤 → 正確」對照', '需要立即報告護理師的情形'],
      '總結與行動呼籲': ['（依來源文件）重申 3 個最重要的動作', '一句明確的行動呼籲']
    };
    return tpl.map(s => {
      if (!guide[s.label]) return s;
      return new Slide({ ...s, title: `（依「${src}」撰寫）${s.label}`, points: guide[s.label], notes: '（依來源文件撰寫口語化講者備註，語氣親切、短句）' });
    });
  },

  buildQA(session) {
    return session.topic.qa.map(([q, a]) => new QAItem(q, a));
  }
};

/* =========================================================
 * PromptBuilder：組出 NotebookLM 指令（依 docx 的 CSIF 格式）
 * Context 上下文 / Specific 具體信息 / Intent 目標 / Format 格式
 * ========================================================= */
const PromptBuilder = {
  notebookLM(session) {
    const t = session.topic;
    const topic = session.displayTopic;
    const L = [];
    L.push(`製作${HOSPITAL} ${WARD} 病房「${topic}」外傭與看護教育訓練簡報內容。`);
    L.push('');
    L.push('上下文（Context）');
    L.push(`角色／身分：${HOSPITAL}病房助理員（資深前輩）。`);
    L.push(`任務背景：針對 ${WARD}（${WARD_FULL}）的${session.audienceText}進行實務教育訓練，提升照護品質並落實感染管制。`);
    L.push('任務目的：將生硬的醫療衛教單張轉化為生動、圖文並茂的教學簡報，方便第一線照護人員快速吸收。');
    L.push('');
    L.push('具體信息（Specific Information）');
    L.push('任務需求：');
    L.push(`根據「${session.sourceTitle || t.sourceHint}」${session.sourcePages ? `（來源第 ${session.sourcePages} 頁）` : ''}製作 ${session.slideCount} 頁左右的簡報內容。`);
    L.push('內容以我上傳的來源文件為唯一依據；下方各頁需求是建議架構，如與來源文件不同，一律以來源文件為準。');
    if (session.sourceNotes) L.push(`本次文案重點與特別要求：${session.sourceNotes}`);
    L.push(`課程內容須注重實務操作，語氣親切且易懂（${session.lang.note}）。`);
    L.push(`學員為${session.audienceText}，${session.level === 'basic' ? '華語程度為基礎，請用短句、常用字，一句只講一件事' : '具日常華語會話能力，可使用一般照護用語'}。`);
    L.push(`機構名稱一律使用「${HOSPITAL} ${WARD} 病房」。`);
    L.push('已知條件：');
    L.push(`簡報人：病房助理員 ${session.presenter.display}。`);
    L.push(`護理指導員：護理師${session.instructor.name}。`);
    if (session.date) L.push(`授課日期：${session.date}。`);
    L.push('字體規範：標題 45pt、次標題 40pt、小標題 32pt。');
    L.push(`視覺風格：${session.style.prompt}`);
    L.push('限制與注意事項：');
    L.push(`簡報總數控制在 ${session.slideCount} 張左右（不少於 10 張）。`);
    L.push(`必須包含「${topic}目的與步驟」、「使用目的與注意事項」關鍵實務點。`);
    L.push('內容須落實感染管制與照護品質。');
    L.push('最後須有 Q&A 五題，作為訓練內容的驗收。');
    L.push('');
    L.push('目標（Intent）');
    L.push('請協助我完成：');
    L.push('規劃每一頁簡報的文字標題與內容（符合字體大小規範）。');
    if (session.withImagePrompts) L.push('提供每一頁簡報的圖像生成描述語（Prompt），延續上述視覺風格。');
    L.push('將複雜的醫療步驟簡化為易於執行的實務清單。');
    L.push('');
    L.push('格式要求（Response Format）');
    L.push('以 簡報大綱（Slide-by-Slide Content） 的形式輸出。');
    L.push('');
    L.push('提示詞執行開始（第一頁示例）');
    L.push('第一頁：封面');
    L.push(`[標題 45pt] ${session.coverTitle}`);
    L.push(`[次標題 40pt] ${session.subtitle}`);
    L.push(`[小標題 32pt] ${session.coverByline}`);
    L.push('圖片提示語（DALL-E/Midjourney）：');
    L.push(session.style.prompt);
    L.push('');
    if (!session.withImagePrompts) {
      L.push('【內容限定規則】 本階段僅生成簡報大綱與文字內容。禁止提供或加入任何視覺風格、配色、背景、圖片、插圖、圖示、圖表外觀、人物、角色、Logo、版面配置、排版或畫面描述建議。所有視覺規範將於後續階段另外設定。');
      L.push('');
    }
    L.push(`【輸出格式要求】 請依據上述設定，直接輸出 ${session.slideCount} 張投影片的具體大綱，各頁需求如下：`);
    L.push('');
    session.slides.forEach(s => L.push(this.slideLine(s, session.withImagePrompts)));
    L.push('');
    L.push('【課後驗收 Q&A 五題】');
    session.qa.forEach((x, i) => L.push(`Q${i + 1}：${x.q}\nA${i + 1}：${x.a}`));
    return L.join('\n');
  },

  slideLine(s, withImg) {
    const parts = [`[投影片 ${s.no}：${s.label}]`, `• 標題：${s.title}`];
    if (s.subtitle) parts.push(`• 副標題：${s.subtitle}`);
    if (s.points.length) parts.push(`• 核心內容：${s.points.join('；')}`);
    if (s.notes) parts.push(`• 講者備註：${s.notes}`);
    if (withImg && s.imagePrompt) parts.push(`• 圖像描述語：${s.imagePrompt}`);
    return parts.join(' ');
  },

  /** 純文字大綱（郵件內文用） */
  plainOutline(session) {
    const L = [session.coverTitle, session.subtitle, session.coverByline, ''];
    session.slides.forEach(s => {
      L.push(`【投影片 ${s.no}｜${s.label}】${s.title}`);
      s.points.forEach(p => L.push('  • ' + p));
      if (s.notes) L.push('  講者備註：' + s.notes);
      L.push('');
    });
    L.push('【Q&A 五題】');
    session.qa.forEach((x, i) => L.push(`${i + 1}. ${x.q}\n   答：${x.a}`));
    return L.join('\n');
  }
};
