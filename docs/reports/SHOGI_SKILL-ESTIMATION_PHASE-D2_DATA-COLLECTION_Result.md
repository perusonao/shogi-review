# SHOGI Skill Estimation Phase D2-1 Calibration Dataset Growth Foundation Result

## 1. 判定

- 判定: 実装成功。Stage 1は未到達
- 実装基準: `origin/main` / `HEAD` `5a5d6c3be4653169e91315a548de8a00478d5bf9`
- latest main: 26 games / 52 player-game rows / pilot labeled 18 / 10 unique users
- D1固定比較集合: 25 games / 50 rows / pilot labeled 16 / 9 unique users。`--d1-fixed` で再現可能
- production段級位表示: 禁止を維持
- 既存analysis JSON / game JSON: 変更なし
- 既存局再解析: なし

既定値は最新mainの52 rows / 18 labelsをgrowth baselineとして扱う。D1の50 rows / 16 labelsも互換入力として残す。Stage 1の90 rows到達は最初の再評価点であり、production解禁ではない。Stage 1結果をHuman Reviewし、続行・設計修正・停止を判断してからStage 2へ進む。

## 2. 実装

`tools/skill_dataset.py` にdataset v2 registry、strict training validator、pilot cohort filter、dashboard、Stage gate、checkpoint auditを実装した。`tools/manage_skill_dataset.py` が既存derived rowsと合法な追加CSV/JSON/JSONLを統合するCLIである。

v2はgame台帳とplayer-game行を分離する。これにより、同一対局の先手・後手2行を合法に保持しながら、台帳内の同一game重複、同一game-side重複、同一player-game重複を別々に拒否できる。同じplayerの異なるgameは許可し、unique usersとplayer-gamesを別集計する。

収集台帳はmetadataが足りない既存rowも削除しない。入力にdisplay nameがある場合は `provider + normalized display name` からstable IDを再計算して照合し、個人名はcalibration artifactへ残さない。official rankはrawとnormalized objectを併存させてvalidatorで整合を確認する。学習投入前のstrict validationでは `provider`, provider-scoped opaque `player_id`, `official_rank`, `time_control`, `side`, `result`, `game_id` とoverall/3 phaseのscore、coverage、eligible movesを必須にし、不足rowをpilot教師集合から除外する。

schemaは `docs/schemas/skill-calibration-dataset-v2.schema.json`。dataset artifactは `production_rank_display: false` 固定である。

## 3. 合法な入力経路

許可する `collection_route` は次だけである。

- `existing-kif`: repository内の既存KIFと既存derived data
- `user-provided-kif`: ユーザー自身が提供したKIF
- `existing-metadata`: 合法に保存済みのmetadata / derived row
- `pwa-kif-submit`: 通常のPWA KIF投入経路

network crawler、将棋ウォーズbulk scraper、Cookie/CAPTCHA利用経路は実装しておらず、未知のcollection routeはvalidatorが拒否する。通常PWAまたはinboxで解析済みになった局は、既存analysis JSONをread-onlyでexportするため再解析不要である。

```powershell
python tools/manage_skill_dataset.py `
  --additional data/calibration/imports/user-batch.jsonl `
  --dataset-out data/calibration/dataset-v2.json `
  --report-out data/calibration/dashboard.json `
  --checkpoint-audit-out data/calibration/checkpoint-audit.json
```

既定は最新main。D1との過去比較は `--d1-fixed` で固定snapshotを選ぶ。Stage未到達時はcheckpoint audit fileを作らず、dashboardに不足数を返す。

## 4. Pilot cohortと現在値

pilot学習へ入るのは `provider=shogi-wars`、`time_control=10m-sudden-death`、official rankが2級/1級/初段の積集合だけ。他rank/time controlはdatasetに保存できるがpilotから除外する。

| rank | unique users | player-games | analysis schema v1/v2 | coverage平均 | 先手/後手 | 勝/敗 | 必須欠損 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2級 | 2 | 2 | 1 / 1 | 0.900 | 1 / 1 | 0 / 2 | 0 |
| 1級 | 5 | 5 | 1 / 4 | 0.960 | 4 / 1 | 1 / 4 | 0 |
| 初段 | 3 | 11 | 4 / 7 | 0.927 | 4 / 7 | 8 / 3 | 0 |

全52 rowsは収集台帳として利用可能で、pilot labeledは18 rows / 10 unique users。rankなし等の34 rowsは欠損をdashboardへ出し、教師集合へ混ぜない。analysis schemaはv1 28 rows / v2 24 rowsである。

### Stage進捗

| Stage | target/rank | target total | 現在credited | 不足 |
|---|---:|---:|---:|---:|
| 1 | 30 | 90 | 18 | 72 |
| 2 | 100 | 300 | 18 | 282 |
| 3 | 300 | 900 | 18 | 882 |

Stage 1までのrank別不足は2級28、1級25、初段19、合計72 player-games。最終unique users目標の30/rankに対しては2級28、1級25、初段27 users不足である。

指定されたD1固定16 labeled rowsを起点にすると、2級は現在2 / 不足28、1級は現在4 / 不足26、初段は現在10 / 不足20で、Stage 1の90 rowsまで合計74 player-games不足する。latest mainの追加2 labelsと混同せず、D1 baseline比較ではこの値を使う。

## 5. Nested User-Group Validation

D1のLOOUを維持した。checkpointではouter LOOUでtest userを完全hold-outし、各outer foldのfeature/model/alpha選択はouter-training rowsだけのinner LOOUで行う。outer test userがinner train/validationのいずれにも存在しないことをassertし、fold auditへ集合を記録する。

`player_id`, `game_id`, official rank, side, resultはpredictor禁止を維持する。test userをthreshold/model選択へ使わず、side/resultはbias auditのstratumだけである。

## 6. Baseline、Bias、Phase

D1 Raw Score単独baselineを固定する。

- exact accuracy: 31.25%
- ±1 rank accuracy: 81.25%
- MAE: 0.875
- phase score model: exact 25.00%、MAE 0.9375
- Raw Score + 基本特徴: exact 18.75%、MAE 1.0625

複雑モデルはD1でbaselineを下回った。新モデルはnested評価でbaselineを明確に上回らない限りproduction候補にしない。本Phaseでは候補判定そのものも `false` である。

各Stage checkpointはexact、±1、MAE、rank ordering、side別MAE、result別MAE、rank別MAE、player内Raw Score rangeと勝敗score差、coverage別MAE、coverage集計、confidence、overall/3 phaseのLOOU auditを生成する。先後補正・勝敗補正は導入せず、再現性をデータで確認してから判断する。

overall/opening/middlegame/endgameごとにeligible player-games、eligible moves、coverageを蓄積する。phase rank predictionはLOW confidenceかつproduction禁止を維持する。

## 7. Checkpoint gate

各rankが30/100/300 player-gamesへ到達したときだけ対応Stageをcompleteとする。別rankの余剰で不足を埋めない。Stage 1到達後、CLIはRaw Score baseline audit、nested group validation、bias auditを自動生成するが、常に次を返す。

- `production_unlocked: false`
- `requires_human_review_before_next_stage: true`
- confidence: LOW / production ineligible

## 8. 検証

専用testsでduplicate game、duplicate player-game、同一gameの2 sides、stable provider-scoped ID、display name照合と非保存、rank normalization、unknown rank保存、time-control cohort、pilot外保存、missing metadata quarantine、user-disjoint、nested group isolation、checkpoint counts、side/result、schema v1/v2、coverage、D1 50/16互換性、最新52/18集計を確認した。

既存Python tests、Cloudflare Node tests、B-strict、`git diff --check`を最終確認する。production UI、既存analysis JSON、解析設定、B-strict selection logicは変更していない。
