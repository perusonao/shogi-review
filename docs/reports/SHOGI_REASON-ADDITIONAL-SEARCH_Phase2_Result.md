# SHOGI Reason Additional Search Phase 2 — Result

## 結論

代表10局面と必須fixture 3局面（重複するryunenbb 80を含め、合計13局面）だけを、既存Windows環境のYaneuraOu V900Git AVX2 + 水匠5で追加探索した。production JSON、既存23局、D64の残り59局面、UIには変更を加えていない。

30k/60kで一致したcounterfactual differenceは69/274（25.18%）。PV内イベントの約4分の3は探索量で入れ替わり、単一探索の文章化は不安定だった。特にryunenbb 80としゅえい159は、推奨枝が30k/60kではcp、120kでは`mate -15`へ変化した。「推奨手で詰みを回避」は証拠不成立とし、production Reason候補にはしない。

実装基準は、作業中に追加された最新SSOT `031fcecd608c35360c88a88a92f63ec9891b47bc`（kurochanman52取込）であり、今回commitはこれを直接の親に持つ。開始時の未追跡Human Review文書6件は利用者の資産として変更していない。

## 対象と探索条件

| 区分 | 局面数 | 条件 |
|---|---:|---|
| 代表10 | 10 | actual/recommended各30,000 nodes・60,000 nodes |
| 必須fixture | 4（うち1重複） | ryunenbb 80、しゅえい77/79/159 |
| 120k | 4 | 上記必須fixtureだけ、actual/recommended各120,000 nodes |
| MultiPV2 | 4 | 各固定手を適用した後の相手応手を60,000 nodes、MultiPV 2 |

通常解析30kとshort PV 60kのproduction設定は変更していない。Reason探索は別CLIで計測・保存した。

### Fixed Branch Search

対象YaneuraOu buildは、試行時に`go nodes ... searchmoves ...`の制約を守らず別手を返した。そこで次の方式を採用した。

1. 同一初期局面でactualMoveまたはbestMoveの合法性を検証する。
2. 固定手を盤面へ適用する。
3. その子局面を同一nodesで探索する。
4. 返却PVの先頭へ固定手を復元する。
5. 子局面の手番視点scoreを符号反転し、元局面手番視点に正規化する。

これによりA/Bの先頭手は構造的に固定される。通常解析ラッパーの既存呼び出し方は変更していない。

## 探索結果

### 代表10の機械的Evidence判定

○は両見出しをHIGH/MEDIUMの比較事実で具体化、△は部分根拠のみ、×は根拠なし。棋理解釈は加えていない。

| nodes | Q1 ○/△/× | Q2 ○/△/× | 備考 |
|---:|---:|---:|---|
| 30k | 2 / 5 / 3 | 2 / 7 / 1 | 単独探索結果 |
| 60k | 2 / 4 / 4 | 2 / 7 / 1 | 単独探索結果 |
| 120k | 0 / 0 / 1 | 0 / 0 / 1 | 代表10中、必要例ryunenbb 80だけ |

30kと60kの両方で同じ説明根拠が残った代表例は、ak69Boy 131の詰み差と「夢への旅路 50」の角損差。ryunenbb 80の30k/60k詰み差は120kで消えたため除外した。Q3は全10局面で×。

### 重要fixture

| fixture | 30k | 60k | 120k | 判定 |
|---|---|---|---|---|
| ryunenbb 80 | actual `mate -5` / recommended `cp -12164` | `mate -5` / `cp -26133` | `mate -5` / `mate -15` | actualの短い詰みは安定。推奨手の詰み回避は不安定で未解決 |
| しゅえい77 | `cp -857` / `cp 1471` | `cp -761` / `cp 1770` | `cp -882` / `cp 1737` | actualで角損するPVは30k/120k、60kではPVが短く未確定。推奨初手王手は60k/120kで確認 |
| しゅえい79 | `cp -1815` / `cp -831` | `cp -1937` / `cp -1031` | `cp -2126` / `cp -892` | 評価差は同方向だが、▲5六銀の具体的悪因と▲6六角の意味は安定differenceにできず未解決 |
| しゅえい159 | `mate -7` / `cp -7141` | `mate -7` / `cp -35281` | `mate -7` / `mate -15` | actualの短い詰みは安定。推奨手の詰み回避は不安定で未解決 |

しゅえい79の最初のイベント差は全探索で初手。actualの▲5六銀は5六の歩を取るcapture、recommendedの▲6六角は2手目に△同馬で角を取られる。30kではactual枝も10手目に同じ角を失い、60kでは両枝で角損がshared、120kではrecommendedだけ2手目の角損、actualは12手目に飛車損となった。差の種類と発生順が一致しないため、Q1/Q2とも未解決とした。

### MultiPV2

MultiPV2は固定手後の相手応手候補2本だけに限定した。2本共通イベントは次のとおりだが、「全合法応手で強制」を証明するものではないためReason本文では`forced`を使用しない。

| fixture | actual側2本共通 | recommended側2本共通 |
|---|---|---|
| ryunenbb 80 | 自分の銀capture、相手のcheck | なし |
| しゅえい77 | 相手が桂capture | 自分のcheck |
| しゅえい79 | 自分が歩capture | なし |
| しゅえい159 | 自分が金・歩capture、相手のcheck | 自分のcheck |

## コスト

| 探索 | branches | nominal nodes | reported nodes | engine time | wall time | 1局面平均wall |
|---|---:|---:|---:|---:|---:|---:|
| 30k fixed | 26 | 780,000 | 728,677 | 1.037s | 1.042s | 0.080s |
| 60k fixed | 26 | 1,560,000 | 1,444,425 | 1.998s | 2.001s | 0.154s |
| 120k fixed | 8 | 960,000 | 762,134 | 1.030s | 1.031s | 0.258s |
| MultiPV2 60k | 8 | 480,000 | 480,341 | 0.632s | 0.634s | 0.159s |

30k+60kのA/B比較は1局面あたりnominal 180,000 nodes、実測平均0.234秒。59局面へ同じ基本比較を適用した単純推定は約13.81秒。この値は今回の局面・CPU・単一threadでの実測外挿で、I/O・初期化・長い詰み探索・端末差を含む保証値ではない。120kとMultiPV2を全件へ掛ける設計にはしない。

## reason-branch-v1

専用JSONは`schema: reason-branch-v1` / `schemaVersion: 1`を維持し、各requestに以下を保存する。

- `position.sfen`, `userSide`, `actualMove`, `bestMove`
- profileごとのactual/recommended `score`, `pv`, `pvJa`, `bestReply`
- `searchNodes`, `nodesReported`, `engineTimeMs`, `wallTimeMs`, `nps`
- branch features、actual-only/shared/recommended-only、firstDifferencePly、materialDelta
- 30k/60k semantic keyのintersection/union/rate
- 必要例だけ、固定手後のMultiPV2応手と共通tactical events

生JSONはgit管理外の`reason-additional-search.raw.tmp`と`reason-additional-search.tmp`に保存した。production analysis JSONへの混入はない。

## Windows worker将来統合

方式は次のgate付きフローとして設計可能だが、worker本体にはまだ統合しない。

`通常解析 → problem抽出 → 既存Branch DifferenceでQ1/Q2不足判定 → 対象problemだけ30k A/B → 60k A/B → semantic difference一致時だけevidence保存 → 不一致時だけ重要度gateを通して120kまたは固定手後MultiPV2 → Human Review済みReasonだけ表示`

保存先はproduction analysis本体と分けたreason evidence artifactとし、engine/eval hash、各探索コスト、安定性を必須にする。今回25.18%しか一致しなかったため、自動production表示・59局面一括実行・全problem追加探索は見送る。

## 変更範囲

- `tools/reason_additional_search.py`: 固定手子局面探索、コスト保存、限定MultiPV2
- `tools/postprocess_reason_search.cjs`: 既存Branch Differenceによるevent alignment、安定性集計
- `tools/analyze_with_suisho5.py`: 既存返却値を壊さないUSI nodes/time/wall/nps取得と実験用MultiPV API
- Python/Node単体テスト、Human Review資料

UI、既存Reason表示、盤面マーカー、棋譜2行、手数表示、One-Screen、Pagesは変更していない。

## 検証

- Python unittest: 31/31成功
- Node test: 41/41成功
- Cloudflare worker: 5/5成功
- B-strict: 現行24局の最大loss 24/24、mate保有局16/16を保持
- 実機探索: 13局面の30k/60k、重要4局面の120k/MultiPV2完了
- `git diff --check`: 成功
