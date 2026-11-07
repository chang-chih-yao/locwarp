# LocWarp 專案重點

## 工作原則

- **Surface Conflicts**：兩個既有寫法互相矛盾時不要混成一份：選較新 / 測試較多的那個、說明理由、把另一個標出來待清理
- **Tests verify intent**：測試要鎖住「為什麼」：邏輯改了測試會紅才算數（mutation check 驗的就是這件事）
- **Fail loud**：跳過了什麼、哪裡不確定就明說；有 skipped 不能說 tests pass
- **Checkpoint after every significant step**：每個重要步驟後回報做了什麼、驗了什麼、還剩什麼
- 回覆使用者一律用繁體中文；派 subagent 時要求它用繁體中文回報；commit 與 tag 訊息照 repo 慣例用繁體中文
- 註解只放在不直覺或有副作用的邏輯；docstring 詳細度隨複雜度，複雜的寫參數與回傳型別。`__init__`（類別 docstring 已說明時）與
  名稱已說明行為的測試函式免寫

## 合併上游

- 合併上游（`upstream` remote）時丟掉 iOS 16 的程式：這個 fork 從 `c20a1b6` 起只支援 iOS 17+，上游還留著 `_connect_legacy`、
  `_ensure_classic_ddi_mounted`、`ddi_mounting` 進度遮罩和 `MIN_VERSION = "16.0"`。`LegacyLocationService` 是 iOS 17+ DVT 失敗時的退路，要留著

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`; GitHub Issues are off on this fork. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
