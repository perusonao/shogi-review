# 新しい対局を追加する手順

このリポジトリでは、対局ごとのデータをカタログから参照する。

## 1. 対局ID

`YYYYMMDD_opponent` を基本形にする。

例: `20260910_akane`

同日に同じ相手と複数局ある場合は末尾に `_01`, `_02` を付ける。

## 2. 保存するファイル

```text
games/<game-id>.kif              元棋譜（取得できる場合）
games/<game-id>.json             PWA用の局面・課題データ
analysis/<game-id>.json          エンジン解析結果
games/index.json                 対局カタログ
```

元棋譜を取得できない場合は推測でKIFを再生成しない。

## 3. game JSON

既存 `data.json` と同じ形式を使用する。

必須項目:
- `game.title`
- `game.result`
- `game.moves`
- `game.date`
- `game.side`
- `positions[]`
- `issues[]`

## 4. analysis JSON

最低限:

```json
{
  "schemaVersion": 1,
  "gameId": "20260910_akane",
  "engine": {
    "name": "YaneuraOu + Suisho5",
    "nodesPerPosition": 30000,
    "scorePerspective": "sente"
  },
  "evaluations": [
    {"ply": 0, "cp": 0}
  ]
}
```

エンジン未解析の値を推測で埋めない。実測していない手は未保存とする。

## 5. カタログ登録

`games/index.json` の `games` に追加する。

```json
{
  "id": "20260910_akane",
  "date": "2026/09/10",
  "title": "相手 vs ぺるそなお",
  "side": "後手",
  "result": "後手・ぺるそなお 敗戦",
  "moves": 143,
  "gameData": "games/20260910_akane.json",
  "analysisData": "analysis/20260910_akane.json",
  "analyzed": true
}
```

PWAは `games/index.json` を読み、棋譜タブへ自動的に一覧表示する。

## 6. 解析設定

標準設定:
- YaneuraOu + 水匠5
- `USI_OwnBook=false`
- 30,000 nodes / position
- 水匠5推奨設定に合わせられる環境では `FV_SCALE=24`
- 評価値は先手視点で保存

解析条件が異なる場合は `analysis/*.json` の `engine` に必ず記録する。

## 原則

GitをSSOTとする。KIF・PWA用局面データ・解析済み評価値・課題局面を永続化し、`nn.bin` とコンパイル済みエンジン本体はGitへ入れない。
