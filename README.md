# 病房助理工作站 https://achir1015.github.io/ward-assistant-portal/
<img width="1857" height="938" alt="image" src="https://github.com/user-attachments/assets/3e5388b3-be28-471b-bd85-0db95d1f43b7" />

整合病房助理日常會用到的 13 項線上工具（含站內播放的 AI 創作歌曲），一個入口全部打開。手機、電腦都能用，免登入。

**網址：** https://achir1015.github.io/ward-assistant-portal/

## 收錄工具

| 編號 | 工具 | 類別 |
|---|---|---|
| 01 | [專案進度時間軸](https://achir1015.github.io/project-timeline/) | 排班與行政 |
| 02 | [月班表管理系統](https://achir1015.github.io/rcw-month/) | 排班與行政 |
| 03 | [A13 輸入資料](https://achir1015.github.io/A13input/) | 排班與行政 |
| 04 | [雲端硬碟電子書](https://achir1015.github.io/my-library/) | 考照與學習 |
| 05 | [QR Code 產生器](https://achir1015.github.io/QR-Code/) | 實用小工具 |
| 06 | [台灣地址填寫工具](https://achir1015.github.io/taiwan-address-tool/) | 實用小工具 |
| 07 | [照服員單一級學科測驗](https://achir1015.github.io/quiz/) | 考照與學習 |
| 08 | [GLB 立體檢視器](https://achir1015.github.io/GLB-3D-Viewer/) | 實用小工具 |
| 09 | [YouTube 轉 MP3](https://ipmos.ngrok.app/ytmp3/)（自架 NAS） | 實用小工具 |
| 10 | [照服員術科練習本](https://achir1015.github.io/care-exam-practice/) | 考照與學習 |
| 11 | [GPS 到達測試工具](https://achir1015.github.io/gps-arrival-test/) | 實用小工具 |
| 13 | [居家服務督導員工作手冊](https://achir1015.github.io/home-care-supervisor-manual/) | 考照與學習 |
| 12 | [AI 創作歌曲播放清單](https://www.youtube.com/playlist?list=PLMiXt5EIkXI0)（站內播放） | 我的創作 |

## 功能

- 工具直接在工作站裡開啟，最上方固定「← 回主頁」列（手機返回手勢也可回主頁）
- 依類別分組、關鍵字搜尋（支援注音輸入）
- 收藏「我的常用」、自動記錄「最近使用」與開啟次數（存在各自瀏覽器）
- 自動顯示目前班別（白班 / 小夜 / 大夜）與民國日期
- 淺色 / 深色模式

## 加到手機主畫面

- **iPhone（Safari）**：打開網址 → 下方「分享」按鈕 → 「加入主畫面」
- **Android（Chrome）**：打開網址 → 右上角「⋮」 → 「加到主畫面」或「安裝應用程式」

加入後會出現綠底白十字的「病房助理」圖示，點開就像 App 一樣全螢幕使用。

## 新增工具

打開 `index.html`，在 `catalog` 裡複製一行 `new Tool({...})`，修改編號、名稱、說明、網址與類別即可。
