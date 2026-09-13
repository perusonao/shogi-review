# Phase 1 Durable KIF First

目的: KIFを最初に永続保存し、解析失敗後も同じ原本から再解析できるようにする。

状態: 保存済み / 解析待ち / 解析中 / 解析失敗（原棋譜保存済み） / 解析完了。

要件:
- 解析前に原KIFを永続保存する。
- fingerprint/SHA-256等で重複を防ぐ。
- retryは同じ原本を参照する。
- worker/engine/JSON/push/Pages失敗で原本を削除しない。
- 解析失敗と保存失敗を区別する。
- clientへsecretを置かない。
- 既存games/analysisを一括書換えしない。

Windows worker実機・YaneuraOu/水匠5・publishの正常化はPhase 2 / Issue #5で扱う。
