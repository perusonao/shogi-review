# 2026/09/10 sonao81 3局 水匠5解析 結果レポート

## 結論: 停止（エンジン未検出）

このセッションが動作しているのは**クラウド上の隔離コンテナ**であり、ユーザーの
ローカルPCとは別環境（コンテナはセッション開始時に毎回まっさらな状態でrepoを
clone し直す）。指示通りREAD-ONLYで既存のYaneuraOu/水匠5環境を探索したが、
このコンテナ内には存在しなかった。指示に従い、**推測での新規ダウンロードは行わず、
実際の評価値解析は実施せずに停止**した。

## base SHA

```
dc38c6bad21708e11470be94e199120bde54e6fa   (origin/main HEAD, このセッション開始時点)
```

作業ブランチ `claude/shogi-review-3games-analysis-9axe5t` は上記と同一コミットから
分岐しており、差分なしで最新化済みだった。

## 探索結果

| 確認項目 | 結果 |
|---|---|
| `git status` / branch / origin/main HEAD | クリーン。作業ブランチ=origin/main（差分なし） |
| README.md | 確認済み。「エンジン本体やnn.binはGit管理せず解析結果のみ永続化」方針を再確認 |
| docs/ADDING_GAMES.md | 確認済み。標準解析設定: `USI_OwnBook=false` / 30,000 nodes/position / `FV_SCALE=24`（水匠5公開設定）/ 評価値は先手視点で保存 |
| engine/ | `engine/README.md` のみ（想定配置例 `.local-engine/YaneuraOu-by-gcc`, `.local-engine/eval/nn.bin` を記載。実体は同梱されていない） |
| tools/ | `tools/kif_to_game.py`（KIF→PWA局面JSON変換、評価値は生成しない） |
| analysis/akane_20260910.json | 既存の実測30k解析データ（評価値16点＋課題4局面）を保持。破壊していない |
| games/index.json | 対象3局は登録済みだが `"analyzed": false`, `"status": "KIF保存済み・水匠5解析待ち"` のまま（過去セッションが正直に未解析と記録） |
| .github/workflows/build-game-data.yml | KIF→game JSON変換（`kif_to_game.py`）のみ。水匠5解析はCI上では行わない設計（想定通り、変更不要） |
| PC内のYaneuraOu実行ファイル / 水匠5 nn.bin | **見つからず**（`/`, `/root`, `/home`, `/opt`, `/usr/local` を`yaneuraou`/`suisho`/`水匠`/`nn.bin`で検索。`.local-engine/` ディレクトリ自体が存在しない） |
| あかね戦 analysis JSON schema / PWA読み込み仕様 | 確認済み（後述） |

### 確認した既存スキーマ

- `analysis/<id>.json`: `schemaVersion, gameId, date, sente, gote, userSide, result,
  moves, engine{name,nodesPerPosition,scorePerspective}, evaluations[{ply,cp}],
  verifiedIssues[{ply,played,best,lossCp,bestJa}]`
- `games/<id>.json`（PWAが直接読む対局データ。`data.json`と同形式）:
  `game{title,result,moves,date,side}, positions[{ply,sfen,last}], issues[{ply,move,best,loss,category,comment}]`
- PWA (`index.html`) は `games/index.json` → 各対局の `gameData`/`analysisData` を
  `fetch` し、`D.issues`（**game JSON側**の`issues[]`、`analysis`側の`verifiedIssues`ではない）
  を課題局面として描画する。赤矢印=`issue.move`の実戦手、緑矢印=`issue.best`(USI)から
  `moveLabel()`で自動生成した推奨手。この赤/緑ロジックには一切手を加えていない。

## 実施した作業（エンジン非依存の範囲のみ）

エンジンを起動せずに書けるもの、かつ実測値を一切捏造しないものに限定して用意した。

**新規: `tools/analyze_with_suisho5.py`**
ローカルPC（YaneuraOu+水匠5が実在する環境）で実行する一括解析スクリプト。
- USIプロトコルでエンジンを起動（`usi`→`setoption`→`isready`→`usinewgame`）
- `--engine`（実行ファイルパス）と `--eval-dir`（`nn.bin`があるディレクトリ）を
  **必須の外部引数**として要求し、スクリプト自身は一切バイナリを探索・ダウンロードしない
- 各局面を `go nodes 30000`（既定値。`docs/ADDING_GAMES.md`の標準解析条件に合わせた）
  で解析し、評価値を**先手視点**に統一して`evaluations[]`へ保存
- sonao81側の手番のみ、実戦手と水匠5推奨手の評価値差（損失）を算出し、
  閾値以上（既定300点、0件なら最大損失1件を必ず採用）を課題局面として抽出
  （`ply, played, best, before/after cp, lossCp, PV`）
- 推奨手は`python-shogi`の合法手リストと突き合わせて検証（非合法ならエラー停止）
- 実戦手の表示ラベル（`△23歩`等）は`python-shogi`の盤面から動かした駒種を実際に
  読み取って生成（既存`data.json`の表記規則を踏襲）
- 短い日本語コメントは、局面のフェーズ（序盤/中盤/終盤）と損失量のみを根拠にした
  テンプレートから生成し、エンジン結果と矛盾する断定的表現は含めない
- `analysis/<id>.json` と `games/<id>.json` を書き出す（`games/index.json`は
  安全のため自動更新しない。`--dry-run-out`で出力先を退避してのテストも可能）

**検証（このコンテナ内、実エンジンなしで可能な範囲）**
- ダミーUSIエンジン（`python-shogi`で合法手を1つ返すだけのテスト専用スタブ、
  リポジトリには含めていない）を使い、3局すべてで一括解析パイプラインを
  ドライラン（出力はリポジトリ外の一時ディレクトリへ）
  - 3 KIFすべて最後まで正常にパースできた（`taatoru_cat` 119手／`yogra` 67手／
    `aochikenmin` 76手。`games/index.json`記載の手数と一致）
  - `positions`の要素数 = 手数+1 で一致
  - 生成JSONは`json.load`で正常にパース可能
  - 抽出された「推奨手」はすべて`python-shogi`の合法手判定を通過
  - 課題局面は各局6件ずつ抽出（閾値・件数上限のロジックが機能することを確認。
    実数値はダミーエンジンの疑似スコアであり、実戦の評価とは無関係）
  - sente/gote符号: 先手番の局面はエンジンの`score cp`をそのまま、後手番は符号反転
    して保存するロジックを、手番ごとの符号で確認
- `git diff --check`: 空диff/末尾空白なし確認済み
- `analysis/akane_20260910.json`・`data.json`（あかね戦）は一切変更していない

## 実施しなかった作業（理由: エンジン未検出のため）

- A〜Hのうち、**実際の水匠5解析結果の生成（B, D, E, F, G）は未実施**。
  評価値・推奨手・PVを実測なしに書くと`docs/ADDING_GAMES.md`の
  「エンジン未解析の値を推測で埋めない」という明文規定に反するため。
- `analysis/20260910_*.json`（3局分）は既存の`"status": "pending"/"not_analyzed"`の
  手動所見付きプレースホルダーのまま変更していない。
- `games/index.json`の`"analyzed": false`は変更していない（PWA上はまだ「解析待ち」表示のまま）。
- `games/20260910_*.json`（PWA用局面データ）は生成していない
  （`kif_to_game.py`だけなら実行可能だが、`issues[]`が空のまま`analyzed:true`に
  見せかけることは避けた。過去のCI実行[`Build game data` run #1, workflow_dispatch,
  2026-09-10T00:35 UTC, success]でも`games/*.json`はmainへコミットされておらず、
  この生成自体も別途必要）。

## 検証結果まとめ

| 項目 | 結果 |
|---|---|
| 3 KIFすべて最後まで正常に読める | ✅（ダミーエンジンでのドライランで確認） |
| positionsの手数がKIFと一致 | ✅ |
| analysis JSONが正常 | ✅（生成コード・スキーマは検証済み。実測値は未生成） |
| 推奨手が合法手 | ✅（`python-shogi`で検証するコードを実装・テスト済み） |
| sonao81先手/後手の評価符号を取り違えていない | ✅（手番ベースの符号反転ロジックを確認） |
| PWAで3局が「解析済み」 | ❌ 未達（意図的に未実施。`games/index.json`は変更していない） |
| 各局で最低1つ以上の課題局面を開ける | ❌ 未達（同上。実測解析が前提） |
| 既存「あかね戦」を壊していない | ✅（`data.json`・`analysis/akane_20260910.json`は無変更） |
| `git diff --check` | ✅ |

## 未解決事項（ユーザー側の対応が必要）

1. ローカルPC上のYaneuraOu実行ファイルと水匠5`nn.bin`の**絶対パス**を教えてほしい。
   このクラウドセッションからはユーザーのローカルPCへアクセスできないため、
   実際の解析は次のいずれかで行う必要がある:
   - ユーザーが自分のPCで `tools/analyze_with_suisho5.py --engine <path> --eval-dir <path> --games 20260910_taatoru_cat 20260910_yogra 20260910_aochikenmin` を実行し、生成された`analysis/*.json`・`games/*.json`をコミット
   - またはローカル環境の情報（実行ファイルパス、nn.binパス、対応するOS/アーキテクチャ）を
     このセッションに伝えてもらえれば、スクリプトの調整や実行手順の詳細化は可能
2. `games/*.json`（PWA用局面データ）がmainに未生成（前回のworkflow_dispatch実行では
   コミットされていない）。水匠5解析と同時に`kif_to_game.py`実行も必要。
3. 上記1が完了し次第、`games/index.json`の`analyzed:true`化と`gameData`設定は
   別コミットで安全に行える。

## 生成/変更ファイル

- 追加: `tools/analyze_with_suisho5.py`
- 追加: `docs/reports/SHOGI_20260910_3GAMES_SUISHO5_Result.md`（本ファイル）
- 変更なし: `analysis/`, `games/index.json`, `games/*.json`, `data.json`, `index.html`

## commit SHA / push先

```
6d433e2ad1512f86f429faa9fb4f753997af4592
```

push先: `origin/claude/shogi-review-3games-analysis-9axe5t`
（mainへの直接pushは行っていない。指示書に「安全でなければ作業branchまでに留める」と
あり、かつハーネス側の運用ルールで本セッションの開発ブランチが
`claude/shogi-review-3games-analysis-9axe5t`に固定されているため）。

## PWA反映可否

**不可**。3局とも`games/index.json`上は引き続き`"analyzed": false`
（「KIF保存済み・水匠5解析待ち」）のまま。あかね戦の表示・動作に影響なし。
