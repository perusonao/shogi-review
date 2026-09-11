# SHOGI_REVIEW-PV-EXPLANATION Phase 3 実施結果

## 監査対象

- SSOT: `origin/main` / `ab1674c6b7deb96cb0ce91b30bc11a5eb2f8fac8`
- 既存対局: 16局
- 通常解析: 30,000 nodes / position（変更なし）
- 短PV追加探索: 4手未満の課題枝だけ60,000 nodesを1回（変更なし）

## ゲーム単位metrics

新規解析時に`analysis/metrics/<gameId>.json`を自動生成し、import・workerの通常経路で解析JSONと一緒に検証、commit、pushする。

保存項目:

- `gameId`
- `analyzedAt`（UTC）
- `positions`
- `problemPositions`
- `baseAnalysisSeconds`
- `extraPvSearchSeconds`
- `totalAnalysisSeconds`
- `shortPvCandidates`
- `extraSearchExecuted`
- `pvLengthBeforeAverage`
- `pvLengthAfterAverage`
- `pvLengthsBefore` / `pvLengthsAfter`（集計の中央値算出用）
- `improvedPvCount`
- `unchangedPvCount`

時間は全局面30kのエンジン探索と、短PVの追加探索を別々に計測する。PV長はエンジンPVを合法手として順次日本語変換できた手数で測る。Worker URL、secret、エンジン/evalのローカルパスは保存せず、import検証でも禁止キーを拒否する。

既存16局にはmetricsを遡及生成していない。Phase 3公開後にiPhoneから通常投入される新規対局だけを実運用データとして蓄積する。

## 集計ツール

次のコマンドで保存済みmetricsを自動集計できる。

```powershell
python tools/report_analysis_metrics.py
```

人間向け日本語表示に加え、`--json`で機械可読出力も可能。集計項目は解析対局数、解析時間の平均/中央値、追加探索時間の平均/中央値、増加率の平均/中央値、課題局面数、short PV率、追加探索実行率、PV改善率、PV長Before/Afterの平均/中央値である。

short PV率の分母は課題局面の2枝（推奨・実戦）、追加探索実行率の分母はshort PV候補、PV改善率の分母は実行された追加探索と定義した。

## 参考判定

集計ツールは次の参考判定を表示するが、解析条件を自動変更しない。60kを最適値とは断定せず、実運用10局以上を蓄積してから再評価する。

- 解析時間増加: 25%以下=良好、25%超50%未満=要観察、50%以上=条件再検討
- short PV改善率: 70%以上=良好、40%以上70%未満=要観察、40%未満=追加探索方式再検討

10局未満では残り必要局数を「蓄積中」と表示する。

## 実エンジン確認

既存公開データを変更しない一時出力先で、NAGATA2532戦63局面をYaneuraOu V9.00 NNUE + 水匠5で実解析した。

- positions: 63
- problemPositions: 6
- baseAnalysisSeconds: 2.188秒
- extraPvSearchSeconds: 0.883秒
- totalAnalysisSeconds: 3.071秒
- shortPvCandidates / extraSearchExecuted: 6 / 6
- PV長Before平均 / After平均: 1.833手 / 8.0手
- improvedPvCount / unchangedPvCount: 4 / 2

これは実装確認用dry-runであり、実運用10局の母数には含めない。

## NAGATA2532 28手目回帰

公開済み解析JSONと感想戦UIを確認した。

- 推奨PV: △6八角成 → ▲同銀 → △7八金打 → ▲7九角 → △4四銀 → ▲5三歩打
- 実戦PV: △4四銀 → ▲5二飛成 → △同金右 → ▲6九金 → △3四歩 → ▲2三飛打
- 折りたたみ内は各枝6手までで、赤=実戦、緑=推奨を維持

## コメント監査

コメント生成は引き続き実測評価値、合法な盤面/PV、駒取り、王手、成り、詰みだけを根拠とする。`狙い`、`戦略`、`手厚い`などを推測で追加する処理はない。長いPVは根拠抽出の入力を増やすだけで、ポイント表示は検証可能な事実を最大2件に制限したままである。

## テスト

- metrics生成（追加探索なし/あり）
- PV改善/不変件数
- elapsed timeと合計時間
- 複数metrics集計と平均/中央値
- 判定境界
- optional配列の後方互換
- schema v1/v2既存解析互換
- worker E2E経路
- 実エンジンdry-runと集計ツール
- 実エンジン出力に対するimport metrics検証
- NAGATA2532日本語PV回帰

## 公開確認

- 機能commit: `92f31ab56888bd071a490e9b7338dbad3be3d095`
- GitHub Pages deployment: 成功
- 公開URL: `https://perusonao.github.io/shogi-review/`
- 390×844表示でNAGATA2532戦28手目を確認
- 赤=実戦、緑=推奨、課題カードの折りたたみ、日本語PV各6手が正常
- 開発用metricsは通常の感想戦画面に表示されない
