/* =========================================================
 * roster.js — 從「月班表管理系統」彙整人員名單
 *
 * 比喻：月班表是每個月一本「出勤簿」，這裡把所有出勤簿翻一遍，
 *       抄出一份不重複的「通訊錄」：病房助理一本、護理師一本。
 *
 * 資料來源：rcw-month 使用的同一個 Firebase 專案（Firestore schedules 集合）
 *   - 登入方式與月班表相同：Email＋密碼 → 選單位＋管理者密碼
 *   - 同在 achir1015.github.io 網域，月班表登入過的裝置會自動沿用登入狀態
 *   - 只讀取，不會修改任何班表資料
 * ========================================================= */

const ROSTER_CACHE = 'wa-training.roster.v1';
const ROSTER_ORG = 'wa-training.rosterOrg';

/** 人員名單（值物件） */
class Roster {
  constructor({ assistants = [], nurses = [], orgLabel = '', loadedAt = '' } = {}) {
    this.assistants = assistants.map(p => new Person(p));
    this.nurses = nurses.map(p => new Person(p));
    this.orgLabel = orgLabel;
    this.loadedAt = loadedAt;
  }
  get isEmpty() { return !this.assistants.length && !this.nurses.length; }
  findAssistant(key) { return this.assistants.find(p => Roster.key(p) === key) || null; }
  findNurse(key) { return this.nurses.find(p => Roster.key(p) === key) || null; }
  /** 一個人的識別鍵：有員編用員編，沒有用姓名 */
  static key(p) { return p.empNo || ('name:' + p.name); }

  /**
   * 把多份月班表彙整成不重複名單
   * 同一員編跨月出現只留一筆；姓名以「最新月份」為準（例如改名或更正）
   */
  static fromSchedules(schedules, orgLabel) {
    const sorted = [...schedules].sort((a, b) => (a.westYear - b.westYear) || (a.month - b.month));
    const pools = { assistant: new Map(), nurse: new Map() };
    sorted.forEach(s => {
      const pool = pools[s.category]; if (!pool) return;
      (s.employees || []).forEach(e => {
        const empNo = /^NEW\d+$/i.test(e.empId || '') ? '' : (e.empId || '').trim();   // 月班表給新進人員的暫時代號不當員編
        const name = (e.name || '').trim();
        if (!empNo && !name) return;
        const k = empNo || ('name:' + name);
        // 有員編的人如果先前以「沒員編」身分出現過，合併掉
        if (empNo && pool.has('name:' + name)) pool.delete('name:' + name);
        pool.set(k, { empNo, name });
      });
    });
    const sortFn = (a, b) => (a.empNo || 'ZZZ').localeCompare(b.empNo || 'ZZZ') || a.name.localeCompare(b.name, 'zh-Hant');
    return new Roster({
      assistants: [...pools.assistant.values()].sort(sortFn),
      nurses: [...pools.nurse.values()].sort(sortFn),
      orgLabel, loadedAt: new Date().toISOString()
    });
  }
}

const RosterService = (() => {
  // 與 rcw-month 相同的 Firebase 專案（前端公開設定，權限由登入與安全性規則把關）
  const firebaseConfig = {
    apiKey: 'AIzaSyCDoaGP0aeW7P1nhFas-4T3krVftiroG34',
    authDomain: 'monthlyschedule-a5dea.firebaseapp.com',
    projectId: 'monthlyschedule-a5dea',
    storageBucket: 'monthlyschedule-a5dea.firebasestorage.app',
    messagingSenderId: '204422687469',
    appId: '1:204422687469:web:bfa6d1672fddbd576ffae4'
  };
  const LEGACY_ORG_ID = 'default';
  let app = null, auth = null, db = null, readyUser = null;

  function init() {
    if (app) return true;
    if (!window.firebase) return false;
    app = firebase.initializeApp(firebaseConfig);
    auth = firebase.auth(); db = firebase.firestore();
    return true;
  }

  /** 等待登入狀態確認（沿用月班表在同網域留下的登入） */
  function currentUser() {
    if (!init()) return Promise.resolve(null);
    if (readyUser !== null) return Promise.resolve(auth.currentUser);
    return new Promise(res => {
      const off = auth.onAuthStateChanged(u => { readyUser = !!u; off(); res(u); });
    });
  }

  async function signIn(email, password) {
    if (!init()) throw new Error('月班表連線元件載入失敗，請確認網路。');
    try { const r = await auth.signInWithEmailAndPassword(email, password); readyUser = true; return r.user; }
    catch (err) {
      const code = err.code || '';
      if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) throw new Error('帳號或密碼錯誤（請用月班表的登入帳號）。');
      if (/too-many-requests/.test(code)) throw new Error('嘗試太多次，請稍後再試。');
      throw new Error('登入失敗：' + (err.message || code));
    }
  }
  async function signOut() { if (init()) await auth.signOut(); readyUser = false; }

  async function hashPassword(pw) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('rcw-org:' + pw));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /** 讀取單位清單（公司／部門） */
  async function loadOrgs() {
    const snap = await db.collection('orgs').get();
    const orgs = [];
    snap.forEach(d => { const x = d.data(); orgs.push({ id: d.id, company: x.company, department: x.department, passwordHash: x.passwordHash }); });
    if (!orgs.some(o => o.id === LEGACY_ORG_ID)) orgs.unshift({ id: LEGACY_ORG_ID, company: '臺北市立聯合醫院忠孝院區', department: '呼吸照護病房', passwordHash: '' });
    return orgs;
  }

  /** 驗證單位管理者密碼（與月班表相同規則）；驗證過的單位會記住，下次免輸入 */
  async function verifyOrg(org, pw) {
    if (rememberedOrg() === org.id) return true;
    if (!org.passwordHash) return true;
    if (await hashPassword(pw || '') !== org.passwordHash) throw new Error('管理者密碼錯誤。');
    try { localStorage.setItem(ROSTER_ORG, org.id); } catch {}
    return true;
  }
  function rememberedOrg() { try { return localStorage.getItem(ROSTER_ORG) || ''; } catch { return ''; } }

  /** 讀取該單位全部月班表 → 彙整不重複名單 */
  async function loadRoster(org) {
    const snap = await db.collection('schedules').get();
    const list = [];
    snap.forEach(d => {
      const x = d.data();
      const mine = org.id === LEGACY_ORG_ID ? !x.orgId : x.orgId === org.id;
      if (mine && x.category && Array.isArray(x.employees)) list.push(x);
    });
    const roster = Roster.fromSchedules(list, `${org.company}／${org.department}`);
    roster.months = list.length;
    try { localStorage.setItem(ROSTER_CACHE, JSON.stringify(roster)); } catch {}
    return roster;
  }

  /** 上次載入的名單（離線或未登入時仍可選人） */
  function cached() {
    try { const o = JSON.parse(localStorage.getItem(ROSTER_CACHE)); return o ? new Roster(o) : new Roster(); } catch { return new Roster(); }
  }

  return { currentUser, signIn, signOut, loadOrgs, verifyOrg, rememberedOrg, loadRoster, cached, get available() { return !!window.firebase; } };
})();
