# Current Focus

更新日: 2026-09-13

## NOW
P0 Phase 1 + Phase 2

**棋譜を絶対に失わず、保存済み棋譜を確実に解析できる状態を作る。**

1. Phase 1 Durable KIF First を実装する。
2. Issue #5 Windows worker障害を解消し実機E2Eを通す。
3. その後に1局レビュー/課題システムへ進む。

## NOT NOW
- Cloud解析への移行
- 水匠nodes増加
- production棋力表示
- 既存局大量再解析

## Product Loop
`保存 → 分析 → 課題発見 → 課題設定 → 次局 → ○/×/－ → 成長確認`

詳細は `docs/SHOGI_COACHING_PRODUCT_SSOT.md` と `docs/SHOGI_COACHING_ROADMAP.md` を参照する。
