# SHOGI Skill Estimation Phase D1 Calibration Result

## 1. 判定

- 判定: pipeline実装・検証成功、Calibration feasibilityは未確立
- SSOT: `origin/main` / `HEAD` `6efccc05cbb6c2d30c2deba00bf4d2237576fc57`
- pilot: 監査対象25局の公式棋力付き16 player-game、9 unique users
- rank cohort: 2級 2、1級 4、初段 10
- production段級位表示: 禁止を維持
- UI、既存analysis JSON、既存game JSON: 変更なし
- 再解析: なし

最新mainには参照監査後の1局があり、全体は26局/52 player-game/公式ラベル18件である。D1の比較可能性を保つため、pilot CLIの既定値は参照監査と同じ25局（`20260912_shuty005` を除外）の16件に固定した。`--all-current` で追加データも別実験できるが、このレポートの数値には混ぜていない。

なお最新SSOTからread-only再生成した25局の平均は2級67.9904、1級72.4200、初段75.0990であり、参照レポート記載の67.9098/72.2572/74.9990と微差がある。本D1は最新SSOTからの再現値を採用し、既存JSONは変更していない。

## 2. 実装

`tools/skill_calibration.py` に以下を実装した。

- 1 player-game = 1 rowのdataset validator
- player ID必須、重複player-game、未知rank、範囲外値、混在feature/score versionの拒否
- 2級=8、1級=9、初段=10の順序尺度
- Leave-One-User-Out（LOOU）splitとtrain/test player集合の交差ゼロassertion
- dependency-free ordinal ridge baseline（連続latent rankをridge回帰し、train fold内だけで順序制約付きcut pointを作る）
- exact accuracy、±1 rank accuracy、rank-step MAE、confusion matrix
- side/result別誤差、同一公式棋力内および可能な同一player内の勝敗差監査
- overall/opening/middlegame/endgameの独立model entry point
- `ESTIMABLE` / `LOW_CONFIDENCE` / `INSUFFICIENT_DATA` gate
- LOW/MEDIUM/HIGH confidence構造。単局HIGH禁止、小training cohortはLOW cap
- single-game / rolling-10 / rolling-30のfeature-first aggregation

モデルのpredictorに`result`、`side`、`player_id`、`game_id`、公式棋力fieldを指定すると拒否する。rankはtargetだけ、side/resultは監査stratumだけである。CLIは `python tools/run_skill_calibration.py [--all-current] [--out result.json]`。

## 3. Validation方式

9ユーザーでは固定GroupKFoldの単一分割より、全ユーザーを一度ずつ完全hold-outするLOOUが最も情報を無駄にしないため採用した。全9 foldsで同じplayerがtrain/testを跨がない。cut point、欠損補完中央値、標準化値は各train foldだけから学習する。

ただし16 rowsのうち同一playerが8 rowsを占め、2級は2 users/2 rowsしかない。LOOUはリークを防ぐが、標本偏りや巨大な分散を解消しない。全精度は参考値であり、production thresholdの根拠ではない。

## 4. モデル比較（LOOU、n=16、参考値）

| model | predictor | exact | ±1 | rank MAE |
|---|---|---:|---:|---:|
| A Raw Score単独 | overall Raw Score | 31.25% | 81.25% | 0.8750 |
| B phase score | opening/middlegame/endgame Raw Score | 25.00% | 81.25% | 0.9375 |
| C Raw Score + 基本特徴量 | overall Raw Score/coverage/eligible/CPL/best一致/大駒損失 | 18.75% | 75.00% | 1.0625 |

Aがpilot内では最良だが、優位性を主張できる標本数ではない。Cの悪化は小標本へ対する特徴量過多と整合し、複雑なMLへ進む根拠はない。D2でもAを必須baseline、B/Cを比較対象とし、ordinal logistic regressionは十分なuser数を得た後の候補とする。

### A confusion matrix

行がofficial、列がprediction。

| official \ predicted | 2級 | 1級 | 初段 |
|---|---:|---:|---:|
| 2級 | 1 | 0 | 1 |
| 1級 | 1 | 2 | 1 |
| 初段 | 2 | 6 | 2 |

### Phase別単独model

| phase | exact | ±1 | rank MAE | single-game gate |
|---|---:|---:|---:|---|
| overall | 31.25% | 81.25% | 0.8750 | LOW_CONFIDENCE 16 / ESTIMABLE 0 |
| opening | 25.00% | 50.00% | 1.2500 | LOW_CONFIDENCE 16 / ESTIMABLE 0 |
| middlegame | 18.75% | 81.25% | 1.0000 | LOW_CONFIDENCE 16 / ESTIMABLE 0 |
| endgame | 25.00% | 93.75% | 0.8125 | LOW_CONFIDENCE 14 / INSUFFICIENT_DATA 2 / ESTIMABLE 0 |

これにより将来「総合/序盤/中盤/終盤」を別々に推定する構造は成立した。ただし現在はどのphaseもproduction表示可能ではない。

## 5. sample / coverage gate

初期gateはoverallをeligible 12手以上、各phaseを6手以上、全groupでcoverage 0.65以上とする。どちらかを下回れば`INSUFFICIENT_DATA`。最低値は満たすが単局、coverage 0.8未満、またはeligibleが最低値の2倍未満なら`LOW_CONFIDENCE`。複数局かつ十分な量を満たす場合だけ`ESTIMABLE`とする。

これはrank thresholdではなく欠損・過少標本を拒否する安全gateである。D2でphaseごとの誤差/intervalと欠損率を見て再推定する。

## 6. 勝敗・先後監査

公式ラベル16件内では勝者平均76.1468、敗者平均70.9345、観測差+5.2123だった。同一rank内では1級+1.4452（勝1/負3）、初段+4.7514（勝7/負3）。2級は勝者0件のため比較不能。同一player内で勝敗双方があるのは1 userだけで、差は+1.2496。勝敗を直接predictorへ入れていないことはfixtureとfeature allow-listで保証するが、「勝った局ほど高いperformance score」という観測関係は残る。rank推定として許容できるかはD2でplayer-clustered推定と、複数局aggregate後の差を再監査する。

参照監査の全50 rowsでは勝敗差+7.3037、先後差-0.5865。本SSOT再生成ではそれぞれ+7.2044/-0.6382だった。公式ラベル16件だけでは先手−後手Raw Scoreが+1.5160、Aのprediction MAEは先手0.5000/後手1.2500であり、方向も安定しない。小標本参考値とし、sideを補正featureへ自動追加しない。

## 7. single-game / rolling

- single-game: 「今局performance」。HIGHは禁止し、D1 cohortではLOW。
- rolling-10: 「現在棋力候補」。10局の離散rank predictionを平均せず、Raw Scoreと連続基本featureをeligible move数で先に集約して1回predictする。
- rolling-30: 「安定棋力候補」。同じfeature-first方式。30局に満たない場合は実game countを明示する。

feature-firstを推奨する理由は、離散化後の平均でcut point情報を失わず、eligible move/coverage/gate/OOD/intervalを集約後の実量で評価できるためである。prediction-averageとの実証比較には同一user 30局以上のholdout履歴が必要だが、現cohortの最大は8局なのでD1では比較不能。D2では各test userの時系列末尾をholdoutし、10/30局窓で両方式のMAEとinterval coverageを比較する。

## 8. Confidence

confidenceはtraining unique users、training rows、eligible moves、coverage、prediction interval幅、OOD、rolling game countを理由コード付きで評価する。training users 30未満またはrows 100未満はLOW cap。single-gameは常にHIGH禁止。MEDIUMは少なくとも10局、coverage 0.8、eligible 60、非OODを必要とする。HIGHは少なくとも30局かつ100 training users、狭い検証済みintervalを必要とする。現pilotは全出力LOWである。

## 9. D2 dataset specification

入力は既存の合法な取込経路、ユーザー提供KIF、保存済みmetadataだけを使う。将棋ウォーズ等への自動大量scrapingは実装しない。display name、KIF本文、局面列はcalibration tableへ保存せず、provider-scoped opaque `player_id`を使う。

必須単位は1 player-game/row。`provider`、`time_control`、`official_rank`、rank観測日時/由来（D2追加）、`side`、`result`、coverage、eligible moves、overall/3phaseのscore/features、feature/score/schema versionを保持する。公式rank変更前後を混ぜず、user/rank/time-control/providerでcohort化する。収集・split・集計は常にplayer単位。

段階的な最低推奨数は次とする。これはpower analysis前のcollection gateで、到達だけではproduction承認にならない。

| stage | rank範囲 | unique users最低 | player-games最低 | 次判断 |
|---|---|---:|---:|---|
| Pilot D2 | 2級/1級/初段 | 各rank 30（計90） | 各rank 300（計900、各user 5〜15局目安） | model/feature/gate選択、nested group CV |
| Expansion 1 | 3級〜二段 | 各rank 30 | 各rank 300 | 5段階ordinalの単調性、隣接rank MAE、provider/time-control差 |
| Expansion 2 | さらに上下 | 新rank各20で探索開始、30で主評価 | 新rank各200で探索、300で主評価 | extreme rankの統合/追加収集判断 |

production候補判定では別途、rankごと20 unique users以上の完全未使用test setを確保する。1 userの局数上限weighting、class balance、bootstrap user-clustered 95% interval、OOD/provider/time-control別評価、勝敗/先後誤差差、rolling-10/30を必須にする。

## 10. 結論

D1はuser-disjoint ordinal validation pipelineが動くことを確認した。一方、Aでもexact 31.25%、MAE 0.875であり、class/user不均衡も大きい。Raw Skill Scoreから公式段級位をproduction品質で推定できる可能性は、現16件からは肯定も否定もできない。次Phaseは合法なD2 pilot収集と事前登録したnested user-group validationであり、段級位UIや固定thresholdの実装ではない。
