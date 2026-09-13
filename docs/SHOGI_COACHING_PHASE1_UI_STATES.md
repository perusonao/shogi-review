# Phase 1 UI States

The PWA should communicate two facts independently: source preservation and analysis progress.

Examples:
- 保存済み・解析待ち
- 保存済み・解析中
- 保存済み・解析失敗（再解析可）
- 保存済み・解析完了

If source persistence itself fails, do not show 保存済み.
