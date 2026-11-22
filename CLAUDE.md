# CLAUDE.md — 病房助理工作站 ＋ 外傭技術教育簡報產生器

這份文件給 Claude Code（以及接手的人）快速了解專案。請一律用**繁體中文**溝通與撰寫程式註解。

## 一、專案目標

臺北市立聯合醫院忠孝院區 **RCW（呼吸照護病房）** 的病房助理，每個月要替照顧病患的**外傭（印尼、越南、泰國籍）**上一堂技術教育課。
本專案的主角是 `wa-training/`「外傭技術教育簡報產生器」：

> 比喻：它像一位「備課助理」。你告訴它這個月要教什麼、誰來教、學生是誰、依據哪份照護文件，
> 它就幫你排好 10 張以上的投影片大綱、出好 Q&A 五題考卷，並寫好交給 NotebookLM 的指令。

整個 repo 同時也是「病房助理工作站」入口網站（根目錄 `index.html`），外傭簡報產生器是其中第 17 項工具。

- 線上網址：https://achir1015.github.io/ward-assistant-portal/wa-training/
- 工作站首頁：https://achir1015.github.io/ward-assistant-portal/
- 發布方式：GitHub Pages，直接從 `main` 分支根目錄發布，**推上 main 約 1～2 分鐘後上線**

## 二、需求重點（使用者原始需求整理）

1. **平台**：純前端 HTML，手機與平板都要能用（Android、iPhone、iPad、Android 平板）。
2. **教學導覽**：要有語音＋動畫說明（`tutorial.js`，用瀏覽器內建 zh-TW 語音，小護士聚光燈導覽）。
3. **逐步設定完成簡報（7 步精靈）**：
   1. 主題表：選民國年度，**一到十二月全部列出、預設空白**，每月下拉選主題或「自訂主題…」，並下拉選主講病房助理、護理指導員；勾選要製作的月份。
   2. 人員：確認簡報人（病房助理員：員編＋姓名）與護理指導員（護理師：員編＋姓名），名單外可手動輸入。
   3. 學員：國籍（印尼／越南／泰國）與華語程度。
   4. 依據文件：衛教單張名稱、文案重點、PDF 與頁數。
   5. 簡報設定：張數（**不少於 10 張**）、語言、視覺風格。
   6. 預覽修改：三種產生方式 — 內建範本內容／依文案架構（交給 NotebookLM）／AI 讀 PDF（Gemini）；逐頁修改、Q&A 五題可改。
   7. 輸出：Word 三份＋分享（LINE、Gmail）＋ NotebookLM 指令一鍵複製。
4. **內容不能寫死**：同一個主題，每次內容要依照當次上傳的照護 PDF 文案而定。內建範本只是「起點」。
5. **人員名單來自月班表**：從「月班表管理系統」（rcw-month，同一個 Firebase 專案）讀取所有月份，彙整不重複名單。
   - 以「最大公約數」為主：一半以上月份都在班的人列為**常駐人員**排前面；少數月份出現的人放「其他人員」並註明出現月數。
   - 暫時代號（如 `NEW1`）之後有正式員編時，合併成同一人。
   - **只讀取，不修改任何班表資料。**
6. **封面格式（第一頁固定）**：
   - [標題 45pt] 臺北市立聯合醫院忠孝院區 RCW [簡報主題]教學護理實務
   - [次標題 40pt] 提升 RCW 照護品質，落實感染管制
   - [小標題 32pt] 簡報人：病房助理員 [員工編號 員工姓名] ｜ 護理指導員：護理師[員工姓名]
7. **內容限定規則**：大綱階段只產生文字內容，不加入任何視覺、配色、圖片、版面描述（視覺風格只寫進 NotebookLM 指令）。
8. **Q&A 驗收**：最後五題，輸出兩份 Word — ①題目＋空白作答、②完整解答；另有一份簡報大綱 Word。

## 三、程式結構（以領域模型組織）

```
ward-assistant-portal/
├── index.html              工作站首頁（catalog 裡每個 new Tool({...}) 就是一項工具）
├── sw.js                   Service Worker（網路優先＋離線快取，改版時遞增 CACHE 版號）
├── manifest.webmanifest    PWA 設定（可加到手機主畫面）
├── icons/ …                圖示
└── wa-training/            ★ 外傭技術教育簡報產生器
    ├── index.html          畫面與樣式（7 步精靈）
    ├── js/
    │   ├── topics.js       主題範本庫（領域資料）：目的、用物、步驟、注意事項、Q&A、三語關鍵詞
    │   ├── domain.js       領域模型：TrainingSession、Person、Slide、QAItem、YearPlan／MonthPlan、
    │   │                   OutlineBuilder（排課→大綱）、PromptBuilder（翻成 NotebookLM 指令）
    │   ├── docx.js         在瀏覽器用 JSZip 組出 .docx（不需伺服器）
    │   ├── roster.js       從月班表 Firestore（schedules 集合）彙整人員名單（Roster）
    │   ├── ai.js           可選 Gemini：PdfSource（pdf.js 讀指定頁、掃描版轉圖片）＋ GeminiTutor
    │   ├── tutorial.js     Narrator（語音朗讀）＋ GuideTour（聚光燈導覽）
    │   └── app.js          畫面控制：Store（草稿）→ Wizard（步驟）→ 各步驟 render/bind
    └── vendor/             JSZip 3.10.1、pdf.js 3.11.174（放本站，醫院網路擋 CDN 也能用）
```

領域模型的比喻（見 `domain.js` 開頭）：

```
TrainingSession（一堂課）
  ├─ Presenter    講師（病房助理員）
  ├─ Instructor   護理指導員
  ├─ Audience     學員（外傭國籍、語言程度）
  ├─ SourceDoc    依據文件（照護 PDF）
  ├─ VisualStyle  視覺風格（只給 NotebookLM 指令用）
  ├─ Slide[]      投影片大綱
  └─ QAItem[]     Q&A 五題
```

載入順序很重要（`wa-training/index.html` 底部）：
`jszip → pdf.js → firebase(app/auth/firestore compat) → topics → domain → docx → roster → ai → tutorial → app`。
沒有打包工具、沒有模組系統，全部是全域變數，新增檔案時要放對順序。

### 瀏覽器端儲存（localStorage，只存在該裝置）
| 鍵 | 用途 |
|---|---|
| `wa-training.draft.v1` | 整份設定草稿（TrainingSession JSON） |
| `wa-training.roster.v1` | 月班表名單快取 |
| `wa-training.rosterOrg` | 上次選的單位 |
| `wa-training.geminiKey` / `wa-training.geminiModel` | Gemini 金鑰與模型（預設 gemini-2.5-flash） |
| `wa-training.tourSeen` | 是否看過導覽 |

改了資料結構時，記得讓 `TrainingSession.fromJSON` 能相容舊草稿，或把版號 `v1` 往上加。

## 四、如何在本機執行

純靜態網站，不需要安裝套件或編譯。因為用到 Service Worker 與 `fetch`，請用本機伺服器開，不要直接雙擊 html：

```bash
# 在 repo 根目錄
python3 -m http.server 8000
# 瀏覽器打開
#   http://localhost:8000/wa-training/   ← 簡報產生器
#   http://localhost:8000/               ← 工作站首頁
```

手機測試：電腦與手機連同一個 Wi-Fi，用電腦的區網 IP 開（例如 `http://192.168.x.x:8000/wa-training/`）。
注意：月班表登入（Firebase Auth）只允許授權網域，本機可能無法登入，名單功能請在正式網址測試。

## 五、依據的照護 PDF（不放進 repo）

`照顧服務員訓練指引.pdf`（約 97 MB，掃描版）是內容依據的主要來源，**太大，不要 commit 進 repo**（`.gitignore` 已排除 `*.pdf`）。
請另外下載後放在 repo 外或任意位置，使用時在第 4 步「依據文件」選取即可（檔案只在使用者裝置上讀取）：

- 來源：Claude 專案「病房助理技術教育外傭實務訓練」的專案檔案，或向使用者索取
- 線上閱讀版：工作站第 15 項 https://achir1015.github.io/caregiver-training-guide/

## 六、開發守則

- **程式註解、commit 訊息、畫面文字一律繁體中文**；喜歡用比喻說明新概念。
- 以**領域模型**組織程式：新的業務概念先在 `domain.js` 建類別，畫面邏輯放 `app.js`。
- 手機優先：按鈕夠大、不可出現水平捲動、iPhone Safari 與 Android Chrome 都要測。
- 不引入建置工具；第三方函式庫放 `vendor/`，固定版本。
- 範本護理內容與三語關鍵詞是通用版，**正式授課前需護理指導員確認**；不要假裝它是院內正式文件。
- 隱私：病人資料與 PDF 只在裝置端處理；只有使用者自行填入 Gemini 金鑰時，才會把指定頁送到 Gemini。
- 月班表只讀：`roster.js` 不可以寫入 Firestore。
- 改了工作站首頁或快取檔案時，把 `sw.js` 的 `CACHE` 版號加一，手機才會拿到新版。
- 工作站新增工具：在根目錄 `index.html` 的 `catalog` 加一行 `new Tool({...})`，並同步更新根目錄 `README.md` 的工具表。

## 七、待確認事項

- 「AI 讀 PDF」目前只用模擬回應測過，尚未用真實 Gemini 金鑰實測。
- 月班表名單彙整是用模擬班表測過合併與去重複，需用真實帳號在正式網址驗證人數與姓名。
