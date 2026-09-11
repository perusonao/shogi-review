# SHOGI Reason Explanation + One-Screen UX Phase 1 Result

## 結果

成功。`origin/main` / `HEAD` がともに `126b78d7e855686e0d030e6ae81a7290bff26351` であることを確認してから、最新 `origin/main` をSSOTとしてproduction実装した。

B-strict、解析node数、threshold、既存20局の解析JSONには変更を加えていない。水匠5の再解析も実施していない。

## Reason Evidence

`reason-evidence.js` に、SFEN盤面、実戦手、推奨手、typed score、実戦PV、推奨PVだけを入力とする純粋関数を実装した。各枝を独立して最大6手まで盤面へ適用し、次だけを evidence object として扱う。

- typed mate差
- 盤面適用後の王手
- 移動先に存在した駒のcapture
- USIで検証できるpromotion / drop / non-promotion
- 両枝が6手ある場合の駒種別strict material差
- 実戦枝の直後2手以内にある相手のcheck / capture

任意の駒価、棋理、唯一性、因果関係は生成しない。既存JSONを変更せず、画面表示時に計算する。

現行20局・production problem 110件の集計:

| Level | 件数 |
|---|---:|
| Level 1 理由説明可能 | 22 |
| Level 2 部分説明可能 | 81 |
| Level 3 評価差のみ | 7 |

| evidence type | 件数 |
|---|---:|
| mate | 15 |
| check | 18 |
| capture | 94 |
| promotion | 18 |
| drop | 50 |
| material | 7 |
| immediate threat | 25 |

Level分布は実装前監査の `22 / 81 / 7` と一致した。checkは、推奨初手だけが王手の比較に加え、mate差がある実戦枝で相手の王手が複数回確認できる場合を数え、監査候補16件から18件になった。いずれも盤面適用で再現できる事実であり、推測文は追加していない。

## ryunenbb 80手目

- 実戦: `△5二金` / `6b5b`
- 推奨: `△7五桂打` / `N*7e`
- 実戦枝: 2、4、6手目の相手手が王手。6手目は `▲8二龍`。保存scoreは `mate -5`。
- 推奨枝: `△7五桂打` は桂打ちで、初手王手ではない。保存scoreは `cp -7578`。

production表示:

> 【なぜ良くなかった？】△5二金のあと、保存された読み筋では相手の王手が続き、▲8二龍まで詰み評価になります。

> 【推奨手では】水匠5は△7五桂打を選んでいます。この枝では、実戦枝と同じ詰み評価にはなっていません。

> 【次に確認すること】指す前に、相手の次の王手と、その次の自分の応手後も王手が続くか確認します。

`△7五桂打で王手を続ける`、`金を動かしたから詰んだ`、`唯一の受け`、`玉が薄い` は生成しない。

## UI

- 実戦/推奨カードは既存の駒SVGを再利用し、駒種を主表示、移動先・元棋譜を副表示にした。
- 通常移動 `5二へ`、drop `7五へ打つ`、promotion `成る`、non-promotion `成らず` をUSIと盤面から構造化する。
- semantic tokenを `actual-board #A11222`、`recommended-board #0047AB`、`actual-card #FF6B5A`、`recommended-card #5DA9FF` に固定した。
- 盤面marker、矢印、枠、凡例、カード、PV枝を赤=実戦・青=推奨へ統一し、`実` / `推` の文字と実線/破線も残した。
- 独立した「次の課題局面へ」は非表示にし、前後操作列へ `⚠ 次課題` を統合した。
- 「この一局のポイント」「次局への学び」「読み筋」は初期状態を閉じた。B-strict learning最大3件は維持した。
- 評価グラフを58pxから49px、前後操作を28pxから27pxへ整理し、カードpaddingと周辺余白を削減した。盤面は約416px高を維持した。

## Visual Regression

端末エミュレーションでlayout viewport自体を固定して検証した。両幅とも下部navigation込み844px、review領域782px以内、初期 `scrollTop = 0`。CSSのscroll containerは最小値としてclientHeightを返すため782pxだが、最終子要素bottomはreview領域内に収まることを別途assertした。

| viewport | 盤面 | 操作 | 評価 | 課題カードbottom | 初期折りたたみ | 結果 |
|---|---:|---:|---:|---:|---|---|
| 390×844 | 416px | 27px | 49px | 745px | 3箇所とも閉 | 成功 |
| 375×844 | 416px | 27px | 49px | 745px | 3箇所とも閉 | 成功 |

- [390×844 screenshot](SHOGI_REASON-EXPLANATION_ONESCREEN_390x844.png)
- [375×844 screenshot](SHOGI_REASON-EXPLANATION_ONESCREEN_375x844.png)

実装前の閉状態約810pxから780px以下へ30px以上削減した。主要表示は対局情報、盤面、前後/次課題操作、評価、現在の課題、bottom navigationまで確認できる。

## 回帰

- Node: 30件成功
- Python unittest: 28件成功
- Cloudflare Node: 5件成功
- B-strict: 現行20局の最大loss 20/20、mate保有局 12/12を維持
- Reason audit: 20局 / 110 problem成功
- Visual Regression: 390×844 / 375×844成功
- `git diff --check`: 成功
- 30k/60k: 変更なし
- 既存局再解析: なし

## Commit / Pages

- 実装基準main: `126b78d7e855686e0d030e6ae81a7290bff26351`
- implementation commit: commit後に確定
- Pages: push後にproduction URLを390×844で再確認する

## 残課題 / 次Phase

Phase 1の必須範囲に残課題はない。次の推奨Phaseは、production利用でLevel別の詳細PV展開率・次課題遷移率を匿名集計し、文章の短縮余地をHuman ReviewするPhase 2。B-strictや解析条件の変更は別判断とする。
