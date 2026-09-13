# 将棋コーチング開発 Issue Template

## 実行情報
- 優先度:
- Phase:
- 推奨AI: Codex / GPT-5.6 Sol / High
- 実行環境: ☁️ Cloud可 / 🖥️ PC必須 / 🔀 Hybrid
- 状態: READY

## 中心ループへの寄与
この変更は `保存 → 分析 → 課題発見 → 課題設定 → 次局 → ○/×/－ → 成長確認` のどこを改善するか:

## 目的

## 実装範囲

## 禁止
- secret/token/認証情報をIssue・commit・clientへ記録しない
- SSOTと無関係なscope拡大をしない
- 評価値精度だけを目的とする変更を混ぜない

## 受入条件

## 必須テスト
- 関連unit/integration tests
- regression tests
- `git diff --check`

## 結果報告
完了・停止・BLOCKEDを問わずIssueへコメントする。
- 基準main
- commit / PR
- 実装結果
- tests
- 受入条件
- secret exposure: NONE
- 最終判定: DONE / REVIEW_REQUIRED / WAITING_FOR_PC / BLOCKED
- 次Phase

Issueコメントを完了判定のSSOTとする。
