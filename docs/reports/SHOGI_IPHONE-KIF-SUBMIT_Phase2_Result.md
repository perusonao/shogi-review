# SHOGI_IPHONE-KIF-SUBMIT Phase 2 結果

## 結論

採用方式はCloudflare Worker + D1。公開GitHub PagesからHTTPSで依頼を登録し、Windows workerがoutbound pollでclaimする。PCがOFFでもD1へqueuedとして保存でき、WindowsをInternetへ公開しない。

| 候補 | 個人利用の最小構成 | 秘密をPWAへ埋め込まない | PC OFF queue | 今回の判断 |
|---|---|---|---|---|
| Cloudflare Worker + D1 | Worker 1本とD1 1個 | Worker secretのhashで検証 | 対応 | 採用 |
| Supabase | Auth/RLS/API構成が必要 | 対応可能 | 対応 | 今回には構成要素が多い |
| Firebase | Auth/Functions/Firestore構成が必要 | 対応可能 | 対応 | 今回には構成要素が多い |

## 実装

- PWA: KIF貼り付け、128 KiB上限、構文検査、対局preview、送信、状態再取得、再試行、感想戦リンク
- 認証: PWA用とworker用を分離したBearer secret。平文は端末localStorageまたはGit対象外のWindows設定だけに保持し、WorkerにはSHA-256 hashだけを登録
- queue: requestId、fingerprint、createdAt、status、KIF、metadata、gameId、限定したerrorをD1へ保存
- 重複: 既存Python importerと同じcanonical SHA-256 fingerprint。queue中は既存requestId、完了済みは既存gameIdを返す
- worker: claim、合法KIF検査、安全なinbox名、既存importer、水匠5 30,000 nodes、検証、commit/push、完了通知を固定処理。`shell=True`は使用しない
- 自動起動: 手動起動batとWindows Task Scheduler登録bat

## 検証

- Python自動テスト: KIF parser、ひぐれ戦58手/59局面、fingerprint、invalid、oversized、XSS、duplicate、worker validation
- Node自動テスト: browser/backend共通parser、既知fingerprint、invalid/oversized/XSS、status transition
- 実エンジンE2E: YaneuraOu V9.00 NNUE + 水匠5、30,000 nodesで既存ひぐれ戦59局面をdry-run出力し、局面数・設定・出力schemaを検証
- PWA: ローカルとGitHub Pagesで棋譜追加画面および既存感想戦UIを確認
- 既存データ: 現在のcatalog 12局を変更せず保持。Phase 2依頼で回帰対象とされた既存6局を含む

## 外部セットアップ待ち

コードと手順は完成しているが、CloudflareアカウントでのD1作成、secret登録、Worker deployはユーザー操作が必要である。秘密値は本レポートに記載しない。画面単位の手順は `docs/IPHONE_KIF_SUBMIT_SETUP.md` を参照。

実装commit SHAは、このレポートを含むcommitとして最終応答に記載する。
