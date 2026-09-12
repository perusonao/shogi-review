# SHOGI Reason Evidence Layer Phase 1 Result

## 結論

最新 `origin/main` / `HEAD` の `7cd2453a45fd47ad2733365800870664531dab37` を実装基準に、Evidence extractor、proof validator、schema、Reason Candidate、59局面 read-only audit、必須fixture testを shadow 実装した。`reason-evidence-layer.js` はproduction HTML/JavaScriptから読み込まれておらず、現行Reason UIと既存解析JSONは変更していない。

Evidenceの `proof_confidence` と `reason_usability` は独立フィールドである。盤面/PV上でHIGHの事実でも、候補手の優劣を説明しなければ `SUPPORTING` または `NOT_USABLE` に留める。

## 実装

- schema: `reason-evidence-layer-v1` / version 1。
- 必須フィールド: `type`, `branch`, `side`, `piece`, `from`, `to`, `target_piece`, `target_square`, `ply_distance`, `proof_confidence`, `reason_usability`, `proof`, `source_position`, `source_pv`。
- branch: `actual`, `recommended`, `shared`。
- status: `VALID`, `PARTIAL`, `INVALID`。
- Reason gate: `VALID AND proof_confidence in (HIGH, MEDIUM) AND reason_usability=PRIMARY AND validator pass`。
- `UNRESOLVED` は正常系。Q1/Q2を別々に `UNRESOLVED` にできる。
- 評価値とmate scoreはEvidence生成にもReason本文にも使用しない。

### TACTICAL_FACT

合法局面再生のみから次を生成する。

- `MATE_ENDPOINT`: PV全手が合法、終端が王手、終端局面の合法応手0。
- `CHECK`: 着手後に相手玉が攻撃される。
- `CHECK_SEQUENCE`: 保存PV上で同じ側の王手が2ply間隔で継続する。
- `LEGAL_CAPTURE`: 着手前のto squareに相手駒があり、合法着手で取得する。
- `IMMEDIATE_RECAPTURE`: capture直後、同じsquareでcapturerを合法に取り返す。
- `PROMOTION`: 合法な成り。
- `DROP`: 持駒、二歩、行き所、自己王手、打ち歩詰めを検査した合法な打ち。
- `CHECK_AND_CAPTURE`: 同じ合法手がcaptureとcheckを同時に満たす。

### POSITION_FACT

候補手を1手適用した直後の局面から次を生成する。

- `LEGAL_REPLY_COUNT`
- `LEGAL_CAPTURE_COUNT`
- `ATTACK_MAP`
- `DEFENDER_COUNT`
- `KING_ESCAPE_COUNT`
- `MOVED_PIECE_ATTACKERS`

これらはproofがHIGHでも主Reasonへ自動採用しない。`ATTACK_MAP` は `SUPPORTING`、他5種は `NOT_USABLE` がdefaultである。

## Validator

各Evidenceを元入力から独立に再計算する。SFENの9段/9筋、駒token、手番、持駒、玉、駒数上限を検査し、各move/PVを合法再生する。その上でpiece、from/to、target piece/square、capture、check、mate endpoint、promotion、drop、immediate recapture、check sequence、各POSITION_FACT countを再検証する。不一致EvidenceはReason候補から除外する。

## reason usability gate

- `PRIMARY`: 完全mate endpoint、推奨枝の完全な連続王手、推奨枝3ply以内のcheck+capture、actual枝2ply以内の相手による非歩captureなど、具体的な早期event。
- `SUPPORTING`: 合法だが、それだけでは優劣の理由にならないcapture/check/promotion/drop/attack map。交換は、初手着手駒が相手駒へ当たり、その相手駒が初手着手駒を取り、直後に取り返す3plyが揃う場合だけPRIMARYへ上げる。
- `NOT_USABLE`: legal reply/capture count、defender count、king escape count、moved piece attackers。shadow診断には保持するが本文に使わない。

このgateはHuman Review対象であり、「proofがHIGHだからReasonにも使える」という昇格を禁止する。

## 既存59局面 read-only audit

旧D64のうち両枝PVが各2手以上の5件を除いたD-C 59件を、既存game/analysis JSONだけで処理した。追加探索、既存局再解析、JSON更新はない。

| 指標 | 件数 |
|---|---:|
| 対象 | 59 |
| VALID | 57 |
| PARTIAL | 0 |
| INVALID | 2 |
| PRIMARY evidenceあり | 7 |
| SUPPORTINGのみ | 48 |
| NOT_USABLEのみ | 2 |
| UNRESOLVED | 52 |
| Q1改善候補 | 0 |
| Q2改善候補 | 7 |
| validator failure | 0 |

Q1が0なのは、このD-C群のactual枝が初手だけのものを中心とし、「実戦手が悪い理由」を保存データから証明できないためである。Q2の7件もproduction採用数ではなく、Human Review前のshadow候補数である。

### 入力不整合

| 局面 | status | validator結果 |
|---|---|---|
| あかね vs ぺるそなお 30 | INVALID | actual moveの移動元駒がSFENに存在しない |
| あかね vs ぺるそなお 86 | INVALID | actual moveの移動元駒がSFENに存在しない |

両件とも握りつぶさず、Evidence/Reason生成を禁止して `UNRESOLVED` にした。

## 必須fixture

| fixture | 証明済みEvidence | problem reason | recommended reason | Q1 | Q2 |
|---|---|---|---|:---:|:---:|
| しゅえい77 | actual 2ply `△7七馬` が7七の桂をcapture。recommended 1ply `▲8三歩打` がcheck | 「実戦手の読み筋では2ply目に△7七馬が7七の桂を取ります。」 | 「推奨手は初手の▲8三歩で王手になります。」 | △ | ○ |
| しゅえい79 | recommended初手 `▲6六角` のATTACK_MAPは7七馬。`△6六馬 ▲6六歩` はimmediate recapture | `UNRESOLVED` | 「▲6六角は7七の馬に当たり、保存PVでは△6六馬、▲6六歩で、その馬と角が盤上から消えます。」 | × | △ |
| しゅえい159 | actual完全PV終端は8ply mate。recommendedは1/3/5plyで先手check sequence | 「実戦手の読み筋では8plyで詰みまで到達します。」 | 「推奨手の読み筋では、保存PVの1・3・5ply目に先手の王手が続きます。」 | ○ | △ |
| ryunenbb80 | actual完全PVは6ply mate、recommended完全PVも16ply mate | 「実戦手の読み筋では6plyで詰みまで到達します。」 | 「推奨手の読み筋でも詰みは残りますが、保存された読み筋では16plyで詰みまで到達します。」 | ○ | ○ |

「優れている」「交換できるから良い」「推奨手なら詰み回避」「粘れる」は生成していない。

## Production境界

- productionへ追加可能な内部実装: `reason-evidence-layer.js`、validator、audit tool、tests。
- production非表示: Candidate Reason、UNRESOLVED文、Evidence debug情報。
- 現行 `reason-evidence.js`、`review-enhanced.js`、`index.html` は変更なし。
- `analysis/*.json`, `games/*.json`, `games/index.json` は変更なし。
- 追加nodes 0、再解析 0、Pages deployなし。

## 検証

- Evidence Layer unit/fixture: `node --test tests/reason_evidence_layer.test.cjs`
- 既存Node regression: `node --test tests/*.test.cjs`
- Python regression: `python -m pytest tests`
- Cloudflare: `npm test` in `backend/cloudflare`
- B-strict: `node tools/audit_selection_bstrict.cjs`
- 59 shadow audit: `node tools/audit_reason_evidence_layer.cjs --summary`
- whitespace: `git diff --check`

最終結果:

- Node: 51/51 passed。
- Python: 31/31 passed。
- Cloudflare: 5/5 passed。
- B-strict: current 26/26 max loss、mate保有18/18を維持。
- Evidence Layer専用: 10/10 passed。
- 59 shadow audit: 59件、validator failure 0。
- `git diff --check`: pass。

## 次Phase

Human ReviewでPRIMARY gateの7候補を採否判定する。合格Evidenceだけをproduction Reasonへ接続し、POSITION_FACTは引き続きshadowに置く。追加探索、既存JSON再解析、Reason UI変更は別Phaseの明示承認まで行わない。
