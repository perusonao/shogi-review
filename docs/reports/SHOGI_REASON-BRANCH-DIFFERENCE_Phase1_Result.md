# SHOGI Reason — Branch Difference Phase 1 Result

## 結論

- 実装基準は `origin/main` / `HEAD` ともに `afff938c8a63e603a1a2b2e6844c76e85bfb6fe9`。
- 保存済みJSONだけを入力にする純粋関数 `analyzeBranchDifference` を実装した。水匠5再解析と既存analysis JSON更新は0件。
- 両branchをSFENから合法手として順次適用し、mate、check、capture/captured piece、material balance、promotion、drop、major piece loss、king capture endpoint、legal continuationを抽出する。
- イベントは同じply同士で比較せず、type・actor・駒種・初期局面から継承した駒IDで整列し、`actualOnly` / `shared` / `recommendedOnly` に分ける。同じ駒が取られる最初のplyは `captureTimingByPiece` に保存する。
- 優先順位は mate → major piece loss → material swing → check → capture → promotion → drop。confidenceは HIGH / MEDIUM / LOW。
- Reason Phase 2文は `candidate` にだけ格納するshadow実装。production UIは既存Reasonのままで、新Reasonと「次に確認すること」は表示しない。

## 実装した内部schema

```text
BranchDifferenceResult
  version, mover
  branches.actual/recommended
    events[]
    features[]
    score
    finalMaterialBalance
    complete
    legalContinuation
  actualOnly[]
  shared[{ key, actual, recommended }]
  recommendedOnly[]
  prioritized[]
  captureTimingByPiece{ pieceId: { actual, recommended } }
  candidate{ blocks[], next, unresolved }
```

`material-balance` は P=1/L=3/N=3/S=5/G=6/B=8/R=10 の内部値で差を検出するだけで、Reasonの真実や因果として扱わない。候補文にも「駒価値換算」と明記する。

## Event alignment / confidence

- captureは初期盤面の駒IDをbranch間で維持し、別の同種駒をsharedにしない。
- checkはactor（指し手側/相手側）単位、drop/promotionはactorと駒種単位で出現順に整列する。
- HIGH: mate差、実戦枝だけの飛角損、同手数終端の明確なmaterial swing、king capture/illegal endpoint。
- MEDIUM: check sequence差、2ply以内のcapture差。
- LOW: drop単独、promotion単独、3ply以降の単発capture。
- 20局110problem全差イベント集計は HIGH 69 / MEDIUM 242 / LOW 885。これは文章採用数ではなく内部event occurrence数。

## D64再分類

前回監査表のCandidate D 64件をそのまま対象集合として復元した。両枝に2ply以上の保存PVがない局面は、片枝だけの特徴で理由を補完せずCとした。

| 分類 | 件数 | 判定 |
|---|---:|---|
| A | 1 | Branch Differenceだけで具体的な両枝比較が可能 |
| B | 4 | 差イベントは増えたがQ1/Q2の一方、または因果が未解決 |
| C | 59 | actual/recommended比較に必要な保存PVが不足。追加探索対象 |

Aは「夢への旅路 vs ぺるそなお」84手目。actualの4ply目に初期局面の飛車が取られ、recommendedでは同じ飛車が同範囲で取られないことをHIGHで検出した。Bは同局94/130手目、NAGATA2532 46/52手目。

## 必須fixture

### ryunenbb 80手目

- 実戦 `△5二金`、推奨 `△7五桂打`。
- actual `mate -5`、recommended `cp -7578`。
- `actual-only: mate(HIGH)` を最優先で検出。
- candidate: 「△5二金の読み筋では詰み評価になります。」「△7五桂打の読み筋では、同じ詰み評価にはなっていません。」
- `△7五桂打`自体が良い理由は保存差分だけでは説明できず、`unresolved=true`。

### ぺるそなお vs しゅえい

| 手数 | 実戦 / 推奨 | Branch Differenceで安全に言える範囲 | 判定 |
|---:|---|---|---|
| 77 | ▲5九歩打 / ▲8三歩打 | recommended-onlyに初手王手(MEDIUM)。dropはshared。 | Q2のみ部分改善 |
| 79 | ▲5六銀 / ▲6六角 | actual-onlyは実戦初手の歩取り等、sharedなし、recommended-onlyは2ply目の角損(HIGH)。推奨枝が角を取られる事実は優位理由にならない。 | Q1/Q2とも未解決 |
| 159 | ▲同と / ▲7二金打 | actual-only mate(HIGH)。recommendedは同じmate評価ではない。 | mate差のみ説明可能、推奨手自体の理由は未解決 |

79手目の分類概要:

- actual-only: 1ply目の歩取り(MEDIUM)、5/8/13ply目の王手差(MEDIUM)、drop/capture/promotionのLOW群。
- shared: なし。
- recommended-only: 2ply目に角を取られるcapture(MEDIUM)とmajor-piece-loss(HIGH)。

よってBranch Differenceだけでは「なぜ▲5六銀が悪い」「なぜ▲6六角が良い」のどちらも説明しない。

## UI

- 盤面マーカーは赤/青の枠と矢印を維持し、`実` / `推` を実際の駒文字へ変更。駒打ちも打つ駒を表示。
- 大型駒カードを廃止し、`実戦　棋譜表記` / `推奨　棋譜表記` のコンパクト2行へ変更。既存formatter由来の成/不成/打を保持。
- `指す直前` を廃止し、課題局面では `79手目` 形式を表示。
- 390×844と375×844はbottom navigationを含む初期画面を回帰対象とした。

## 追加Reason探索schema設計（未実装）

```json
{
  "schemaVersion": 1,
  "requestId": "gameId:ply:reason-branch-v1",
  "gameId": "...",
  "ply": 79,
  "problemPosition": { "sfen": "...", "sideToMove": "b" },
  "branches": {
    "actual": { "fixedMove": "6e5f", "nodes": 60000 },
    "recommended": { "fixedMove": "7e6f", "nodes": 60000 }
  },
  "engine": { "name": "水匠5", "conditionsVersion": "current" }
}
```

```json
{
  "schemaVersion": 1,
  "requestId": "...",
  "branches": {
    "actual": { "fixedMove": "6e5f", "nodes": 60000, "pv": [], "score": { "type": "cp", "value": 0 }, "mate": null, "features": {} },
    "recommended": { "fixedMove": "7e6f", "nodes": 60000, "pv": [], "score": { "type": "cp", "value": 0 }, "mate": null, "features": {} }
  },
  "branchDifference": {}
}
```

Windows worker統合案は既存queue itemに `jobType: reason-branch-v1` を追加し、現在の解析条件とnodesをそのまま使ってactualMove/bestMoveを各1本fixed searchする。出力は既存analysis JSONを上書きせず、別artifactへ原子的に保存する。59件を候補queue化する前にschema validation、requestId冪等性、fixedMove一致、PV初手一致、score perspectiveを検証する。今回は設計のみで、worker・探索条件・queueは変更していない。

## 検証

- Branch Differenceテスト: branch適用、capture、major capture、mate/check差、promotion/drop、material、shared/actual-only/recommended-only、confidence、旧JSON、短PV、PVなし、先後、必須fixture。
- B-strictはselectionロジック・analysis JSONを変更していない状態で回帰。
- Node/Python/Cloudflare、`git diff --check`、iPhone viewport、Pages deploy後確認を実施対象とした。
