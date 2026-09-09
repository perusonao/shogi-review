# shogi-review

水匠5解析結果をiPhoneで確認する将棋感想戦PWA。

## Repository policy

```text
analysis/   解析済み評価値・課題局面JSON
games/      元棋譜（入手済みのKIF）
engine/     YaneuraOu + 水匠5のセットアップ手順
index.html  iPhone向け感想戦UI
```

エンジン本体や巨大な `nn.bin` はGit管理せず、解析結果を永続化する。

解析フロー:

`KIF → YaneuraOu + 水匠5 → analysis/*.json → PWA表示`

これにより、別セッションやエンジンのない環境でも過去の解析結果を再利用できる。

現在の「あかね戦」は `analysis/akane_20260910.json` に既存の30k実測ポイントと検証済み課題局面を保存済み。全143手の実測評価値はエンジン環境を再構築後に追記する。
