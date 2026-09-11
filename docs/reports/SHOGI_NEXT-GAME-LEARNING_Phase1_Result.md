# SHOGI_NEXT-GAME-LEARNING Phase 1 実施結果

## 監査対象

- SSOT: `origin/main` / `7ddfafd55e9b60699bdcdeb86aa544f79ca74fb8`
- 既存の重要局面pure function、analysis schema v1/v2、PV、points、mate評価、局面ジャンプを確認
- 通常30,000 nodes、短PVだけ60,000 nodesの追加探索条件は変更していない
- 重要局面のthreshold・分類条件は変更していない
- metrics生成・集計処理は変更していない
- 既存16局は再解析していない

## 学び抽出

既存の`selectImportantPositions`結果だけを入力とする`extractLearningItems`を`game-summary.js`へ追加した。別の重要局面探索は行わない。

次の順で最大3件を選び、同じ手数は1件に統合する。

1. mate評価を含む局面
2. 最大の課題
3. 最初の分岐
4. 逆転局面
5. その他の重要局面

learning itemは将来の複数局集計に備え、`gameId`、`ply`、`type`、`actualMove`、`bestMove`、`loss`、`mate`、`category`、`scoreChange`を保持する。個人傾向、棋風、心理、弱点の判定は実装していない。

## 確認テーマ

テーマは保存済み解析から機械的に確認できる場合だけ付与する。

- mate scoreまたは保存済み詰み評価: `詰み筋を確認`
- 保存済みpointsに王手: `王手を含む読み筋を確認`
- 保存済みpointsに駒取り: `駒を取る手を含む読み筋を確認`
- 実測PVのUSIに成り、または保存済みpointsに成り: `成る手を含む変化を確認`
- 実測PVのUSIに駒打ち: `持ち駒を使う候補を確認`
- 該当なし: `実戦手と推奨手を比較`

テーマ判定のために未保存の手を補完せず、「攻め」「受け」「手厚い」「玉形」「大局観」などの意味分類は行わない。

## UI

感想戦の課題カード後に「次局への学び」を追加した。「この一局のポイント」は何が起きたか、「次局への学び」はどこを復習するかに役割を分け、長文を重複させていない。

- 最大3件
- 各項目は手数、確認テーマ、実戦手→推奨手だけの短い表示
- 初期状態で展開し、必要なら折りたためる
- タップ時は既存の局面ジャンプを再利用
- ジャンプ後はサマリーと学びを畳み、盤面、赤/緑矢印、課題カード、PVへ移動
- チェック表示は視覚上の`□`だけで、Phase 1では状態保存を増やしていない

## NAGATA2532回帰

既存重要局面4件から優先度上位3件を機械選択した。

1. 34手目 / 最大の課題 / 駒を取る手を含む読み筋を確認
2. 28手目 / 最初の分岐 / 駒を取る手を含む読み筋を確認
3. 36手目 / 逆転局面 / 実戦手と推奨手を比較

28手目は`△4四銀 → △6八角成`、後手視点`+706 → +241`を保持する。fixtureへ順位を固定せず、既存重要局面と優先順位の結果として選択された。

## 実運用監査

summary選択品質の後日監査用に、同じpure functionから次の専用JSON構造を生成する。

- `gameId`
- `recordedAt`
- 選択された各局面の`gameId`、`ply`、`category`、`scoreChange`

感想戦を開いた端末の`localStorage`へ`shogi-review-summary-audit-v1`として対局単位で重複更新し、最新10局まで保存する。secret、Worker URL、KIF、PV、ローカルパスは保存しない。Phase 1ではサーバーやGitへ送信せず、複数端末を横断する中央集計は将来課題とした。

## テストと確認

- Python unittest: 28件成功
- game summary / learning Node test: 16件成功
- Cloudflare backend Node test: 5件成功
- 最大3件、重複除去、mate優先、最大損失、最初の悪化を確認
- 王手、駒取り、成り、打、fallbackを確認
- 先手/後手正規化、NAGATA2532、旧schema v1を確認
- 保存済みJSONだけで既存16局すべて1〜3件を抽出
- 390×844ローカルPWAで学び3件、28手目ジャンプ、赤/緑表示を確認
- ブラウザconsoleにerror/warningなし
- `git diff --check`: 成功

## 公開確認

- 機能commit: `4dcaf8247b8e3fe8363f0e3c3621c3ae5ba5fd70`
- GitHub Pages deployment: 成功
- 公開URL: `https://perusonao.github.io/shogi-review/`
- 公開PWAの390×844表示でNAGATA2532戦の学び3件を確認
- 28手目タップ後、28/62手、赤/緑矢印、後手視点+706→+241、課題カードを確認
