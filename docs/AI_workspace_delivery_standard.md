# TravelKeeper AI Workspace Delivery Standard

## 1. 目的與適用範圍

本文件定義 TravelKeeper AI Workspace 的小步交付、變更邊界與安全檢查標準。適用於 `travelkeeper` repository 中所有後續 Workspace、Intent、Identity、Permission、Flex、Coordinator 與 Route Registry 任務。

本規範專屬於 TravelKeeper AI Workspace，不適用於 Sakura-Welfare-Platform，也不可改寫成 Sakura-Welfare-Platform 專用路徑或流程。

## 2. 每輪任務聲明

每輪任務開始前必須明確列出：

- `EXPECTED_REPOSITORY`
- `EXPECTED_BRANCH`
- `EXPECTED_HEAD`
- `EXPECTED_WORKTREE_CHANGES`
- `PLANNED_MODIFIED_FILES`
- `PLANNED_NEW_FILES`
- focused tests

若工作區已有任務聲明的檔案，不得將其誤判為不明修改。未聲明的任何變更都必須停止並回報。

若任務需要超過 2 個檔案，必須先取得 Tony 明確核准。每輪預估修改與新增檔案合計最多 2 個檔案。

## 3. 20 秒預檢

每輪開始先執行：

```powershell
Get-Location
git rev-parse --show-toplevel
git remote get-url origin
git branch --show-current
git rev-parse HEAD
git status --short
```

接著確認 repository、branch、HEAD、工作區狀態與任務聲明完全一致。必要時只確認任務指定的檔案是否存在，不得自行擴大搜尋範圍。

## 4. 工作區寫入測試

需要確認本機可寫入時，只使用短暫測試檔，並立即刪除：

```powershell
$testFile = ".codex-write-test.tmp"
"ok" | Set-Content $testFile
Remove-Item $testFile
```

測試檔不得留在工作區，也不得納入 commit。

## 5. 工作區變更 allowlist

工作區中的既有變更只有在任務聲明中列出時才可保留並處理。任何未列入 `EXPECTED_WORKTREE_CHANGES`、`PLANNED_MODIFIED_FILES` 或 `PLANNED_NEW_FILES` 的變更都必須停止。

不得以「看起來相關」為理由重做、覆蓋、刪除或擴大既有變更。

## 6. 執行熔斷與指令上限

- 整輪任務超過 5 分鐘立即停止。
- 單一指令上限為 2 分鐘，逾時立即中止。
- 同一錯誤最多嘗試 2 次。
- 不得因排查困難自行擴大任務範圍。

## 7. 測試與檔案範圍

focused tests 優先。只執行任務聲明的測試與必要的 `node --check`、`git diff --check`；不可自行執行大型測試套件或無關的全 repository 掃描。

修改與新增檔案合計最多 2 個。若需要超過 2 個檔案，必須先取得 Tony 明確核准，並更新任務聲明後才能繼續。

## 8. 禁止自行進行的操作

未取得明確核准，不得自行進行：

- migration
- 部署
- 正式資料操作
- Secret 或 Binding 修改
- LINE Developers 設定修改
- 外部 API 寫入
- 擴大重構
- Webhook 接入或修改
- Remote D1 寫入

## 9. 不符時的停止回報格式

發現任何預檢或執行條件不符時，立即停止並回報：

1. `EXPECTED_*` 與實際值的差異。
2. 發現的檔案或錯誤。
3. 已執行的唯讀命令。
4. 是否有任何寫入、stage、commit、push 或部署。
5. 後續需要 Tony 確認的事項。

不得在條件不符時繼續修改或宣稱完成。

## 10. 完成回報格式

完成後回報：

1. 預檢結果。
2. 實際修改與新增檔案。
3. focused tests 與驗證結果。
4. commit hash 與 commit message，如本輪獲准提交。
5. 工作區狀態。
6. 是否 push、部署、操作 migration、正式資料或外部 API。
7. 未完成項目與剩餘風險。

測試未通過、檔案範圍不符或必要證據缺失時，必須明確標記未完成，不得宣稱完成。

## 11. Checkpoint commit 規則

Checkpoint commit 只能包含本輪聲明且驗證通過的檔案。提交前必須確認 staged 檔案清單與 allowlist 完全一致，並執行任務指定的 focused tests 與 `git diff --check`。

除非任務明確要求，checkpoint 完成後不得自行 push、建立 PR、部署、修改 Cloudflare 設定或開始下一輪功能。

## 12. 後續 Workspace 任務前置要求

所有後續 Workspace 任務開始前，必須先讀取本文件並遵守本文件的預檢、allowlist、熔斷、測試與回報規則。若新任務與本規範衝突，必須先停止並要求 Tony 明確核准。
