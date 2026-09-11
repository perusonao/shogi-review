# shogi-review

水匠5解析結果をiPhoneで確認する将棋感想戦PWA。

## Repository policy

```text
analysis/          解析済み評価値・課題局面JSON
games/             元棋譜・PWA用対局データ・対局カタログ
games/index.json   PWAが読み込む対局一覧
engine/            YaneuraOu + 水匠5のセットアップ手順
docs/              運用手順
index.html         iPhone向け感想戦UI
```

エンジン本体や巨大な `nn.bin` はGit管理せず、解析結果を永続化する。

## 解析フロー

`KIF → YaneuraOu + 水匠5 → game JSON + analysis JSON → games/index.json → PWA表示`

PWAは `games/index.json` を起点に対局を読み込む。新しい対局を追加すると棋譜タブの履歴として蓄積できる。

詳細な追加手順は `docs/ADDING_GAMES.md` をSSOTとする。

## iPhoneから解析を依頼する

Phase 2では、PWAの「棋譜を追加」からKIFを貼り付けて解析queueへ送信できる。Windows workerはCloudflareへoutbound pollし、PC起動中に既存の水匠5解析・検証・公開フローを実行する。PCがOFFでも依頼はD1に保持される。

初回だけCloudflare Worker + D1と個人用secretを設定する。手順は `docs/IPHONE_KIF_SUBMIT_SETUP.md` を参照。

## 従来の使い方（Windows）

1. 将棋ウォーズ公式画面から自分の対局をKIFで保存し、`games/inbox/`へ入れる。
2. `analyze-new-games.bat`をダブルクリックする。
3. GitHub公開の確認に`y`（ローカル確認だけならEnter）を入力し、完了表示を待つ。
4. 数分後、iPhoneでPWAを開き直す。

解析済み棋譜は再解析・重複登録しない。エンジン、`nn.bin`、一時ファイルはGitへ追加しない。

## 現在のデータ

「あかね戦」は `analysis/akane_20260910.json` に既存の30k実測ポイントと検証済み課題局面を保存済み。全143手の実測評価値はエンジン環境を再構築後に追記する。

これにより、別セッションやエンジンのない環境でも保存済みの過去解析結果を再利用できる。
