# SHOGI Reason Evidence Layer — TOP10 Human Review

## Review条件

- SSOT: `origin/main` / `HEAD` `7cd2453a45fd47ad2733365800870664531dab37`。
- 前回と同じ代表10局面。
- 盤面はSFENで固定し、既存の保存PV/限定追加探索artifactだけを使用。
- Codexによる棋理解釈、評価値による補完、追加探索は行わない。
- Evidence表記は `branch/type: piece from→to, target, ply [proof confidence / reason usability]`。全件validator pass。
- POSITION_FACT 6種は各枝に保持するが本文候補へ自動採用しない。以下ではPRIMARYとReason判断に関係するSUPPORTINGを列挙し、全型/件数は `node tools/audit_reason_evidence_layer.cjs --top10-digest` で再現できる。

## 1. ryunenbb vs sonao81 80手目

- 盤面: `ln+R5l/2sgS4/kppp1B1p1/p1N5p/3PBs1P1/2P2p2P/PP1SPG3/2KG5/LN6+r w G4Pnl 80`
- 実戦手: △5二金
- 推奨手: △7五桂打
- status: VALID
- Evidence一覧:
  - `actual/MATE_ENDPOINT: ▲8二金打, 6ply [HIGH / PRIMARY]`
  - `recommended/CHECK_SEQUENCE: 5・7・9ply [HIGH / SUPPORTING]`
  - `recommended/MATE_ENDPOINT: ▲7五飛打, 16ply [HIGH / PRIMARY]`
  - capture/check/drop/attack mapは双方に存在 `[HIGH / SUPPORTING]`。reply/capture/defender/escape/attacker count `[HIGH / NOT_USABLE]`。
- Current Reason: 「△5二金のあと、保存された読み筋では相手の王手が続き、▲8二龍まで詰み評価になります。」「この枝では、実戦枝と同じ詰み評価にはなっていません。」
- Evidence Candidate Reason: 「実戦手の読み筋では6plyで詰みまで到達します。」「推奨手の読み筋でも詰みは残りますが、保存された読み筋では16plyで詰みまで到達します。」
- Q1候補: ○
- Q2候補: ○
- UNRESOLVED: なし

## 2. sonao81 vs ak69Boy 131手目

- 盤面: `1n1+R5/1ks3R2/1pp2b3/1+b1p4p/l5pp1/4l3P/5PPP1/4P1GK1/1N5NL b 3G2SL2Psn5p 131`
- 実戦手: ▲同飛成
- 推奨手: ▲同龍
- status: VALID
- Evidence一覧:
  - `recommended/CHECK_AND_CAPTURE: ▲7二龍が7二銀をcapture+check, 1ply [HIGH / PRIMARY]`
  - `recommended/CHECK_SEQUENCE: 1・3ply [HIGH / PRIMARY]`
  - `recommended/MATE_ENDPOINT: ▲9二龍, 3ply [HIGH / PRIMARY]`
  - actual枝のcapture/checkは、actualが悪い因果を示さない `[HIGH / SUPPORTING]`。
- Current Reason: 「▲同飛成のあと、保存された読み筋の1手目に自分の手が王手になります。」「保存された推奨枝では王手を確認できます。」
- Evidence Candidate Reason: problem `UNRESOLVED`。recommended「推奨手の読み筋では3plyで詰みまで到達します。」
- Q1候補: ×
- Q2候補: ○
- UNRESOLVED: problem_reason

## 3. 夢への旅路 vs ぺるそなお 42手目

- 盤面: `lns2g2l/2kgr4/pppp1p3/6pbp/4Ss1p1/P1P3P1P/1PBPpPNP1/2G3SK1/LN2RG2L w Pn 42`
- 実戦手: △5六銀
- 推奨手: △3六銀
- status: VALID
- Evidence一覧: actual 2plyの歩capture、双方の後続capture/drop/promotion、初手後attack mapはすべて `[HIGH / SUPPORTING]`。POSITION countは `[HIGH / NOT_USABLE]`。PRIMARYなし。
- Current Reason: 「△5六銀のあと、保存された読み筋の2手目に相手の手が歩を取ります。」「推奨枝の方が歩3枚分多く残ります。」
- Evidence Candidate Reason: problem `UNRESOLVED` / recommended `UNRESOLVED`
- Q1候補: ×
- Q2候補: ×
- UNRESOLVED: ○

## 4. NAGATA2532 vs sonao81 28手目

- 盤面: `lns2g1nl/2kgr4/ppppspp1b/8p/7p1/P3R3P/1PPP1PPP1/LB1G1GKS1/1NS4NL w Pp 28`
- 実戦手: △4四銀
- 推奨手: △6八角成
- status: VALID
- Evidence一覧:
  - `actual/LEGAL_CAPTURE: ▲5二龍が5二飛をcapture, 2ply [HIGH / PRIMARY]`
  - recommendedの `△6八角成 ▲同銀` immediate recaptureは初手captureへの単純な取り返しで、推奨理由へは上げない `[HIGH / SUPPORTING]`。
  - その他capture/promotion/drop/attack map `[HIGH / SUPPORTING]`、POSITION count `[HIGH / NOT_USABLE]`。
- Current Reason: 「△4四銀のあと、保存された読み筋の2手目に相手の手が飛を取ります。」「保存された推奨枝では角が成る手を確認できます。」
- Evidence Candidate Reason: 「実戦手の読み筋では2ply目に▲5二龍が5二の飛を取ります。」 / recommended `UNRESOLVED`
- Q1候補: △
- Q2候補: ×
- UNRESOLVED: recommended_reason

## 5. ぺるそなお vs しゅん 79手目

- 盤面: `l2r3nk/7sl/3Ppg1pp/p1p3p2/7SP/P1P2p3/1G4PP1/1B3PSK1/L2+r1G1NL b GSN2Pbn2p 79`
- 実戦手: `S*5b`
- 推奨手: ▲2二馬
- status: VALID
- Evidence一覧: 推奨初手は銀capture+checkだが直後に△同玉で馬が取られるため、capture/check/check+capture/immediate recaptureをすべて `[HIGH / SUPPORTING]` に留めた。PRIMARYなし。POSITION count `[HIGH / NOT_USABLE]`。
- Current Reason: 「実戦手のあと、保存された読み筋の3手目に自分の手が飛を取ります。」「保存された推奨枝では角が成る手を確認できます。」
- Evidence Candidate Reason: problem `UNRESOLVED` / recommended `UNRESOLVED`
- Q1候補: ×
- Q2候補: ×
- UNRESOLVED: ○

## 6. 夢への旅路 vs ぺるそなお 50手目

- 盤面: `lns2g2l/2kgr4/pppp1p3/4P2bp/4S2p1/PBP1s1P1P/1P1PpPNP1/2G3SK1/LN2RG2L w np 50`
- 実戦手: △4二角
- 推奨手: △3五歩打
- status: VALID
- Evidence一覧:
  - `actual/LEGAL_CAPTURE: ▲4二馬が4二角をcapture, 2ply [HIGH / PRIMARY]`
  - actualの直後recapture、双方の後続capture/drop/promotion/attack map `[HIGH / SUPPORTING]`。
  - POSITION count `[HIGH / NOT_USABLE]`。
- Current Reason: 「△4二角のあと、保存された読み筋の2手目に相手の手が角を取ります。」「保存された推奨枝では歩を取る手を確認できます。」
- Evidence Candidate Reason: 「実戦手の読み筋では2ply目に▲4二馬が4二の角を取ります。」 / recommended `UNRESOLVED`
- Q1候補: △
- Q2候補: ×
- UNRESOLVED: recommended_reason

## 7. 夢への旅路 vs ぺるそなお 84手目

- 盤面: `lns1r3l/2k6/pppp1p3/4+r3p/4P4/P1P3PPP/1P1P1P+B2/2s3SK1/LN6L w BGP3gs2n2p 84`
- 実戦手: △6四龍
- 推奨手: △4四龍
- status: VALID
- Evidence一覧: actual 4plyの飛capture、5ply以降のcapture/check/check sequence、双方のattack mapは合法事実だが早期因果を示さず `[HIGH / SUPPORTING]`。PRIMARYなし。POSITION count `[HIGH / NOT_USABLE]`。
- Current Reason: 「△6四龍のあと、保存された読み筋の4手目に相手の手が飛を取ります。」「保存された推奨枝では歩を打つ手を確認できます。」
- Evidence Candidate Reason: problem `UNRESOLVED` / recommended `UNRESOLVED`
- Q1候補: ×
- Q2候補: ×
- UNRESOLVED: ○

## 8. sonao81 vs taatoru_cat 67手目

- 盤面: `lnkg2Rnl/2s1g4/2ppps3/pp6p/2P3p2/P4pPP1/3P2n1P/1+r2G2SK/L3P1G1L b BNPbs2p 67`
- 実戦手: `2h3g`
- 推奨手: ▲8三歩打
- status: VALID
- Evidence一覧: actual初手桂capture、後続capture/check/promotion/drop/check sequence、recommendedの後続capture等は `[HIGH / SUPPORTING]`。PRIMARYなし。POSITION count `[HIGH / NOT_USABLE]`。
- Current Reason: 「実戦手のあと、保存された読み筋の1手目に自分の手が桂を取ります。」「保存された推奨枝では歩を取る手を確認できます。」
- Evidence Candidate Reason: problem `UNRESOLVED` / recommended `UNRESOLVED`
- Q1候補: ×
- Q2候補: ×
- UNRESOLVED: ○

## 9. おまつ vs ぺるそなお 80手目

- 盤面: `lns4n1/2kg1+P1R1/ppppg4/5pp2/P3p1P1l/2PP5/1P1SP2+bP/2K1G4/LN1G3+rL w BS3Psn 80`
- 実戦手: `2a3c`
- 推奨手: △4六桂打
- status: VALID
- Evidence一覧: actual 4ply以降のcapture+check、後続check sequence、双方のcapture/drop/promotion/recaptureは `[HIGH / SUPPORTING]`。PRIMARYなし。POSITION count `[HIGH / NOT_USABLE]`。
- Current Reason: 「実戦手のあと、保存された読み筋の4手目に相手の手が王手になります。」「保存された推奨枝では銀が成る手を確認できます。」
- Evidence Candidate Reason: problem `UNRESOLVED` / recommended `UNRESOLVED`
- Q1候補: ×
- Q2候補: ×
- UNRESOLVED: ○

## 10. じゅんや vs ぺるそなお 44手目

- 盤面: `lns2g1nl/2kg3b1/pppp1ps2/7rp/3P2p2/2P2P1PP/PPBSPGPS1/1R4GK1/LN5NL w 2p 44`
- 実戦手: `3c4d`
- 推奨手: △3四銀
- status: VALID
- Evidence一覧: recommended 2ply `▲2二馬` の角captureと3ply `△2二飛` のrecaptureは、初手△3四銀との直接的なattack-map因果を満たさず `[HIGH / SUPPORTING]`。PRIMARYなし。POSITION count `[HIGH / NOT_USABLE]`。
- Current Reason: 「この手のあと評価が下がりました。」「保存された推奨枝では角が成る手を確認できます。」
- Evidence Candidate Reason: problem `UNRESOLVED` / recommended `UNRESOLVED`
- Q1候補: ×
- Q2候補: ×
- UNRESOLVED: ○

## 集計とgate判定

| 指標 | 件数 |
|---|---:|
| VALID | 10 |
| Q1候補 ○/△ | 1 / 2 |
| Q2候補 ○/△ | 2 / 0 |
| 両方UNRESOLVED | 6 |
| 片側UNRESOLVED | 3 |
| 両側candidate | 1 |

Human Review上、`VALID + HIGH/MEDIUM + PRIMARY` は必要条件として機能している。ただしPRIMARYであっても有限の1本の保存PVにしか立脚しないため、強制・唯一・優劣・得損へ拡張してはならない。NAGATA2532 28と夢への旅路50のQ1は具体的な早期capture事実として候補だが、推奨手の理由はUNRESOLVEDである。現gateをproductionへ接続せず、候補7件の個別採否を次Phaseで行う。
