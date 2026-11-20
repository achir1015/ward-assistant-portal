/* =========================================================
 * tutorial.js — 語音動畫教學導覽
 * Narrator：瀏覽器內建語音朗讀（zh-TW），不用網路、不用金鑰
 * GuideTour：聚光燈＋小護士說明員，逐步指著畫面講解
 * 比喻：像帶新同事第一次巡病房，一邊指一邊說。
 * ========================================================= */

const Narrator = {
  muted: false,
  voice: null,
  rate: 0.95,
  get supported() { return 'speechSynthesis' in window; },
  pickVoice() {
    if (!this.supported) return null;
    const vs = speechSynthesis.getVoices();
    this.voice = vs.find(v => /zh[-_]TW/i.test(v.lang)) || vs.find(v => /zh[-_]HK/i.test(v.lang)) || vs.find(v => /^zh/i.test(v.lang)) || null;
    return this.voice;
  },
  /** 朗讀；回傳 Promise，唸完才 resolve（沒有語音時依字數估算時間） */
  speak(text, { onStart, onEnd } = {}) {
    this.stop();
    return new Promise(resolve => {
      const t0 = Date.now();
      const minMs = Math.min(9000, 1200 + text.length * 120);
      const finish = () => { onEnd && onEnd(); resolve(); };
      if (this.muted || !this.supported) {
        onStart && onStart();
        this._timer = setTimeout(finish, Math.min(9000, 1200 + text.length * 120));
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-TW'; u.rate = this.rate;
      if (this.voice || this.pickVoice()) u.voice = this.voice;
      u.onstart = () => onStart && onStart();
      // 語音太快結束（例如裝置沒有中文語音）時，至少停留估算的閱讀時間
      const done = () => { const left = minMs * 0.6 - (Date.now() - t0); left > 0 ? (this._timer = setTimeout(finish, left)) : finish(); };
      u.onend = done; u.onerror = done;
      speechSynthesis.speak(u);
      // iOS 有時不觸發 onstart
      setTimeout(() => onStart && onStart(), 300);
    });
  },
  stop() {
    clearTimeout(this._timer);
    if (this.supported) speechSynthesis.cancel();
  }
};
if (Narrator.supported) speechSynthesis.onvoiceschanged = () => Narrator.pickVoice();

class GuideTour {
  /** steps: [{ target: CSS 選擇器 | null, text, before?: () => void }] */
  constructor(steps, { onClose } = {}) {
    this.steps = steps; this.i = 0; this.onClose = onClose; this.playing = true;
    this.root = document.getElementById('tour');
    this.spot = this.root.querySelector('.tour-spot');
    this.card = this.root.querySelector('.tour-card');
    this.text = this.root.querySelector('.tour-text');
    this.count = this.root.querySelector('.tour-count');
    this.mascot = this.root.querySelector('.tour-mascot');
    this.btnPrev = this.root.querySelector('[data-tour="prev"]');
    this.btnNext = this.root.querySelector('[data-tour="next"]');
    this.btnPlay = this.root.querySelector('[data-tour="play"]');
    this.btnMute = this.root.querySelector('[data-tour="mute"]');
    this.btnClose = this.root.querySelector('[data-tour="close"]');
    this._bind();
  }
  _bind() {
    this.h = {
      prev: () => this.go(this.i - 1),
      next: () => this.i < this.steps.length - 1 ? this.go(this.i + 1) : this.close(),
      play: () => { this.playing = !this.playing; this._syncButtons(); if (this.playing) this.go(this.i); else { Narrator.stop(); this.mascot.classList.remove('talking'); } },
      mute: () => { Narrator.muted = !Narrator.muted; this._syncButtons(); if (this.playing) this.go(this.i); },
      close: () => this.close(),
      resize: () => this._place(),
      key: e => { if (e.key === 'Escape') this.close(); if (e.key === 'ArrowRight') this.h.next(); if (e.key === 'ArrowLeft') this.h.prev(); }
    };
    this.btnPrev.onclick = this.h.prev; this.btnNext.onclick = this.h.next;
    this.btnPlay.onclick = this.h.play; this.btnMute.onclick = this.h.mute; this.btnClose.onclick = this.h.close;
    window.addEventListener('resize', this.h.resize);
    document.addEventListener('keydown', this.h.key);
  }
  _syncButtons() {
    this.btnPlay.textContent = this.playing ? '暫停' : '播放';
    this.btnMute.textContent = Narrator.muted ? '開啟聲音' : '靜音';
    this.btnPrev.disabled = this.i === 0;
    this.btnNext.textContent = this.i === this.steps.length - 1 ? '完成' : '下一步';
  }
  start() { this.root.hidden = false; document.body.classList.add('touring'); this.go(0); }
  async go(i) {
    if (i < 0 || i >= this.steps.length) return;
    this.i = i;
    const step = this.steps[i];
    step.before && step.before();
    this.count.textContent = `${i + 1} / ${this.steps.length}`;
    this.text.textContent = step.text;
    this._syncButtons();
    this.card.classList.remove('pop'); void this.card.offsetWidth; this.card.classList.add('pop');
    // 等畫面切換完再定位
    await new Promise(r => setTimeout(r, 60));
    this.target = step.target ? document.querySelector(step.target) : null;
    if (this.target) this.target.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setTimeout(() => this._place(), 320);
    if (!this.playing) return;
    const my = i;
    await Narrator.speak(step.text, {
      onStart: () => this.mascot.classList.add('talking'),
      onEnd: () => this.mascot.classList.remove('talking')
    });
    // 自動播放：唸完自動下一步
    if (this.playing && this.i === my && !this.root.hidden && my < this.steps.length - 1) {
      setTimeout(() => { if (this.playing && this.i === my) this.go(my + 1); }, 700);
    }
  }
  _place() {
    if (this.root.hidden) return;
    const pad = 8;
    if (this.target && this.target.offsetParent !== null) {
      const r = this.target.getBoundingClientRect();
      Object.assign(this.spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px', opacity: 1 });
      // 說明卡放在目標的上方或下方（空間大的那一邊）
      const below = r.top < window.innerHeight / 2;
      this.card.dataset.pos = below ? 'bottom' : 'top';
    } else {
      Object.assign(this.spot.style, { left: '50%', top: '50%', width: '0px', height: '0px', opacity: 1 });
      this.card.dataset.pos = 'center';
    }
  }
  close() {
    Narrator.stop();
    this.root.hidden = true;
    document.body.classList.remove('touring');
    window.removeEventListener('resize', this.h.resize);
    document.removeEventListener('keydown', this.h.key);
    this.onClose && this.onClose();
  }
}
