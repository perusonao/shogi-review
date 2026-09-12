# SHOGI Skill Estimation Phase A-C Result

## 1. 結果

- 判定: 成功
- 実装基準: 最新 `origin/main` / `HEAD` `7cd2453a45fd47ad2733365800870664531dab37`
- 実装範囲: Phase A Data Foundation、Phase B Phase Segmentation、Phase C Raw Skill Score
- Calibration: Pending。段級位換算は未実装
- production UI: 変更なし。`初段相当` / `1級相当` 等の推定表示は追加していない
- 入力: 既存game/analysis/KIFをread-only使用
- 既存analysis JSON変更: なし
- 既存棋譜再解析: なし
- Pages deploy: なし

実装前監査時点の25局に加え、最新mainには `20260912_shuty005` が1局追加されている。監査要求値は元の25局を独立集計し、最新mainの26局も追加回帰した。

## 2. Phase A — Data Foundation

`tools/skill_estimation.py` に、解析JSONとは別の再生成可能なderived layerを実装した。JSON Schemaは `docs/schemas/skill-estimation-derived-v1.schema.json`。

game metadataは次を保持する。

- `game_id`、`source`、`provider`、`time_control`、`schema_version`
- 両者の `player_id`、`display_name`、`official_rank_raw`、`official_rank_normalized`、`side`、`result`
- analysis/game入力SHA-256、入力analysis schema version
- 欠損状態の `available` / `missing` / `unavailable`

player IDはproviderをnamespaceにし、NFKC・casefold・空白除去したusernameからSHA-256のopaque IDを作る。providerが欠損したrecordは `provisional-provider-missing` として、将来provider確定時に誤統合しない。`ぺるそなお` と `sonao81` のような別名も確認なしには統合しない。

公式棋力は10級〜1級と初段以上を `rank_type` / `rank_number` / `rank_order` に正規化する。`rank_order` は教師ラベルの順序表現で、Raw Skill Scoreへの換算ではない。

時間条件は少なくとも以下を別cohortにできる。

- `10分切れ負け` → `10m-sudden-death`
- `3分切れ負け` → `3m-sudden-death`
- `10秒` → `10s-per-move`
- `10分+30秒` → `10m-30s-byoyomi`
- 未知形式 → rawを保持した `other / unavailable-normalization`

## 3. Read-only feature extractor

双方へ同じpure extractorを適用し、各plyに以下を保持する。

- game/player/side/ply/phase/progress
- mover視点のtyped `score_before` / `score_after`
- CPL相当、bestMove match、typed mate event
- evaluation reversal、advantage preservation/loss、critical loss
- capture/material event、major piece lossと被影響player ID
- Reason Evidence参照（既存verified issueがある場合）
- 将来task evidence接続用 `evidence_id`

schema v1は連続する先手視点cpをactor sideで符号正規化する。旧mate sentinel相当の絶対値25,000以上はcpにもmateにも変換せず `unavailable` にする。schema v2は保存済みmover視点typed scoreを使い、mateをcpへ変換しない。bestMoveがない場合も不一致や0点として捏造しない。

## 4. Phase B — Segmentation

production判定は `fixed-ratio-v1`。

- opening: `ply / final_ply < 0.35`
- middlegame: `0.35 <= ply / final_ply < 0.75`
- endgame: `0.75 <= ply / final_ply`

35%と75%の等号、短手数局をfixture化した。first capture、major exchange、first check、promotion、mate regionは `phase_signals` にshadow記録するが、production phase判定には一切使わない。

## 5. Phase C — Raw Skill Score

`raw-skill-provisional-v1` は0〜100の内部指標であり、段級位ではない。構成は次のとおり。

| component | provisional weight |
|---|---:|
| CPL quality (`mean(100 * exp(-CPL / 300))`) | 35% |
| critical loss avoidance（CPL 300以上を暫定criticalとする） | 20% |
| bestMove match | 10% |
| typed mate safety（miss/allow回避） | 10% |
| advantage preservation（mover視点600cp以上を暫定機会とする） | 10% |
| detrimental reversal avoidance | 10% |
| major piece loss avoidance | 5% |

重み、CPL scale、critical/advantage thresholdはすべてprovisionalで、Calibrationの段級位境界ではない。利用不能または判定機会のないcomponentは0点にせず、利用可能componentだけで重みを再正規化する。coverageはscoreとは別に、観測可能componentのweight比として出す。

各player-gameはoverall/opening/middlegame/endgameについて `raw_score`、`coverage`、`eligible_moves`、raw feature vector、component値、confidence理由を持つ。勝敗、公式棋力、先後はscore計算に渡さない。

confidenceは `skill-confidence-provisional-v1` のlow/medium/high frameworkを持つ。単局は常にhigh未満へcapする。highは将来の複数局集計でのみ到達可能で、現在の単局出力はlow/mediumのみ。

## 6. Calibration dataset export

`python tools/export_skill_calibration.py --out <path.csv> [--derived-json <path.json>]` で1 player-game = 1 rowを出力する。

provider、time control、opaque player ID、公式棋力、side、result、analysis schema、overall/3phaseのRaw Score・coverage・eligible moves・raw featureを含む。display name、KIF本文、局面列はCSVへ含めない。Calibration statusは常に `pending`。

## 7. テストと回帰

- Python（本実装16件を含む）: 47/47成功
- Node（追跡対象）: 26/26成功
- Cloudflare: 5/5成功
- commit対象suite合計: 78/78成功
- 作業treeに並行存在する未追跡Reason Evidenceテスト25件も含めた全体: 103/103成功
- B-strict current main: 最大loss 26/26、mate保有局18/18を保持
- `git diff --check`: 成功

Node既存回帰には対局数を24へ固定したstale assertionがあり、最新catalog連動へ修正した。B-strictのselectionロジックやthresholdは変更していない。

## 8. 次Phase

次はPhase D Calibration。現行16公式棋力player-gameで閾値は作らず、provider/time-control cohortを分離した十分なuser-disjoint datasetを収集し、モデルカードとHuman Review gateを通す。それまではproduction表示を `Calibration Pending` のまま維持する。
