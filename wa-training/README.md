# 外傭技術教育簡報產生器

網址：https://achir1015.github.io/ward-assistant-portal/wa-training/

臺北市立聯合醫院忠孝院區 RCW 病房助理技術教育（外傭實務訓練）用。手機、平板、電腦都能用。

## 流程（7 步）
1. 主題：月份主題表 9 個主題（可自訂）
2. 人員：簡報人員工編號／姓名、護理指導員
3. 學員：印尼／越南／泰國、華語程度
4. 依據文件：衛教單張名稱、文案重點、PDF 與頁數
5. 簡報設定：張數（≥10）、語言、視覺風格
6. 預覽修改：內建範本／依文案架構／AI 讀 PDF，逐頁修改、Q&A 五題
7. 輸出：Word 三份（Q&A 作答卷、Q&A 完整解答、簡報大綱）、分享、郵件、NotebookLM 指令

## 程式結構（領域模型）
| 檔案 | 內容 |
|---|---|
| `js/topics.js` | 月份主題範本（目的、用物、步驟、注意事項、Q&A、三語關鍵詞） |
| `js/domain.js` | `TrainingSession`、`Slide`、`QAItem`、`OutlineBuilder`、`PromptBuilder` |
| `js/docx.js` | 在瀏覽器產生 .docx（JSZip） |
| `js/ai.js` | 可選 Gemini：pdf.js 讀指定頁（掃描版轉圖片）→ 產生大綱與 Q&A |
| `js/tutorial.js` | 語音朗讀（zh-TW）＋小護士聚光燈導覽 |
| `js/app.js` | 畫面控制與草稿自動儲存 |
| `vendor/` | JSZip 3.10.1、pdf.js 3.11.174（放本站，醫院網路擋 CDN 也能用） |

範本內容為通用護理實務，正式授課前請以院內文件與護理指導員確認。
