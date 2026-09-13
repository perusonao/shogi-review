# 将棋コーチング開発ロードマップ

SSOT: `docs/SHOGI_COACHING_PRODUCT_SSOT.md`
更新日: 2026-09-13

| Priority | Phase | Goal | Environment | Status |
|---|---|---|---|---|
| P0 | 0 | 目的・成功条件・優先順位のSSOT化 | ☁️ | DONE |
| P0 | 1 | 原棋譜を解析前に永続保存し、失敗しても再解析可能 | 🔀 | NEXT |
| P0 | 2 | 保存→解析→公開パイプライン安定化 | 🖥️/🔀 | IN PROGRESS (#5) |
| P1 | 3 | 1局レビュー：実戦/推奨/理由/次回確認 | ☁️ | PARTIAL |
| P1 | 4 | 現在の課題 最大3件 | ☁️ | PLANNED |
| P1 | 5 | 課題 ○/×/－ 自動判定 | ☁️ | PLANNED |
| P1 | 6 | 最近10/30局の横断分析 | ☁️ | PLANNED |
| P2 | 7 | 成長ダッシュボード | ☁️ | PLANNED |
| P2 | 8 | 棋力推定（教師データgate後） | 🔀 | DATA COLLECTION (#3) |
| P3 | 9 | PCレス/クラウド解析検討 | ☁️ | DEFERRED |

## 現在の最優先
Phase 1とPhase 2を完成させ、棋譜を「解析成功しないと残らないデータ」から「まず保存され、解析は後から何度でも実行できるデータ」に変える。

## 既存Issueの扱い
- #5: 継続。Phase 2 blocker。Windows worker実機原因修正/E2E。
- #3: 継続するがP2。棋力推定教師データ収集として保持し、Phase 1/2より優先しない。
- #4/#8: Reason Evidenceの完了資産。Phase 3で再利用し、追加精度追求は保留。
- #10〜#13等の個別棋譜: 長期分析の入力データとして価値がある。解析完了後、将来の課題/横断分析に利用する。

## 次のIssue
Phase 1「Durable KIF First」を実装する。

主な受入条件:
1. KIF貼付直後に永続保存される。
2. 保存成功と解析成功を別statusで管理する。
3. worker/engine/publish失敗でも原KIFが残る。
4. failed jobを保存済みKIFから再解析できる。
5. retryでgame/datasetが重複しない。
6. PWAで `保存済み / 解析待ち / 解析中 / 解析失敗 / 解析完了` が判別できる。
7. secretをclient/GitHubへ露出しない。
