# SHOGI_SELECTION B-strict Production Result

## 1. 結果

- 判定: 成功
- production実装基準: `origin/main` / `HEAD` `f111769ead45bdfcc85ed7f2c33810cfa9d49c78`
- 実装commit: `80f4468c9139c30f3d0ed95876093d2a0585220d`
- Pages: `pages-build-deployment` run `34610812865` 成功
- 公開URL: https://perusonao.github.io/shogi-review/
- Issue #2: production結果を記録しclose
- Issue記録: https://github.com/perusonao/shogi-review/issues/2#issuecomment-5636068055

作業開始時は `8b96b07968d86a2d0eed9ac970e52ba5220ecc91` が `origin/main` / `HEAD` だった。作業中に4局の追加commitがmainへ入り、再度 `git fetch`、`git status`、`origin/main` / `HEAD` を確認したうえで、最新の `f111769` をproduction実装のSSOTに切り替えた。過去SHAを実装基準には使用していない。

## 2. 採用ロジック

### 候補とcluster

既存category候補に、保存済みissueから検出できる最初のmate変化候補を追加する。cluster判定は保存値だけを使い、棋理解釈は行わない。

1. 同一bestMove、8手以内。両方にPVがある場合は先頭2手の一致も必須。
2. 2手以内で、前候補のscoreAfterと後候補のscoreBeforeが型・値とも一致。
3. score-link済みclusterに隣接する評価イベントだけの候補は、2手以内の評価イベント連鎖として補助化できる。
4. 両候補にissueがありbestMoveまたはPV prefixが異なる場合、score-linkだけでは統合しない。
5. mateであることだけをidentityにしない。

代表はcluster内の最大lossを最優先し、次にactualMove/bestMove、PV、mate比較、score情報量、category priority、手数の順で決める。代表以外は `auxiliaryEvents` に `ply`、`category`、`scoreBefore`、`scoreAfter`、`mateTransition` を保持する。

### learning

learningは代表局面だけから最大3件を選ぶ。保存済みissueがあり、次のいずれかを持つ局面だけを対象にする。

- actualMoveとbestMoveの比較
- PV
- loss
- issueに紐づくmate比較

評価境界を通過しただけで比較手/PV/lossを持たない局面は重要局面には残すが、learningから外す。

## 3. Human Review fixture

| 対局 | production結果 |
|---|---|
| NAGATA2532 | 34手目代表。28/36手目を補助。57手目はlearning非選択 |
| ありあけ | 86/94手目を異なるbestMove/PVの独立mate issueとして維持。71手目はlearning非選択 |
| しゅん | 71手目代表。68/70手目を補助 |
| じゅんや | 44手目代表。43手目を補助 |
| おまつ | 126手目はlearning。135手目は重要局面のみでlearning非選択 |

## 4. 監査済み既存16局 Before / After

BeforeはHuman Review前のAロジック監査値、Afterは保存済みanalysis JSONへproductionロジックを適用した実測値である。水匠5再解析は行っていない。

| 指標 | Before A | After B-strict | 差 |
|---|---:|---:|---:|
| 重要局面総数 | 52 | 47 | -5 |
| 平均重要局面数 | 3.25 | 2.94 | -0.31 |
| learning総数 | 46 | 30 | -16 |
| 平均learning数 | 2.88 | 1.88 | -1.00 |
| 比較可能 | 31/46 | 30/30 | -1件、率は改善 |
| 比較可能率 | 67.4% | 100.0% | +32.6pt |
| ±2手の近接重複 | 5組 | 0組 | -5組 |
| ±4手の近接重複 | 7組 | 2組 | -5組 |
| 同一bestMove重複 | 3ペア | 0ペア | -3ペア |
| 最大loss捕捉 | 16/16 | 16/16 | 維持 |
| mate保有局捕捉 | 9/9 | 9/9 | 維持 |

目安の件数へ数値合わせはしていない。Human Review確定fixtureと情報量フィルタをそのまま適用した結果、重要局面は47件、learningは30件、比較可能率は100.0%になった。

## 5. 最新mainの現行20局

作業中にmainへ追加された4局も同じ保存JSON回帰へ含めた。

| 指標 | 現行20局 |
|---|---:|
| 重要局面総数 / 平均 | 61 / 3.05 |
| learning総数 / 平均 | 39 / 1.95 |
| 比較可能率 | 39/39 (100.0%) |
| ±2手 / ±4手の近接重複 | 0組 / 3組 |
| 同一bestMove重複 | 0ペア |
| 最大loss捕捉 | 20/20 |
| mate保有局捕捉 | 12/12 |

## 6. UI確認

- iPhone viewport: 390x844
- ローカルと公開Pagesの両方で優先5局を確認
- 「この一局のポイント」は代表カード中心に表示
- NAGATA2532の代表34手目に「関連: 28手目 最初の分岐 / 36手目 逆転局面」を表示
- 公開Pagesで補助28手目をタップし、`28/62手`、指す直前の盤面、赤=実戦、緑=推奨、課題カード、PV展開を確認
- ありあけ86/94は独立カードかつlearningに残る
- しゅん68/70、じゅんや43は補助リンクとして表示
- おまつ135は重要カードに残り、learningには表示されない
- 「次局への学び」は最大3件を維持

## 7. 互換性と解析条件

- 既存schemaVersion 1/2を読み取り可能
- analysis JSONとgame JSONは変更していない
- 保存済みanalysis JSONだけで選択を再計算
- 通常解析30,000 nodesを維持
- short problem PVの追加探索60,000 nodesを維持
- analysis metricsの生成・集計コードは変更していない

## 8. テスト

- Node: 23/23成功
- Python: 28/28成功
- 合計: 51/51成功
- fixture: cluster生成、代表選択、補助イベント、補助ジャンプ導線、same bestMove、different PV、mate identity、learning情報量、最大loss、mate、先手/後手、旧JSON、優先5局、既存16局、現行20局
- `git diff --check`: 成功
- Pages deployment: 成功

## 9. 残課題と次Phase

機能上の停止要因はない。Pages buildにはGitHub側のNode.js 20 deprecated警告があるが、今回のbuild/deployは成功している。

次Phaseは、production利用で補助イベントのタップ率とlearning件数を蓄積し、現行20局以降の新規対局で誤clusterがないかを監視する。閾値や60k条件は、その観測結果と別Human Reviewなしに変更しない。
