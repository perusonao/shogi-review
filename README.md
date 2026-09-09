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

## 現在のデータ

「あかね戦」は `analysis/akane_20260910.json` に既存の30k実測ポイントと検証済み課題局面を保存済み。全143手の実測評価値はエンジン環境を再構築後に追記する。

これにより、別セッションやエンジンのない環境でも保存済みの過去解析結果を再利用できる。
