# SHOGI Skill Estimation Raw Score Audit

## 1. 監査条件

- SSOT: `origin/main` / `HEAD` `7cd2453a45fd47ad2733365800870664531dab37`
- 監査対象25局: 実装前監査の25局（最新main追加の `20260912_shuty005` を除く）
- 追加回帰: 最新main全26局
- 処理: 保存済みgame/analysis/KIFのread-only extractionのみ
- 再解析、analysis JSON更新、段級位Calibration: なし

## 2. 既存25局結果

| 項目 | 結果 |
|---|---:|
| 処理成功 | 25/25 |
| schema v1 / v2 | 14 / 11局 |
| player-game | 50 |
| 双方解析 | 25/25局 |
| opening eligible moves | 917 |
| middlegame eligible moves | 1,046 |
| endgame eligible moves | 500 |
| overall Raw Score算出 | 48/50 player-games |
| opening / middle / end Raw Score算出 | 48 / 48 / 48 |
| overall feature coverage平均 | 85.60% |
| opening / middle / end coverage平均 | 85.60% / 85.60% / 85.60% |
| 公式棋力付き | 16 player-games |

Raw Scoreを算出できない2 player-gamesは `akane_20260910`。gameは143手だがlegacy analysisの評価点が連続全手ではなく、欠損を0やmateへ補完しなかった結果である。

confidence分布はoverall/opening/middlegameがmedium 48・low 2、endgameがmedium 25・low 25。単局highは0。

## 3. 公式棋力16 player-game sanity check

| 公式棋力 | 件数 | Raw Score平均 | min | max |
|---|---:|---:|---:|---:|
| 2級 | 2 | 67.9098 | 59.9719 | 75.8476 |
| 1級 | 4 | 72.2572 | 63.3829 | 80.2268 |
| 初段 | 10 | 74.9990 | 63.2949 | 90.5141 |

これはCalibrationではなく符号・欠損・リークのsanity checkに限る。件数、class coverage、ユーザー独立性が不足するため、値から段級位閾値を作らない。

## 4. Bias / leakage check

| check | 結果 |
|---|---:|
| 先手Raw Score平均 | 72.3978 |
| 後手Raw Score平均 | 72.9843 |
| 先手−後手 | -0.5865 |
| 勝者Raw Score平均 | 76.3429 |
| 敗者Raw Score平均 | 69.0392 |
| 勝者−敗者（観測差） | +7.3037 |

先後差はこの小標本では0.5865点で、明らかな符号反転は見られない。勝者と敗者の観測差は存在するが、resultを変えてもscoreが不変であるfixtureが通り、score関数にresult field・winner bonus・loser penaltyはない。観測差を「リークなしの証明」や段級位調整には使わず、将来のuser/game clustered検証で継続監査する。

schema v1の旧極端cpはtyped mateに変換せずunavailableにしたため、欠損由来の±30,000級CPL異常はRaw Scoreへ入っていない。schema v2 mateもtyped eventのままで、cp componentから除外した。

## 5. 最新main追加回帰

最新main全26局では26/26成功、schema v1/v2は14/12、52 player-games、双方解析26/26。eligible movesはopening 954、middlegame 1,088、endgame 522。Raw Scoreはoverall/各phaseとも50/52、公式棋力付きは18 player-games、coverage平均は86.15%。

B-strictは最大loss 26/26、mate保有局18/18を保持した。追加局を含めてもproduction selection、解析threshold、保存JSONは変更していない。

## 6. Calibration export監査

- 既存25局: 50 rows
- 最新main26局: 52 rows
- 粒度: 1 player-game = 1 row
- 必須context: provider / time_control / player_id / official_rank / side / result
- feature: overall / opening / middlegame / endgameのRaw Score、raw metrics、coverage、eligible moves
- 秘密情報: display name、KIF本文、局面列を除外
- Calibration status: Pending
- 段級位換算: 未実装

## 7. 判定

Phase A-Cのdata contract、固定phase、双方Raw Score、coverage、confidence、Calibration exportは実装基準を満たす。公式棋力16件はsanity checkのみに用い、provisional weightやthresholdを段級位へ合わせる調整はしていない。production UIへの棋力相当表示はHuman ReviewおよびPhase D完了まで禁止を維持する。
