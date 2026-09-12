# SHOGI Reason Explanation Phase 2 — 既存20局 Human Quality Audit

## 1. 結論

- 監査開始時に `git fetch` を実行し、`origin/main` と `HEAD` がともに `ab551dd290f4b157a640c6089116442093200c45` であることを確認した。このcommitを本監査のSSOTとして固定した。
- 対象はSSOTの20局・110 problem。保存済みgame/analysis JSONとPhase 1生成器だけを読んだ。水匠5の再解析、棋力判断、棋理推測は行っていない。
- Currentは A 16 / B 34 / C 10 / D 50 / E 0。危険な因果推論 E は0件。ただしDが50件、descriptive-only evidenceを「なぜ」の主根拠にしたものが25件あり、「事実」は正しくても次の一手改善材料として弱い。
- Candidate Phase 2は A 30 / B 16 / C 0 / D 64 / E 0。比較根拠を安全に言える46件だけ表示し、64件はReason省略とした。D増加は品質低下ではなく、根拠不足時に一般論を埋めない保守的判定である。
- 最重点の「次に確認すること」はCurrent 25件表示に対しCandidate 17件表示、93件省略。Currentのcapture確認11件のうち、枝間差と直後性を満たさないものはCandidateで落とした。
- captureは94件に存在するが、Candidateで主理由に採用できたものは13件だけ。PV途中に駒取りがあるという事実を、その手が悪い主因へ昇格させない。
- `ryunenbb` 80手目のCurrentは「金を動かしたから詰んだ」と述べず、Eではない。`mate -5` 対 `cp -7578` の枝比較も明示され、A判定。
- 推奨判定は「Phase 2 Candidate方針で実装前設計へ進む。ただしproduction反映前に代表10局面の人間確認を通す」。

監査中に別作業でrepositoryのmainが23局へfast-forwardされたことを検知した。対象混在を避けるため、監査開始時に確定した上記SSOTのtreeを読み直し、110件を再現した。現在のmainへcheckout/resetは行っていない。

## 2. 監査条件と判定規則

| 項目 | 内容 |
|---|---|
| repository | `perusonao/shogi-review` |
| 監査SSOT | `ab551dd290f4b157a640c6089116442093200c45` |
| 対象 | 20局 / 110 problem |
| 参照 | `SHOGI_REASON-EXPLANATION_ONESCREEN_PreImplementation_Audit.md`, `SHOGI_REASON-EXPLANATION_ONESCREEN_Phase1_Result.md` |
| 入力 | 保存済みSFEN、actual/recommended move、typed score、actual/recommended PV、Phase 1生成文 |
| 禁止事項 | 再解析、production変更、棋力判断、棋理推測、commit、push |

品質分類は文章とevidenceの対応だけで機械的に行った。

| 評価 | 本監査での機械的定義 |
|---|---|
| A | mate差、strict material差、または実戦直後の相手応手差を具体的に比較し、改善時の確認対象が明確 |
| B | 事実は正しいが、枝比較が限定的、または推奨側の特徴提示に留まる |
| C | 正しいが、同じevidenceを「なぜ」と「次に」等で反復 |
| D | 評価低下の一般文、PV途中の特徴だけ、または安全なReasonを表示できない |
| E | 保存データが証明しない原因・狙い・必然性を断定 |

evidence relevanceは次で固定した。

- `causal-safe`: typed mate差、または実戦枝2手目にだけある相手のcheck/capture。「この手の直後」「保存評価上」の範囲で因果的に記述可能。
- `comparative-safe`: strict material差、初手〜2手目で確認できる枝間のcheck/capture差、評価差。優劣の原因とは断定せず、枝比較としてだけ使用可能。
- `descriptive-only`: 両枝共通、3手目以降のPV event、promotion/drop単独など。存在は言えるが「悪かった理由」の主根拠にはしない。

## 3. Current / Candidate比較

| 指標 | Current | Candidate Phase 2 |
|---|---:|---:|
| A/B/C/D/E | A 16 / B 34 / C 10 / D 50 / E 0 | A 30 / B 16 / C 0 / D 64 / E 0 |
| Level 1/2/3 | 22 / 81 / 7 | 22 / 81 / 7（保存データ区分は不変） |
| 平均文章行数（110件分母） | 2.15 | 0.71 |
| 完全一致 | 9/110 (8.2%) | 4/46表示 (8.7%)、全110比 3.6% |
| ほぼ同一template | 68/110 (61.8%) | 24/46表示 (52.2%)、全110比 21.8% |
| 同一意味の欄間反復 | 10/110 (9.1%) | 0/110 (0.0%) |
| descriptive-only主理由 | 25/110 (22.7%) | 0/110 (0.0%) |
| 比較根拠あり | 16/110 (14.5%) | 46/110 (41.8%) |
| 「次に確認」表示 | 25 | 17 |
| Reason全体の省略 | 0 | 64 |

Candidateの平均0.71行は、64件を非表示にする設計を含む。表示46件だけなら平均 1.70 行。template率は表示母数も併記し、非表示64件を同一空templateとして数えていない。

### Current template頻度

複数該当可。110件中、「駒を取る」59件、「駒を取られる」11件、「王手」30件、「駒打ち」22件。最大templateは「評価が下がった＋推奨枝で歩を取る」で13件、mate比較templateは9件、Level 3の完全一致文は7件だった。

## 4. capture重点監査

capture evidenceを含む94件を、最大6ply内の両枝について排他的に分類した。

| capture状態 | 件数 | Candidateでの扱い |
|---|---:|---|
| 実戦枝だけで駒を失う | 21 | 直後2手以内の枝差だけ主理由候補 |
| 推奨枝だけで駒を取る | 45 | 直後2手以内だけ比較候補。原因とは断定しない |
| 両枝とも同じ駒を取る | 6 | descriptive-only。主理由から除外 |
| 取るタイミングだけ違う | 7 | descriptive-only。主理由から除外 |
| 単なるPV途中のcapture | 15 | descriptive-only。主理由から除外 |
| 合計 | 94 | 主理由採用13、非採用81 |

Phase 1のtype集計はcapture 94、check 18、promotion 18、drop 50、material 7、mate 15。event occurrence単位のrelevanceは causal-safe 28、comparative-safe 100、descriptive-only 715。大半のPV eventは事実として正しくてもReason relevanceを持たない。

## 5. 「次に確認すること」監査

Current表示25件は、mate連続王手9件、直後のcapture確認11件、直後のcheck確認5件。文自体に危険な因果推論はないが、Level 2の10件は「なぜ」と同じimmediate threatを繰り返すためCとした。

Candidateは、(a) 実戦枝のmate差と相手王手がある9件、(b) 実戦直後2手にだけ相手check/captureがある8件、合計17件だけ表示価値あり。残り93件は省略推奨。promotion、drop、推奨枝だけのcapture、3手目以降のcaptureから一般チェックリストを生成しない。

## 6. ryunenbb 80手目 fixture

| 項目 | 実戦枝 | 推奨枝 |
|---|---|---|
| 手 | △5二金 / `6b5b` | △7五桂打 / `N*7e` |
| score | `mate -5` | `cp -7578` |
| PV | △5二金 → ▲6六角 → △7五桂打 → ▲同角 → △8四香打 → ▲8二龍 | △7五桂打 → ▲同歩 → △6九龍 → ▲同玉 → △5二金 → ▲同角成 → △4七歩成 → ▲8二龍 → △8四玉 |

Current:

> 【なぜ良くなかった？】△5二金のあと、保存された読み筋では相手の王手が続き、▲8二龍まで詰み評価になります。
>
> 【推奨手では】水匠5は△7五桂打を選んでいます。この枝では、実戦枝と同じ詰み評価にはなっていません。
>
> 【次に確認すること】指す前に、相手の次の王手と、その次の自分の応手後も王手が続くか確認します。

判定A / Level 1。Currentは「金を動かしたから詰んだ」「守りが薄くなった」「△7五桂打で王手を続ける」と述べていない。実戦枝のmate評価と推奨枝の非mate評価を分けており、安全。Candidateはscore型を明記して同じ比較を保つ。

## 7. Human Review対象（代表10局面）

選定は差分の大きさとcoverageを優先した。mate / check / capture / promotion / drop / material、Level 1 / 2 / 3をすべて含む。

### 1. ryunenbb vs sonao81 80手目 — Current A → Candidate A

| 項目 | 内容 |
|---|---|
| Level / types | Level 1 / mate, check, capture, drop, immediate threat |
| 実戦 / 推奨 | △5二金 `6b5b` / △7五桂打 `N*7e` |
| 評価 | actual mate -5 / recommended cp -7578 / lossCp 22417 |
| actual PV | △5二金 → ▲6六角 → △7五桂打 → ▲同角 → △8四香打 → ▲8二龍 |
| recommended PV | △7五桂打 → ▲同歩 → △6九龍 → ▲同玉 → △5二金 → ▲同角成 → △4七歩成 → ▲8二龍 → △8四玉 |
| Current文章 | 【なぜ良くなかった？】△5二金のあと、保存された読み筋では相手の王手が続き、▲8二龍まで詰み評価になります。<br>【推奨手では】水匠5は△7五桂打を選んでいます。この枝では、実戦枝と同じ詰み評価にはなっていません。<br>【次に確認すること】指す前に、相手の次の王手と、その次の自分の応手後も王手が続くか確認します。 |
| Candidate文章 | 【なぜ良くなかった？】△5二金の実戦枝は保存評価がmate -5で、保存手順では相手の王手が続き、▲8二龍まで確認できます。<br>【推奨手では】△7五桂打の推奨枝はcp -7578で、実戦枝と同じmate評価ではありません。<br>【次に確認すること】指す前に、相手の次の王手と、その応手後も王手が続くかを確認します。 |
| 使用evidence | mate差、実戦枝の相手王手 |
| 省略evidence | actual capture 1手目、actual drop 3手目、actual check 4手目、actual capture 4手目、actual drop 5手目、actual check 6手目、recommended drop 1手目、recommended capture 2手目、recommended check 3手目、recommended capture 4手目、recommended capture 5手目、recommended capture 6手目、recommended promotion 6手目 |
| capture区分 | 取るタイミングだけ違う |

盤面（直前SFEN `ln+R5l/2sgS4/kppp1B1p1/p1N5p/3PBs1P1/2P2p2P/PP1SPG3/2KG5/LN6+r w G4Pnl 80`、上が後手側、筋は9→1）:

```
v香v桂 龍 ・ ・ ・ ・ ・v香
 ・ ・v銀v金 銀 ・ ・ ・ ・
v玉v歩v歩v歩 ・ 角 ・v歩 ・
v歩 ・ 桂 ・ ・ ・ ・ ・v歩
 ・ ・ ・ 歩 角v銀 ・ 歩 ・
 ・ ・ 歩 ・ ・v歩 ・ ・ 歩
 歩 歩 ・ 銀 歩 金 ・ ・ ・
 ・ ・ 玉 金 ・ ・ ・ ・ ・
 香 桂 ・ ・ ・ ・ ・ ・v龍
```

### 2. sonao81 vs ak69Boy 131手目 — Current B → Candidate A

| 項目 | 内容 |
|---|---|
| Level / types | Level 1 / mate, capture, promotion |
| 実戦 / 推奨 | ▲同飛成 `3b7b+` / ▲同龍 `6a7b` |
| 評価 | actual cp 7242 / recommended mate 3 / lossCp 22755 |
| actual PV | ▲同飛成 → △9三玉 → ▲8一龍寄 → △3九銀打 → ▲1七玉 → △9四玉 → ▲9二龍引 → △9三歩打 → ▲8五銀打 → △同玉 → ▲8六銀打 → △7六玉 → ▲7七銀打 → △6五玉 |
| recommended PV | ▲同龍 → △9三玉 → ▲9二龍 |
| Current文章 | 【なぜ良くなかった？】▲同飛成のあと、保存された読み筋の1手目に自分の手が王手になります。<br>【推奨手では】水匠5は▲同龍を選んでいます。保存された推奨枝では王手を確認できます。 |
| Candidate文章 | 【なぜ良くなかった？】▲同飛成の実戦枝はcp 7242、▲同龍の推奨枝はmate 3です。保存評価上、推奨枝にだけmate表示があります。<br>【推奨手では】推奨枝では1手目・3手目に自分の王手を確認できます。 |
| 使用evidence | mate差、推奨枝の王手 |
| 省略evidence | actual check 1手目、actual capture 1手目、actual promotion 1手目、actual capture 3手目、actual check 4手目、actual drop 4手目、recommended check 1手目、recommended capture 1手目、recommended check 3手目 |
| capture区分 | 両枝とも同じ駒を取る |

盤面（直前SFEN `1n1+R5/1ks3R2/1pp2b3/1+b1p4p/l5pp1/4l3P/5PPP1/4P1GK1/1N5NL b 3G2SL2Psn5p 131`、上が後手側、筋は9→1）:

```
 ・v桂 ・ 龍 ・ ・ ・ ・ ・
 ・v玉v銀 ・ ・ ・ 飛 ・ ・
 ・v歩v歩 ・ ・v角 ・ ・ ・
 ・v馬 ・v歩 ・ ・ ・ ・v歩
v香 ・ ・ ・ ・ ・v歩v歩 ・
 ・ ・ ・ ・v香 ・ ・ ・ 歩
 ・ ・ ・ ・ ・ 歩 歩 歩 ・
 ・ ・ ・ ・ 歩 ・ 金 玉 ・
 ・ 桂 ・ ・ ・ ・ ・ 桂 香
```

### 3. 夢への旅路 vs ぺるそなお 42手目 — Current A → Candidate A

| 項目 | 内容 |
|---|---|
| Level / types | Level 1 / capture, material, immediate threat |
| 実戦 / 推奨 | △5六銀 `4e5f` / △3六銀 `4e3f` |
| 評価 | actual cp 1450 / recommended cp 2398 / lossCp 948 |
| actual PV | △5六銀 → ▲2五桂 → △1五歩 → ▲同歩 → △3五歩 → ▲同歩 → △1五香 → ▲1六歩打 → △同香 |
| recommended PV | △3六銀 → ▲4八金 → △1五歩 → ▲5三歩打 → △同飛 → ▲1五歩 → △同香 → ▲5四歩打 → △5一飛 |
| Current文章 | 【なぜ良くなかった？】△5六銀のあと、保存された読み筋の2手目に相手の手が歩を取ります。<br>【推奨手では】同じ手数の保存手順では、推奨枝の方が歩4枚分多く残ります。<br>【次に確認すること】指した直後、相手に取られる駒がないか確認します。 |
| Candidate文章 | 【なぜ良くなかった？】同じ6手の保存手順を比べると、△5六銀の枝は△3六銀の枝より歩4枚分少なく残ります。 |
| 使用evidence | strict material差 |
| 省略evidence | actual capture 2手目、actual capture 4手目、actual capture 6手目、recommended drop 4手目、recommended capture 5手目、recommended capture 6手目 |
| capture区分 | 推奨枝だけで駒を取る |

盤面（直前SFEN `lns2g2l/2kgr4/pppp1p3/6pbp/4Ss1p1/P1P3P1P/1PBPpPNP1/2G3SK1/LN2RG2L w Pn 42`、上が後手側、筋は9→1）:

```
v香v桂v銀 ・ ・v金 ・ ・v香
 ・ ・v玉v金v飛 ・ ・ ・ ・
v歩v歩v歩v歩 ・v歩 ・ ・ ・
 ・ ・ ・ ・ ・ ・v歩v角v歩
 ・ ・ ・ ・ 銀v銀 ・v歩 ・
 歩 ・ 歩 ・ ・ ・ 歩 ・ 歩
 ・ 歩 角 歩v歩 歩 桂 歩 ・
 ・ ・ 金 ・ ・ ・ 銀 玉 ・
 香 桂 ・ ・ 飛 金 ・ ・ 香
```

### 4. NAGATA2532 vs sonao81 28手目 — Current C → Candidate A

| 項目 | 内容 |
|---|---|
| Level / types | Level 2 / capture, promotion, immediate threat |
| 実戦 / 推奨 | △4四銀 `5c4d` / △6八角成 `1c6h+` |
| 評価 | actual cp 241 / recommended cp 706 / lossCp 465 |
| actual PV | △4四銀 → ▲5二飛成 → △同金右 → ▲6九金 → △3四歩 → ▲2三飛打 → △3三桂 → ▲2一飛成 |
| recommended PV | △6八角成 → ▲同銀 → △7八金打 → ▲7九角 → △4四銀 → ▲5三歩打 → △2二飛 → ▲8六飛 → △7九金 → ▲同銀 → △5三銀 |
| Current文章 | 【なぜ良くなかった？】△4四銀のあと、保存された読み筋の2手目に相手の手が飛を取ります。<br>【推奨手では】水匠5は△6八角成を選んでいます。保存された推奨枝では角が成る手を確認できます。<br>【次に確認すること】指した直後、相手に取られる駒がないか確認します。 |
| Candidate文章 | 【なぜ良くなかった？】△4四銀の直後、実戦枝では相手の飛を取る手があります。推奨枝の同じ位置にはこの差がありません。<br>【次に確認すること】候補手ごとに、直後に相手が取れる駒を確認します。 |
| 使用evidence | 実戦枝2手目のcapture差 |
| 省略evidence | actual promotion 2手目、actual capture 3手目、actual drop 6手目、recommended promotion 1手目、recommended drop 3手目、recommended drop 6手目 |
| capture区分 | 実戦枝だけで駒を失う |

盤面（直前SFEN `lns2g1nl/2kgr4/ppppspp1b/8p/7p1/P3R3P/1PPP1PPP1/LB1G1GKS1/1NS4NL w Pp 28`、上が後手側、筋は9→1）:

```
v香v桂v銀 ・ ・v金 ・v桂v香
 ・ ・v玉v金v飛 ・ ・ ・ ・
v歩v歩v歩v歩v銀v歩v歩 ・v角
 ・ ・ ・ ・ ・ ・ ・ ・v歩
 ・ ・ ・ ・ ・ ・ ・v歩 ・
 歩 ・ ・ ・ 飛 ・ ・ ・ 歩
 ・ 歩 歩 歩 ・ 歩 歩 歩 ・
 香 角 ・ 金 ・ 金 玉 銀 ・
 ・ 桂 銀 ・ ・ ・ ・ 桂 香
```

### 5. ぺるそなお vs しゅん 79手目 — Current D → Candidate B

| 項目 | 内容 |
|---|---|
| Level / types | Level 2 / check, capture, promotion |
| 実戦 / 推奨 | 実戦手 (S*5b) `S*5b` / ▲22馬 `8h2b+` |
| 評価 | actual unknown / recommended unknown / lossCp 1587 |
| actual PV | なし |
| recommended PV | 8h2b+ → 1a2b → S*5b → 4f4g+ → 5b4c+ → B*3i → 2h3i → 4g3h → 3i3h → B*6e → B*4g → 6e4g+ → 4h4g → 6i4i → 3h4i → N*5g → 4i3i → S*3h → 3i3h → B*4i → 3h2h |
| Current文章 | 【なぜ良くなかった？】この手のあと評価が下がりました。保存データから確認できる差だけを表示します。<br>【推奨手では】水匠5は▲22馬を選んでいます。保存された推奨枝では角が成る手を確認できます。 |
| Candidate文章 | 【なぜ良くなかった？】保存手順の初手では、実戦手は王手ではなく、▲22馬は王手です。 |
| 使用evidence | 推奨初手だけcheck |
| 省略evidence | actual drop 1手目、recommended promotion 1手目、recommended drop 3手目、recommended promotion 4手目、recommended capture 5手目、recommended promotion 5手目、recommended check 6手目、recommended drop 6手目 |
| capture区分 | 推奨枝だけで駒を取る |

盤面（直前SFEN `l2r3nk/7sl/3Ppg1pp/p1p3p2/7SP/P1P2p3/1G4PP1/1B3PSK1/L2+r1G1NL b GSN2Pbn2p 79`、上が後手側、筋は9→1）:

```
v香 ・ ・v飛 ・ ・ ・v桂v玉
 ・ ・ ・ ・ ・ ・ ・v銀v香
 ・ ・ ・ 歩v歩v金 ・v歩v歩
v歩 ・v歩 ・ ・ ・v歩 ・ ・
 ・ ・ ・ ・ ・ ・ ・ 銀 歩
 歩 ・ 歩 ・ ・v歩 ・ ・ ・
 ・ 金 ・ ・ ・ ・ 歩 歩 ・
 ・ 角 ・ ・ ・ 歩 銀 玉 ・
 香 ・ ・v龍 ・ 金 ・ 桂 香
```

### 6. 夢への旅路 vs ぺるそなお 50手目 — Current C → Candidate A

| 項目 | 内容 |
|---|---|
| Level / types | Level 2 / capture, drop, immediate threat |
| 実戦 / 推奨 | △4二角 `2d4b` / △3五歩打 `P*3e` |
| 評価 | actual cp 470 / recommended cp 2101 / lossCp 1631 |
| actual PV | △4二角 → ▲同角成 → △同金 → ▲2三角打 → △6五銀 → ▲4五角成 → △1二角打 → ▲4六馬 → △1五歩 → ▲同歩 → △5四銀 → ▲同銀 → △同飛 → ▲7七桂 → △4四桂打 → ▲5五歩打 → △6四飛 → ▲5七飛 |
| recommended PV | △3五歩打 → ▲2五桂 → △3六歩 → ▲4六歩 → △1五歩 → ▲同歩 → △同香 → ▲4八金 → △3五桂打 → ▲1六歩打 → △同香 → ▲同香 |
| Current文章 | 【なぜ良くなかった？】△4二角のあと、保存された読み筋の2手目に相手の手が角を取ります。<br>【推奨手では】水匠5は△3五歩打を選んでいます。保存された推奨枝では歩を取る手を確認できます。<br>【次に確認すること】指した直後、相手に取られる駒がないか確認します。 |
| Candidate文章 | 【なぜ良くなかった？】△4二角の直後、実戦枝では相手の角を取る手があります。推奨枝の同じ位置にはこの差がありません。<br>【次に確認すること】候補手ごとに、直後に相手が取れる駒を確認します。 |
| 使用evidence | 実戦枝2手目のcapture差 |
| 省略evidence | actual promotion 2手目、actual capture 3手目、actual drop 4手目、actual promotion 6手目、recommended drop 1手目、recommended capture 3手目、recommended capture 6手目 |
| capture区分 | 実戦枝だけで駒を失う |

盤面（直前SFEN `lns2g2l/2kgr4/pppp1p3/4P2bp/4S2p1/PBP1s1P1P/1P1PpPNP1/2G3SK1/LN2RG2L w np 50`、上が後手側、筋は9→1）:

```
v香v桂v銀 ・ ・v金 ・ ・v香
 ・ ・v玉v金v飛 ・ ・ ・ ・
v歩v歩v歩v歩 ・v歩 ・ ・ ・
 ・ ・ ・ ・ 歩 ・ ・v角v歩
 ・ ・ ・ ・ 銀 ・ ・v歩 ・
 歩 角 歩 ・v銀 ・ 歩 ・ 歩
 ・ 歩 ・ 歩v歩 歩 桂 歩 ・
 ・ ・ 金 ・ ・ ・ 銀 玉 ・
 香 桂 ・ ・ 飛 金 ・ ・ 香
```

### 7. 夢への旅路 vs ぺるそなお 84手目 — Current B → Candidate D

| 項目 | 内容 |
|---|---|
| Level / types | Level 2 / capture |
| 実戦 / 推奨 | △6四龍 `5d6d` / △4四龍 `5d4d` |
| 評価 | actual cp 3104 / recommended cp 4592 / lossCp 1488 |
| actual PV | △6四龍 → ▲4二角打 → △4五桂打 → ▲5一角成 → △3七桂成 → ▲同銀 → △2七歩打 → ▲同玉 → △4九角打 → ▲3八桂打 → △6二金打 → ▲3二飛打 → △5二歩打 → ▲2八金打 → △8九銀不成 → ▲1五歩 → △同歩 |
| recommended PV | △4四龍 → ▲3五金打 → △4五桂打 → ▲4四金 → △3七桂成 → ▲同銀 → △4四歩 → ▲7五桂打 → △4九角打 → ▲3二飛打 → △6二金打 |
| Current文章 | 【なぜ良くなかった？】△6四龍のあと、保存された読み筋の4手目に相手の手が飛を取ります。<br>【推奨手では】水匠5は△4四龍を選んでいます。保存された推奨枝では飛を取る手を確認できます。 |
| Candidate文章 | 全Reasonブロック省略推奨 |
| 使用evidence | Reason省略 |
| 省略evidence | actual drop 2手目、actual drop 3手目、actual capture 4手目、actual promotion 4手目、actual check 5手目、actual capture 5手目、actual promotion 5手目、actual capture 6手目、recommended drop 2手目、recommended drop 3手目、recommended capture 4手目、recommended check 5手目、recommended capture 5手目、recommended promotion 5手目、recommended capture 6手目 |
| capture区分 | 両枝とも同じ駒を取る |

盤面（直前SFEN `lns1r3l/2k6/pppp1p3/4+r3p/4P4/P1P3PPP/1P1P1P+B2/2s3SK1/LN6L w BGP3gs2n2p 84`、上が後手側、筋は9→1）:

```
v香v桂v銀 ・v飛 ・ ・ ・v香
 ・ ・v玉 ・ ・ ・ ・ ・ ・
v歩v歩v歩v歩 ・v歩 ・ ・ ・
 ・ ・ ・ ・v龍 ・ ・ ・v歩
 ・ ・ ・ ・ 歩 ・ ・ ・ ・
 歩 ・ 歩 ・ ・ ・ 歩 歩 歩
 ・ 歩 ・ 歩 ・ 歩 馬 ・ ・
 ・ ・v銀 ・ ・ ・ 銀 玉 ・
 香 桂 ・ ・ ・ ・ ・ ・ 香
```

### 8. sonao81 vs taatoru_cat 67手目 — Current B → Candidate D

| 項目 | 内容 |
|---|---|
| Level / types | Level 2 / capture, drop |
| 実戦 / 推奨 | 実戦手 (2h3g) `2h3g` / ▲83歩打 `P*8c` |
| 評価 | actual unknown / recommended unknown / lossCp 847 |
| actual PV | なし |
| recommended PV | P*8c → 7b8c → B*5f → S*7b → 3a2a+ → 3e3f → 1g1f → P*2g → 2h2g → B*4g |
| Current文章 | 【なぜ良くなかった？】実戦手のあと、保存された読み筋の1手目に自分の手が桂を取ります。<br>【推奨手では】水匠5は▲83歩打を選んでいます。保存された推奨枝では歩を取る手を確認できます。 |
| Candidate文章 | 全Reasonブロック省略推奨 |
| 使用evidence | Reason省略 |
| 省略evidence | actual capture 1手目、recommended drop 1手目、recommended drop 3手目、recommended drop 4手目、recommended capture 5手目、recommended promotion 5手目、recommended capture 6手目 |
| capture区分 | 取るタイミングだけ違う |

盤面（直前SFEN `lnkg2Rnl/2s1g4/2ppps3/pp6p/2P3p2/P4pPP1/3P2n1P/1+r2G2SK/L3P1G1L b BNPbs2p 67`、上が後手側、筋は9→1）:

```
v香v桂v玉v金 ・ ・ 飛v桂v香
 ・ ・v銀 ・v金 ・ ・ ・ ・
 ・ ・v歩v歩v歩v銀 ・ ・ ・
v歩v歩 ・ ・ ・ ・ ・ ・v歩
 ・ ・ 歩 ・ ・ ・v歩 ・ ・
 歩 ・ ・ ・ ・v歩 歩 歩 ・
 ・ ・ ・ 歩 ・ ・v桂 ・ 歩
 ・v龍 ・ ・ 金 ・ ・ 銀 玉
 香 ・ ・ ・ 歩 ・ 金 ・ 香
```

### 9. おまつ vs ぺるそなお 80手目 — Current D → Candidate D

| 項目 | 内容 |
|---|---|
| Level / types | Level 2 / drop |
| 実戦 / 推奨 | 実戦手 (2a3c) `2a3c` / △46桂打 `N*4f` |
| 評価 | actual unknown / recommended unknown / lossCp 1700 |
| actual PV | なし |
| recommended PV | N*4f → B*6e |
| Current文章 | 【なぜ良くなかった？】この手のあと評価が下がりました。保存データから確認できる差だけを表示します。<br>【推奨手では】水匠5は△46桂打を選んでいます。保存された推奨枝では桂を打つ手を確認できます。 |
| Candidate文章 | 全Reasonブロック省略推奨 |
| 使用evidence | Reason省略 |
| 省略evidence | recommended drop 1手目、recommended drop 2手目 |
| capture区分 | なし |

盤面（直前SFEN `lns4n1/2kg1+P1R1/ppppg4/5pp2/P3p1P1l/2PP5/1P1SP2+bP/2K1G4/LN1G3+rL w BS3Psn 80`、上が後手側、筋は9→1）:

```
v香v桂v銀 ・ ・ ・ ・v桂 ・
 ・ ・v玉v金 ・ と ・ 飛 ・
v歩v歩v歩v歩v金 ・ ・ ・ ・
 ・ ・ ・ ・ ・v歩v歩 ・ ・
 歩 ・ ・ ・v歩 ・ 歩 ・v香
 ・ ・ 歩 歩 ・ ・ ・ ・ ・
 ・ 歩 ・ 銀 歩 ・ ・v馬 歩
 ・ ・ 玉 ・ 金 ・ ・ ・ ・
 香 桂 ・ 金 ・ ・ ・v龍 香
```

### 10. じゅんや vs ぺるそなお 44手目 — Current D → Candidate D

| 項目 | 内容 |
|---|---|
| Level / types | Level 3 / - |
| 実戦 / 推奨 | 実戦手 (3c4d) `3c4d` / △34銀 `3c3d` |
| 評価 | actual unknown / recommended unknown / lossCp 919 |
| actual PV | なし |
| recommended PV | 3c3d |
| Current文章 | 【なぜ良くなかった？】この手のあと評価が大きく下がりました。保存された読み筋だけでは、原因を一つに特定できません。 |
| Candidate文章 | 全Reasonブロック省略推奨 |
| 使用evidence | Reason省略 |
| 省略evidence | なし |
| capture区分 | なし |

盤面（直前SFEN `lns2g1nl/2kg3b1/pppp1ps2/7rp/3P2p2/2P2P1PP/PPBSPGPS1/1R4GK1/LN5NL w 2p 44`、上が後手側、筋は9→1）:

```
v香v桂v銀 ・ ・v金 ・v桂v香
 ・ ・v玉v金 ・ ・ ・v角 ・
v歩v歩v歩v歩 ・v歩v銀 ・ ・
 ・ ・ ・ ・ ・ ・ ・v飛v歩
 ・ ・ ・ 歩 ・ ・v歩 ・ ・
 ・ ・ 歩 ・ ・ 歩 ・ 歩 歩
 歩 歩 角 銀 歩 金 歩 銀 ・
 ・ 飛 ・ ・ ・ ・ 金 玉 ・
 香 桂 ・ ・ ・ ・ ・ 桂 香
```

## 8. 全110 problem監査一覧

evidence表記は `type:branch@pvPly/relevance`。`Causal` = causal-safe、`Comp` = comparative-safe、`Desc` = descriptive-only。各PV eventを省略せず圧縮表示した。「次」監査はCandidateにおける表示価値判定。

| # | 対局 / 手目 | L | evidence type | Current | Candidate | Current主根拠 | 次 Current | 次 監査 | capture | Candidate使用根拠 | evidence relevance |
|---:|---|---:|---|---:|---:|---|---|---|---|---|---|
| 1 | 夢への旅路 vs ぺるそなお / 42 | 1 | capture,material,immediate threat | A | A | descriptive-only | 表示 | 省略推奨 | 推奨枝だけで駒を取る | strict material差 | material:comparison/Comp、capture:actual@2/Desc、capture:actual@4/Desc、capture:actual@6/Desc、capture:recommended@1/Comp、drop:recommended@4/Desc、capture:recommended@5/Desc、capture:recommended@6/Desc |
| 2 | 夢への旅路 vs ぺるそなお / 50 | 2 | capture,drop,immediate threat | C | A | causal-safe | 表示 | 表示価値あり | 実戦枝だけで駒を失う | 実戦枝2手目のcapture差 | capture:actual@2/Causal、promotion:actual@2/Desc、capture:actual@3/Desc、drop:actual@4/Desc、promotion:actual@6/Desc、drop:recommended@1/Desc、capture:recommended@2/Comp、capture:recommended@3/Desc、capture:recommended@6/Desc |
| 3 | 夢への旅路 vs ぺるそなお / 84 | 2 | capture | B | D | descriptive-only | なし | 省略推奨 | 両枝とも同じ駒を取る | Reason省略 | drop:actual@2/Desc、drop:actual@3/Desc、capture:actual@4/Desc、promotion:actual@4/Desc、check:actual@5/Desc、capture:actual@5/Desc、promotion:actual@5/Desc、capture:actual@6/Desc、drop:recommended@2/Desc、drop:recommended@3/Desc、capture:recommended@4/Desc、check:recommended@5/Desc、capture:recommended@5/Desc、promotion:recommended@5/Desc、capture:recommended@6/Desc |
| 4 | 夢への旅路 vs ぺるそなお / 94 | 2 | capture,drop | B | D | descriptive-only | なし | 省略推奨 | 実戦枝だけで駒を失う | Reason省略 | drop:actual@1/Desc、promotion:actual@2/Desc、capture:actual@4/Desc、capture:actual@5/Desc、drop:actual@6/Desc、drop:recommended@1/Desc、drop:recommended@3/Desc、capture:recommended@4/Desc、check:recommended@5/Desc、capture:recommended@5/Desc、promotion:recommended@5/Desc、capture:recommended@6/Desc |
| 5 | 夢への旅路 vs ぺるそなお / 130 | 2 | capture,drop,immediate threat | C | D | descriptive-only | 表示 | 省略推奨 | 両枝とも同じ駒を取る | Reason省略 | drop:actual@1/Desc、check:actual@2/Desc、capture:actual@2/Desc、capture:actual@3/Desc、check:actual@4/Desc、drop:actual@4/Desc、drop:actual@6/Desc、drop:recommended@1/Desc、check:recommended@2/Desc、capture:recommended@2/Desc、capture:recommended@3/Desc、check:recommended@4/Desc、drop:recommended@4/Desc |
| 6 | 夢への旅路 vs ぺるそなお / 134 | 1 | capture,promotion,drop,material,immediate threat | A | A | descriptive-only | 表示 | 省略推奨 | 実戦枝だけで駒を失う | strict material差 | material:comparison/Comp、check:actual@1/Desc、capture:actual@1/Desc、promotion:actual@1/Desc、capture:actual@2/Desc、check:actual@3/Desc、drop:actual@4/Desc、drop:actual@5/Desc、capture:actual@6/Desc、drop:recommended@1/Desc、check:recommended@3/Desc、capture:recommended@3/Desc、promotion:recommended@3/Desc、capture:recommended@4/Desc、check:recommended@5/Desc、drop:recommended@5/Desc |
| 7 | 準Oni vs ぺるそなお / 42 | 2 | capture,immediate threat | C | A | causal-safe | 表示 | 表示価値あり | 実戦枝だけで駒を失う | 実戦枝2手目のcheck差 | capture:actual@1/Desc、check:actual@2/Causal、capture:actual@2/Causal、capture:actual@3/Desc、drop:actual@4/Desc、drop:actual@5/Desc、capture:actual@6/Desc、promotion:actual@6/Desc、capture:recommended@3/Desc |
| 8 | 準Oni vs ぺるそなお / 50 | 1 | capture,material,immediate threat | A | A | causal-safe | 表示 | 省略推奨 | 推奨枝だけで駒を取る | strict material差 | material:comparison/Comp、check:actual@2/Causal、drop:actual@2/Desc、capture:actual@4/Desc、drop:actual@5/Desc、drop:recommended@2/Desc、drop:recommended@3/Desc、capture:recommended@4/Desc、promotion:recommended@4/Desc、capture:recommended@5/Desc、promotion:recommended@6/Desc |
| 9 | 準Oni vs ぺるそなお / 52 | 2 | capture,drop,immediate threat | C | A | causal-safe | 表示 | 表示価値あり | 実戦枝だけで駒を失う | 実戦枝2手目のcheck差 | drop:actual@1/Desc、check:actual@2/Causal、drop:actual@2/Desc、capture:actual@4/Desc、drop:actual@5/Desc、drop:recommended@1/Desc、capture:recommended@2/Comp |
| 10 | 準Oni vs ぺるそなお / 54 | 2 | check,capture,drop,immediate threat | C | B | descriptive-only | 表示 | 省略推奨 | 実戦枝だけで駒を失う | 推奨初手だけcheck | drop:actual@1/Desc、capture:actual@2/Desc、promotion:actual@2/Desc、drop:actual@3/Desc、capture:actual@4/Desc、capture:actual@5/Desc、capture:actual@6/Desc、check:recommended@1/Comp、drop:recommended@1/Desc、capture:recommended@2/Comp、capture:recommended@4/Desc、promotion:recommended@4/Desc、capture:recommended@5/Desc、check:recommended@6/Desc、drop:recommended@6/Desc |
| 11 | 準Oni vs ぺるそなお / 74 | 1 | mate,check,capture,immediate threat | A | A | causal-safe | 表示 | 表示価値あり | 実戦枝だけで駒を失う | mate差,実戦枝の相手王手 | mate:comparison/Causal、check:actual@2/Desc、drop:actual@2/Desc、check:actual@4/Desc、drop:actual@4/Desc、capture:actual@5/Desc、check:actual@6/Desc、capture:actual@6/Desc、check:recommended@2/Desc、drop:recommended@2/Desc、check:recommended@4/Desc、check:recommended@6/Desc、drop:recommended@6/Desc |
| 12 | 準Oni vs ぺるそなお / 80 | 1 | mate,check,capture,immediate threat | A | A | causal-safe | 表示 | 表示価値あり | 推奨枝だけで駒を取る | mate差,実戦枝の相手王手 | mate:comparison/Causal、capture:actual@1/Comp、check:actual@2/Desc、drop:actual@2/Desc、capture:actual@3/Desc、check:actual@4/Desc、drop:actual@4/Desc、capture:recommended@1/Desc、capture:recommended@2/Comp、drop:recommended@3/Desc、capture:recommended@4/Desc、capture:recommended@5/Desc、check:recommended@6/Desc、drop:recommended@6/Desc |
| 13 | ぺるそなお vs レンレン / 99 | 1 | mate,check,capture,immediate threat | A | A | causal-safe | 表示 | 表示価値あり | 取るタイミングだけ違う | mate差,実戦枝の相手王手 | mate:comparison/Causal、drop:actual@1/Desc、check:actual@2/Desc、capture:actual@2/Desc、promotion:actual@2/Desc、capture:actual@3/Desc、check:actual@4/Desc、capture:actual@4/Desc、promotion:actual@4/Desc、capture:actual@5/Desc、check:actual@6/Desc、check:recommended@2/Desc、drop:recommended@2/Desc、capture:recommended@4/Desc、drop:recommended@5/Desc、check:recommended@6/Desc、capture:recommended@6/Desc、promotion:recommended@6/Desc |
| 14 | ぺるそなお vs レンレン / 101 | 1 | mate,check,capture,immediate threat | A | A | causal-safe | 表示 | 表示価値あり | 両枝とも同じ駒を取る | mate差,実戦枝の相手王手 | mate:comparison/Causal、check:actual@2/Desc、capture:actual@2/Desc、promotion:actual@2/Desc、capture:actual@3/Desc、check:actual@4/Desc、capture:actual@4/Desc、promotion:actual@4/Desc、capture:actual@5/Desc、check:actual@6/Desc、check:recommended@2/Desc、capture:recommended@2/Desc、promotion:recommended@2/Desc、capture:recommended@3/Desc、check:recommended@4/Desc、capture:recommended@4/Desc、promotion:recommended@4/Desc、capture:recommended@5/Desc、check:recommended@6/Desc |
| 15 | ぺるそなお vs レンレン / 139 | 1 | mate,check,capture,immediate threat | A | A | causal-safe | 表示 | 表示価値あり | 実戦枝だけで駒を失う | mate差,実戦枝の相手王手 | mate:comparison/Causal、capture:actual@1/Desc、check:actual@2/Desc、capture:actual@2/Desc、capture:actual@3/Desc、check:actual@4/Desc、drop:actual@5/Desc、check:actual@6/Desc、capture:actual@6/Desc、capture:recommended@2/Desc、drop:recommended@3/Desc、check:recommended@4/Desc、capture:recommended@4/Desc、capture:recommended@5/Desc |
| 16 | ぺるそなお vs レンレン / 149 | 1 | mate,check,capture,drop,immediate threat | A | A | causal-safe | 表示 | 表示価値あり | 推奨枝だけで駒を取る | mate差,実戦枝の相手王手 | mate:comparison/Causal、check:actual@2/Desc、capture:actual@2/Desc、check:actual@4/Desc、drop:actual@4/Desc、check:actual@6/Desc、drop:actual@6/Desc、drop:recommended@1/Desc、capture:recommended@2/Comp、check:recommended@3/Desc、capture:recommended@3/Desc、capture:recommended@4/Desc、capture:recommended@5/Desc、check:recommended@6/Desc、capture:recommended@6/Desc |
| 17 | ぺるそなお vs レンレン / 161 | 1 | mate,check,capture,immediate threat | A | A | causal-safe | 表示 | 表示価値あり | 推奨枝だけで駒を取る | mate差,実戦枝の相手王手 | mate:comparison/Causal、capture:actual@1/Comp、check:actual@2/Desc、drop:actual@2/Desc、capture:actual@3/Desc、check:actual@4/Desc、drop:actual@4/Desc、check:actual@6/Desc、drop:actual@6/Desc、check:recommended@1/Comp、check:recommended@4/Desc、drop:recommended@4/Desc、capture:recommended@5/Desc、check:recommended@6/Desc、drop:recommended@6/Desc |
| 18 | ぺるそなお vs レンレン / 163 | 1 | mate,check,capture,immediate threat | A | A | causal-safe | 表示 | 表示価値あり | 推奨枝だけで駒を取る | mate差,実戦枝の相手王手 | mate:comparison/Causal、check:actual@2/Desc、drop:actual@2/Desc、capture:actual@3/Desc、check:actual@4/Desc、drop:actual@4/Desc、check:actual@6/Desc、drop:actual@6/Desc、capture:recommended@1/Comp、check:recommended@2/Desc、drop:recommended@2/Desc、check:recommended@4/Desc、capture:recommended@4/Desc、promotion:recommended@4/Desc、capture:recommended@5/Desc、check:recommended@6/Desc、capture:recommended@6/Desc |
| 19 | ryunenbb vs sonao81 / 44 | 2 | capture,immediate threat | C | A | causal-safe | 表示 | 表示価値あり | 実戦枝だけで駒を失う | 実戦枝2手目のcapture差 | capture:actual@2/Causal、capture:recommended@5/Desc、drop:recommended@6/Desc |
| 20 | ryunenbb vs sonao81 / 58 | 2 | capture,immediate threat | C | A | causal-safe | 表示 | 表示価値あり | 実戦枝だけで駒を失う | 実戦枝2手目のcapture差 | capture:actual@2/Causal、promotion:actual@4/Desc、capture:recommended@2/Comp、drop:recommended@3/Desc、promotion:recommended@5/Desc |
| 21 | ryunenbb vs sonao81 / 64 | 2 | capture,immediate threat | C | A | causal-safe | 表示 | 表示価値あり | 実戦枝だけで駒を失う | 実戦枝2手目のcapture差 | capture:actual@2/Causal、drop:actual@3/Desc、capture:actual@4/Desc、promotion:actual@4/Desc、promotion:actual@5/Desc、drop:actual@6/Desc、drop:recommended@2/Desc |
| 22 | ryunenbb vs sonao81 / 72 | 1 | capture,promotion,material | A | A | descriptive-only | なし | 省略推奨 | 実戦枝だけで駒を失う | strict material差 | material:comparison/Comp、promotion:actual@1/Desc、drop:actual@3/Desc、drop:actual@5/Desc、capture:actual@6/Desc、promotion:recommended@1/Desc、drop:recommended@3/Desc、drop:recommended@6/Desc |
| 23 | ryunenbb vs sonao81 / 76 | 2 | capture,drop,immediate threat | C | A | causal-safe | 表示 | 表示価値あり | 実戦枝だけで駒を失う | 実戦枝2手目のcheck差 | capture:actual@1/Comp、check:actual@2/Causal、drop:actual@2/Desc、capture:actual@4/Desc、capture:actual@5/Desc、check:actual@6/Desc、drop:recommended@1/Desc、check:recommended@3/Desc、capture:recommended@3/Desc、capture:recommended@4/Desc、capture:recommended@5/Desc、promotion:recommended@5/Desc、capture:recommended@6/Desc |
| 24 | ryunenbb vs sonao81 / 80 | 1 | mate,check,capture,drop,immediate threat | A | A | causal-safe | 表示 | 表示価値あり | 取るタイミングだけ違う | mate差,実戦枝の相手王手 | mate:comparison/Causal、capture:actual@1/Desc、check:actual@2/Causal、drop:actual@3/Desc、check:actual@4/Desc、capture:actual@4/Desc、drop:actual@5/Desc、check:actual@6/Desc、drop:recommended@1/Desc、capture:recommended@2/Desc、check:recommended@3/Desc、capture:recommended@4/Desc、capture:recommended@5/Desc、capture:recommended@6/Desc、promotion:recommended@6/Desc |
| 25 | sonao81 vs ak69Boy / 105 | 1 | mate,check,capture,drop | B | A | descriptive-only | なし | 省略推奨 | 実戦枝だけで駒を失う | mate差,推奨枝の王手 | mate:comparison/Causal、drop:actual@1/Desc、drop:actual@2/Desc、drop:actual@3/Desc、check:actual@4/Desc、capture:actual@4/Desc、promotion:actual@4/Desc、capture:actual@5/Desc、drop:actual@6/Desc、check:recommended@1/Comp、drop:recommended@1/Desc、check:recommended@3/Desc、drop:recommended@4/Desc、check:recommended@5/Desc、capture:recommended@5/Desc |
| 26 | sonao81 vs ak69Boy / 131 | 1 | mate,capture,promotion | B | A | descriptive-only | なし | 省略推奨 | 両枝とも同じ駒を取る | mate差,推奨枝の王手 | mate:comparison/Causal、check:actual@1/Desc、capture:actual@1/Desc、promotion:actual@1/Desc、capture:actual@3/Desc、check:actual@4/Desc、drop:actual@4/Desc、check:recommended@1/Desc、capture:recommended@1/Desc、check:recommended@3/Desc |
| 27 | sonao81 vs ak69Boy / 137 | 1 | mate,capture,drop | B | A | descriptive-only | なし | 省略推奨 | 推奨枝だけで駒を取る | mate差,推奨枝の王手 | mate:comparison/Causal、check:actual@1/Desc、drop:actual@1/Desc、drop:actual@2/Desc、check:actual@3/Desc、capture:actual@3/Desc、check:actual@5/Desc、drop:actual@5/Desc、capture:actual@6/Desc、check:recommended@1/Desc、drop:recommended@1/Desc、check:recommended@3/Desc、drop:recommended@3/Desc、capture:recommended@4/Desc、check:recommended@5/Desc、capture:recommended@5/Desc、capture:recommended@6/Desc |
| 28 | sonao81 vs ak69Boy / 139 | 1 | mate,capture | B | A | descriptive-only | なし | 省略推奨 | 推奨枝だけで駒を取る | mate差,推奨枝の王手 | mate:comparison/Causal、check:actual@1/Desc、check:actual@3/Desc、drop:actual@3/Desc、capture:actual@4/Desc、capture:actual@5/Desc、promotion:actual@6/Desc、check:recommended@1/Desc、capture:recommended@1/Comp、check:recommended@3/Desc、drop:recommended@3/Desc、capture:recommended@4/Desc、check:recommended@5/Desc、capture:recommended@5/Desc |
| 29 | sonao81 vs ak69Boy / 143 | 1 | mate,capture,drop | B | A | descriptive-only | なし | 省略推奨 | 実戦枝だけで駒を失う | mate差,推奨枝の王手 | mate:comparison/Causal、check:actual@1/Desc、drop:actual@1/Desc、drop:actual@3/Desc、capture:actual@5/Desc、capture:actual@6/Desc、drop:recommended@1/Desc、capture:recommended@2/Comp、check:recommended@3/Desc、drop:recommended@3/Desc、check:recommended@5/Desc、drop:recommended@5/Desc、capture:recommended@6/Desc |
| 30 | sonao81 vs ak69Boy / 145 | 1 | mate,capture,drop | B | A | comparative-safe | なし | 省略推奨 | 実戦枝だけで駒を失う | mate差,推奨枝の王手 | mate:comparison/Causal、capture:actual@1/Comp、promotion:actual@2/Desc、check:actual@3/Desc、drop:actual@3/Desc、capture:actual@4/Desc、check:actual@5/Desc、capture:actual@5/Desc、drop:recommended@1/Desc、check:recommended@3/Desc、drop:recommended@3/Desc、check:recommended@5/Desc、drop:recommended@5/Desc、capture:recommended@6/Desc、promotion:recommended@6/Desc |
| 31 | NAGATA2532 vs sonao81 / 28 | 2 | capture,promotion,immediate threat | C | A | causal-safe | 表示 | 表示価値あり | 実戦枝だけで駒を失う | 実戦枝2手目のcapture差 | capture:actual@2/Causal、promotion:actual@2/Desc、capture:actual@3/Desc、drop:actual@6/Desc、capture:recommended@1/Comp、promotion:recommended@1/Desc、capture:recommended@2/Comp、drop:recommended@3/Desc、drop:recommended@6/Desc |
| 32 | NAGATA2532 vs sonao81 / 34 | 1 | capture,promotion,material,immediate threat | A | A | descriptive-only | 表示 | 省略推奨 | 推奨枝だけで駒を取る | strict material差 | material:comparison/Comp、promotion:actual@1/Desc、capture:actual@2/Desc、promotion:actual@2/Desc、capture:actual@3/Desc、promotion:actual@3/Desc、capture:actual@4/Desc、drop:actual@5/Desc、capture:recommended@1/Desc、promotion:recommended@1/Desc、capture:recommended@2/Desc、capture:recommended@3/Desc、promotion:recommended@3/Desc、capture:recommended@5/Desc、capture:recommended@6/Desc、promotion:recommended@6/Desc |
| 33 | NAGATA2532 vs sonao81 / 36 | 1 | capture,promotion,material,immediate threat | A | A | causal-safe | 表示 | 省略推奨 | 実戦枝だけで駒を失う | strict material差 | material:comparison/Comp、capture:actual@2/Causal、capture:actual@3/Desc、promotion:actual@3/Desc、capture:actual@4/Desc、drop:actual@5/Desc、capture:recommended@1/Desc、promotion:recommended@1/Desc、capture:recommended@2/Desc、drop:recommended@3/Desc、capture:recommended@5/Desc |
| 34 | NAGATA2532 vs sonao81 / 44 | 1 | capture,material,immediate threat | A | A | causal-safe | 表示 | 省略推奨 | 実戦枝だけで駒を失う | strict material差 | material:comparison/Comp、drop:actual@1/Desc、capture:actual@2/Causal、capture:actual@3/Desc、drop:actual@4/Desc、drop:actual@5/Desc、drop:actual@6/Desc、drop:recommended@2/Desc、capture:recommended@3/Desc、drop:recommended@4/Desc、capture:recommended@5/Desc |
| 35 | NAGATA2532 vs sonao81 / 46 | 2 | capture | B | D | descriptive-only | なし | 省略推奨 | 実戦枝だけで駒を失う | Reason省略 | drop:actual@2/Desc、capture:actual@4/Desc、capture:actual@5/Desc、drop:actual@6/Desc |
| 36 | NAGATA2532 vs sonao81 / 52 | 2 | capture | B | D | descriptive-only | なし | 省略推奨 | 実戦枝だけで駒を失う | Reason省略 | drop:actual@1/Desc、drop:actual@2/Desc、capture:actual@3/Desc、capture:actual@4/Desc、promotion:actual@4/Desc、capture:actual@5/Desc、capture:actual@6/Desc、capture:recommended@1/Comp |
| 37 | おまつ vs ぺるそなお / 34 | 2 | capture,drop | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | drop:actual@1/Desc、drop:recommended@1/Desc、capture:recommended@3/Desc、drop:recommended@4/Desc |
| 38 | おまつ vs ぺるそなお / 80 | 2 | drop | D | D | comparative-safe | なし | 省略推奨 | - | Reason省略 | drop:recommended@1/Desc、drop:recommended@2/Desc |
| 39 | おまつ vs ぺるそなお / 98 | 2 | capture,promotion | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | promotion:recommended@1/Desc、capture:recommended@2/Comp、capture:recommended@3/Desc、promotion:recommended@3/Desc、capture:recommended@4/Desc、drop:recommended@5/Desc、drop:recommended@6/Desc |
| 40 | おまつ vs ぺるそなお / 118 | 2 | drop | D | D | comparative-safe | なし | 省略推奨 | - | Reason省略 | drop:actual@1/Desc、drop:recommended@1/Desc |
| 41 | おまつ vs ぺるそなお / 126 | 2 | check,capture | D | B | comparative-safe | なし | 省略推奨 | 単なるPV途中のcapture | 推奨初手だけcheck | check:recommended@1/Comp、capture:recommended@2/Comp、check:recommended@3/Desc、drop:recommended@3/Desc、capture:recommended@4/Desc、check:recommended@5/Desc、drop:recommended@5/Desc |
| 42 | おまつ vs ぺるそなお / 128 | 2 | drop | D | D | comparative-safe | なし | 省略推奨 | - | Reason省略 | drop:recommended@1/Desc、check:recommended@2/Comp、drop:recommended@2/Desc |
| 43 | じゅんや vs ぺるそなお / 44 | 3 | - | D | D | comparative-safe | なし | 省略推奨 | - | Reason省略 | evaluation:comparison/Comp |
| 44 | じゅんや vs ぺるそなお / 78 | 2 | capture | B | D | descriptive-only | なし | 省略推奨 | 両枝とも同じ駒を取る | Reason省略 | capture:actual@1/Desc、capture:recommended@1/Desc |
| 45 | じゅんや vs ぺるそなお / 94 | 2 | capture | B | D | comparative-safe | なし | 省略推奨 | 単なるPV途中のcapture | Reason省略 | capture:actual@1/Comp、promotion:recommended@2/Desc |
| 46 | じゅんや vs ぺるそなお / 102 | 2 | capture | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | drop:actual@1/Desc、capture:recommended@2/Comp、promotion:recommended@2/Desc、drop:recommended@3/Desc、capture:recommended@4/Desc、capture:recommended@5/Desc、promotion:recommended@5/Desc、check:recommended@6/Desc |
| 47 | じゅんや vs ぺるそなお / 106 | 2 | drop | D | D | comparative-safe | なし | 省略推奨 | - | Reason省略 | drop:actual@1/Desc、drop:recommended@1/Desc |
| 48 | じゅんや vs ぺるそなお / 110 | 2 | capture,drop | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | drop:actual@1/Desc、drop:recommended@1/Desc、drop:recommended@3/Desc、capture:recommended@5/Desc、capture:recommended@6/Desc |
| 49 | ぺるそなお vs ダルマ / 29 | 3 | - | D | D | comparative-safe | なし | 省略推奨 | - | Reason省略 | evaluation:comparison/Comp |
| 50 | ぺるそなお vs ダルマ / 31 | 3 | - | D | D | comparative-safe | なし | 省略推奨 | - | Reason省略 | evaluation:comparison/Comp |
| 51 | ぺるそなお vs ダルマ / 39 | 2 | drop | D | D | comparative-safe | なし | 省略推奨 | - | Reason省略 | drop:actual@1/Desc、drop:recommended@1/Desc |
| 52 | ぺるそなお vs ダルマ / 57 | 2 | capture | D | D | comparative-safe | なし | 省略推奨 | 単なるPV途中のcapture | Reason省略 | drop:actual@1/Desc、capture:recommended@2/Comp、drop:recommended@3/Desc、drop:recommended@4/Desc、drop:recommended@5/Desc、capture:recommended@6/Desc |
| 53 | ぺるそなお vs ダルマ / 59 | 2 | capture,promotion | D | B | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | 推奨枝だけで駒を取る（銀） | capture:recommended@1/Comp、promotion:recommended@1/Desc、capture:recommended@2/Comp、drop:recommended@3/Desc、check:recommended@4/Desc、capture:recommended@4/Desc、promotion:recommended@4/Desc、capture:recommended@5/Desc、capture:recommended@6/Desc、promotion:recommended@6/Desc |
| 54 | ぺるそなお vs ダルマ / 61 | 2 | capture,drop | B | D | comparative-safe | なし | 省略推奨 | 単なるPV途中のcapture | Reason省略 | capture:actual@1/Comp、drop:recommended@1/Desc、capture:recommended@2/Comp、promotion:recommended@2/Desc、check:recommended@4/Desc、capture:recommended@4/Desc、check:recommended@6/Desc、capture:recommended@6/Desc |
| 55 | ぺるそなお vs しゅん / 49 | 3 | - | D | D | comparative-safe | なし | 省略推奨 | - | Reason省略 | evaluation:comparison/Comp |
| 56 | ぺるそなお vs しゅん / 55 | 2 | capture,promotion | D | B | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | 推奨枝だけで駒を取る（歩） | capture:recommended@1/Comp、promotion:recommended@1/Desc、capture:recommended@2/Comp |
| 57 | ぺるそなお vs しゅん / 71 | 2 | capture,drop | B | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | capture:actual@1/Comp、drop:recommended@1/Desc、drop:recommended@2/Desc、capture:recommended@3/Desc、promotion:recommended@3/Desc、check:recommended@4/Desc、capture:recommended@4/Desc、promotion:recommended@4/Desc、capture:recommended@5/Desc |
| 58 | ぺるそなお vs しゅん / 75 | 2 | capture | D | B | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | 推奨枝だけで駒を取る（金） | drop:actual@1/Desc、capture:recommended@1/Comp、capture:recommended@2/Comp、drop:recommended@3/Desc、capture:recommended@4/Desc、promotion:recommended@4/Desc、capture:recommended@5/Desc、promotion:recommended@6/Desc |
| 59 | ぺるそなお vs しゅん / 79 | 2 | check,capture,promotion | D | B | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | 推奨初手だけcheck | drop:actual@1/Desc、check:recommended@1/Comp、capture:recommended@1/Comp、promotion:recommended@1/Desc、capture:recommended@2/Comp、drop:recommended@3/Desc、promotion:recommended@4/Desc、capture:recommended@5/Desc、promotion:recommended@5/Desc、check:recommended@6/Desc、drop:recommended@6/Desc |
| 60 | ぺるそなお vs しゅん / 81 | 2 | check,capture,promotion | B | B | descriptive-only | なし | 省略推奨 | 推奨枝だけで駒を取る | 推奨初手だけcheck | capture:actual@1/Desc、promotion:actual@1/Desc、check:recommended@1/Comp、capture:recommended@1/Comp、promotion:recommended@1/Desc、capture:recommended@2/Comp、capture:recommended@3/Desc、promotion:recommended@3/Desc、drop:recommended@5/Desc、capture:recommended@6/Desc |
| 61 | ぺるそなお vs ぴろ / 51 | 2 | capture | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | drop:actual@1/Desc、capture:recommended@2/Comp、drop:recommended@3/Desc、drop:recommended@4/Desc、capture:recommended@5/Desc、drop:recommended@6/Desc |
| 62 | ぺるそなお vs ぴろ / 57 | 2 | check,capture,drop | D | B | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | 推奨初手だけcheck | check:recommended@1/Comp、drop:recommended@1/Desc、check:recommended@3/Desc、drop:recommended@3/Desc、capture:recommended@4/Desc、check:recommended@5/Desc、capture:recommended@5/Desc |
| 63 | ぺるそなお vs ぴろ / 59 | 2 | check,capture,drop | B | B | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | 推奨初手だけcheck | capture:actual@1/Comp、check:recommended@1/Comp、drop:recommended@1/Desc、drop:recommended@3/Desc、capture:recommended@4/Desc、capture:recommended@5/Desc、promotion:recommended@5/Desc、drop:recommended@6/Desc |
| 64 | ぺるそなお vs ぴろ / 67 | 2 | capture | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | drop:recommended@2/Desc、check:recommended@3/Desc、capture:recommended@3/Desc、capture:recommended@4/Desc、drop:recommended@5/Desc、drop:recommended@6/Desc |
| 65 | ぺるそなお vs ぴろ / 77 | 2 | capture | B | B | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | 推奨枝だけで駒を取る（銀） | check:actual@1/Comp、drop:actual@1/Desc、capture:recommended@1/Comp、capture:recommended@2/Comp、capture:recommended@3/Desc、capture:recommended@4/Desc、drop:recommended@5/Desc、drop:recommended@6/Desc |
| 66 | ぺるそなお vs ぴろ / 91 | 2 | capture,drop | B | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | check:actual@1/Comp、drop:actual@1/Desc、drop:recommended@1/Desc、drop:recommended@2/Desc、capture:recommended@3/Desc、capture:recommended@4/Desc、capture:recommended@5/Desc、drop:recommended@6/Desc |
| 67 | ぺるそなお vs 大山　貴一郎 / 87 | 2 | capture | D | D | comparative-safe | なし | 省略推奨 | 単なるPV途中のcapture | Reason省略 | capture:recommended@2/Comp、drop:recommended@3/Desc、drop:recommended@5/Desc、capture:recommended@6/Desc |
| 68 | ぺるそなお vs 大山　貴一郎 / 95 | 2 | capture,drop | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | drop:actual@1/Desc、drop:recommended@1/Desc、capture:recommended@2/Comp、drop:recommended@3/Desc、capture:recommended@5/Desc、capture:recommended@6/Desc、promotion:recommended@6/Desc |
| 69 | ぺるそなお vs 大山　貴一郎 / 99 | 2 | capture,drop | D | D | comparative-safe | なし | 省略推奨 | 単なるPV途中のcapture | Reason省略 | drop:actual@1/Desc、drop:recommended@1/Desc、capture:recommended@2/Comp、drop:recommended@3/Desc、capture:recommended@4/Desc、drop:recommended@5/Desc、promotion:recommended@6/Desc |
| 70 | ぺるそなお vs 大山　貴一郎 / 107 | 2 | capture,drop | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | drop:actual@1/Desc、drop:recommended@1/Desc、check:recommended@2/Comp、drop:recommended@2/Desc、capture:recommended@3/Desc、check:recommended@4/Desc、capture:recommended@4/Desc、capture:recommended@5/Desc、check:recommended@6/Desc、drop:recommended@6/Desc |
| 71 | ぺるそなお vs 大山　貴一郎 / 109 | 2 | capture | B | D | descriptive-only | なし | 省略推奨 | 取るタイミングだけ違う | Reason省略 | capture:actual@1/Desc、capture:recommended@1/Desc、drop:recommended@2/Desc、drop:recommended@3/Desc、capture:recommended@4/Desc、promotion:recommended@4/Desc、capture:recommended@5/Desc、check:recommended@6/Desc、capture:recommended@6/Desc |
| 72 | ぺるそなお vs 大山　貴一郎 / 117 | 2 | capture | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | drop:actual@1/Desc、check:recommended@2/Comp、capture:recommended@2/Comp、promotion:recommended@2/Desc、capture:recommended@3/Desc、drop:recommended@4/Desc、drop:recommended@5/Desc、check:recommended@6/Desc、capture:recommended@6/Desc |
| 73 | ぺるそなお vs ぽっぷ / 51 | 2 | check,capture,drop | D | B | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | 推奨初手だけcheck | drop:actual@1/Desc、check:recommended@1/Comp、drop:recommended@1/Desc、drop:recommended@2/Desc、check:recommended@3/Desc、capture:recommended@3/Desc、promotion:recommended@3/Desc、capture:recommended@4/Desc、check:recommended@5/Desc、capture:recommended@5/Desc、promotion:recommended@5/Desc、capture:recommended@6/Desc |
| 74 | ぺるそなお vs ぽっぷ / 53 | 2 | capture,promotion,drop | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | promotion:actual@1/Desc、drop:recommended@1/Desc、drop:recommended@2/Desc、check:recommended@3/Desc、capture:recommended@3/Desc、promotion:recommended@3/Desc、capture:recommended@4/Desc、promotion:recommended@5/Desc、capture:recommended@6/Desc、promotion:recommended@6/Desc |
| 75 | ぺるそなお vs ぽっぷ / 57 | 2 | capture,promotion | B | D | comparative-safe | なし | 省略推奨 | 単なるPV途中のcapture | Reason省略 | check:actual@1/Comp、capture:actual@1/Comp、promotion:actual@1/Desc |
| 76 | ぺるそなお vs ぽっぷ / 59 | 2 | capture,drop | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | drop:actual@1/Desc、drop:recommended@1/Desc、promotion:recommended@3/Desc、drop:recommended@4/Desc、capture:recommended@5/Desc、capture:recommended@6/Desc |
| 77 | ぺるそなお vs ぽっぷ / 67 | 2 | promotion | D | D | comparative-safe | なし | 省略推奨 | - | Reason省略 | promotion:recommended@1/Desc |
| 78 | ぺるそなお vs ぽっぷ / 91 | 2 | capture,drop | B | D | comparative-safe | なし | 省略推奨 | 単なるPV途中のcapture | Reason省略 | capture:actual@1/Comp、drop:recommended@1/Desc |
| 79 | ぱいなぽー vs ぺるそなお / 74 | 2 | capture,drop | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | drop:actual@1/Desc、drop:recommended@1/Desc、capture:recommended@3/Desc、promotion:recommended@3/Desc、capture:recommended@4/Desc、check:recommended@6/Desc、drop:recommended@6/Desc |
| 80 | ぱいなぽー vs ぺるそなお / 92 | 2 | capture,drop | B | D | descriptive-only | なし | 省略推奨 | 取るタイミングだけ違う | Reason省略 | capture:actual@1/Desc、drop:recommended@1/Desc、check:recommended@2/Comp、drop:recommended@2/Desc、capture:recommended@4/Desc、capture:recommended@5/Desc、capture:recommended@6/Desc |
| 81 | ぱいなぽー vs ぺるそなお / 96 | 2 | capture,promotion,drop | D | D | comparative-safe | なし | 省略推奨 | 単なるPV途中のcapture | Reason省略 | promotion:actual@1/Desc、drop:recommended@1/Desc、capture:recommended@2/Comp、promotion:recommended@3/Desc |
| 82 | ぱいなぽー vs ぺるそなお / 98 | 2 | capture,drop | D | D | comparative-safe | なし | 省略推奨 | 単なるPV途中のcapture | Reason省略 | drop:recommended@1/Desc、drop:recommended@2/Desc、drop:recommended@3/Desc、capture:recommended@4/Desc、promotion:recommended@6/Desc |
| 83 | ぱいなぽー vs ぺるそなお / 100 | 2 | capture | D | B | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | 推奨枝だけで駒を取る（桂） | drop:actual@1/Desc、capture:recommended@1/Comp、capture:recommended@2/Comp、drop:recommended@3/Desc、check:recommended@4/Desc、drop:recommended@4/Desc、drop:recommended@5/Desc |
| 84 | ぱいなぽー vs ぺるそなお / 102 | 2 | capture | B | D | descriptive-only | なし | 省略推奨 | 両枝とも同じ駒を取る | Reason省略 | capture:actual@1/Desc、capture:recommended@1/Desc、check:recommended@2/Comp、capture:recommended@2/Comp、promotion:recommended@2/Desc |
| 85 | ひぐれ vs ぺるそなお / 42 | 2 | capture,promotion,drop | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | promotion:actual@1/Desc、drop:recommended@1/Desc、capture:recommended@2/Comp、promotion:recommended@2/Desc、capture:recommended@3/Desc、promotion:recommended@5/Desc、capture:recommended@6/Desc、promotion:recommended@6/Desc |
| 86 | ひぐれ vs ぺるそなお / 46 | 2 | capture | B | B | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | 推奨枝だけで駒を取る（飛） | capture:actual@1/Comp、capture:recommended@1/Comp、capture:recommended@2/Comp、capture:recommended@3/Desc、drop:recommended@5/Desc、capture:recommended@6/Desc |
| 87 | ひぐれ vs ぺるそなお / 52 | 2 | capture,drop | B | D | comparative-safe | なし | 省略推奨 | 単なるPV途中のcapture | Reason省略 | capture:actual@1/Comp、drop:recommended@1/Desc、drop:recommended@4/Desc、promotion:recommended@5/Desc |
| 88 | ありあけ vs ぺるそなお / 58 | 2 | capture,promotion | B | D | descriptive-only | なし | 省略推奨 | 取るタイミングだけ違う | Reason省略 | check:actual@1/Desc、capture:actual@1/Desc、promotion:actual@1/Desc、check:recommended@1/Desc、check:recommended@3/Desc、capture:recommended@3/Desc、promotion:recommended@3/Desc、drop:recommended@4/Desc、check:recommended@5/Desc、drop:recommended@6/Desc |
| 89 | ありあけ vs ぺるそなお / 82 | 2 | drop | D | D | comparative-safe | なし | 省略推奨 | - | Reason省略 | drop:actual@1/Desc、drop:recommended@1/Desc、drop:recommended@2/Desc、drop:recommended@3/Desc、drop:recommended@4/Desc、check:recommended@5/Desc、drop:recommended@5/Desc |
| 90 | ありあけ vs ぺるそなお / 86 | 2 | drop | B | D | descriptive-only | なし | 省略推奨 | - | Reason省略 | check:actual@1/Desc、drop:actual@1/Desc、check:recommended@1/Desc、drop:recommended@1/Desc、check:recommended@3/Desc、drop:recommended@3/Desc |
| 91 | ありあけ vs ぺるそなお / 94 | 2 | capture | B | D | descriptive-only | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | check:actual@1/Desc、drop:actual@1/Desc、check:recommended@1/Desc、drop:recommended@2/Desc、check:recommended@3/Desc、capture:recommended@3/Desc、check:recommended@5/Desc、drop:recommended@5/Desc |
| 92 | ありあけ vs ぺるそなお / 96 | 2 | capture | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | drop:recommended@2/Desc、check:recommended@4/Desc、capture:recommended@4/Desc、promotion:recommended@4/Desc、capture:recommended@5/Desc |
| 93 | ありあけ vs ぺるそなお / 100 | 2 | check,capture,drop | B | B | comparative-safe | なし | 省略推奨 | 単なるPV途中のcapture | 推奨初手だけcheck | capture:actual@1/Comp、check:recommended@1/Comp、drop:recommended@1/Desc |
| 94 | sonao81 vs taatoru_cat / 67 | 2 | capture,drop | B | D | descriptive-only | なし | 省略推奨 | 取るタイミングだけ違う | Reason省略 | capture:actual@1/Desc、drop:recommended@1/Desc、capture:recommended@2/Comp、drop:recommended@3/Desc、drop:recommended@4/Desc、capture:recommended@5/Desc、promotion:recommended@5/Desc、capture:recommended@6/Desc |
| 95 | sonao81 vs taatoru_cat / 71 | 2 | capture,drop | B | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | capture:actual@1/Comp、drop:recommended@1/Desc、drop:recommended@2/Desc、check:recommended@3/Desc、capture:recommended@3/Desc、promotion:recommended@3/Desc、capture:recommended@4/Desc、drop:recommended@5/Desc、capture:recommended@6/Desc |
| 96 | sonao81 vs taatoru_cat / 85 | 2 | capture,drop | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | drop:actual@1/Desc、drop:recommended@1/Desc、capture:recommended@2/Comp、check:recommended@3/Desc、drop:recommended@3/Desc、capture:recommended@5/Desc、promotion:recommended@5/Desc、capture:recommended@6/Desc |
| 97 | sonao81 vs taatoru_cat / 91 | 2 | capture,drop | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | drop:actual@1/Desc、drop:recommended@1/Desc、capture:recommended@2/Comp、drop:recommended@3/Desc、drop:recommended@4/Desc、capture:recommended@5/Desc、capture:recommended@6/Desc |
| 98 | sonao81 vs taatoru_cat / 99 | 2 | capture,promotion | B | B | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | 推奨枝だけで駒を取る（桂） | capture:actual@1/Comp、promotion:actual@1/Desc、capture:recommended@1/Comp |
| 99 | sonao81 vs taatoru_cat / 105 | 2 | capture,drop | B | D | comparative-safe | なし | 省略推奨 | 単なるPV途中のcapture | Reason省略 | check:actual@1/Desc、capture:actual@1/Comp、check:recommended@1/Desc、drop:recommended@1/Desc |
| 100 | yogra vs sonao81 / 34 | 3 | - | D | D | comparative-safe | なし | 省略推奨 | - | Reason省略 | evaluation:comparison/Comp |
| 101 | yogra vs sonao81 / 42 | 2 | capture | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | promotion:recommended@2/Desc、capture:recommended@3/Desc、capture:recommended@4/Desc、promotion:recommended@4/Desc、capture:recommended@5/Desc、drop:recommended@6/Desc |
| 102 | yogra vs sonao81 / 50 | 2 | capture | B | D | descriptive-only | なし | 省略推奨 | 取るタイミングだけ違う | Reason省略 | capture:actual@1/Desc、check:recommended@2/Comp、capture:recommended@2/Comp、capture:recommended@3/Desc、promotion:recommended@4/Desc、drop:recommended@5/Desc、check:recommended@6/Desc、capture:recommended@6/Desc |
| 103 | yogra vs sonao81 / 54 | 2 | capture,drop | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | drop:actual@1/Desc、drop:recommended@1/Desc、drop:recommended@2/Desc、drop:recommended@3/Desc、capture:recommended@4/Desc、capture:recommended@5/Desc、capture:recommended@6/Desc |
| 104 | yogra vs sonao81 / 56 | 2 | capture,drop | D | D | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | Reason省略 | drop:recommended@1/Desc、check:recommended@2/Comp、capture:recommended@2/Comp、capture:recommended@3/Desc、drop:recommended@4/Desc、drop:recommended@5/Desc、check:recommended@6/Desc、capture:recommended@6/Desc |
| 105 | AochiKenmin vs sonao81 / 48 | 2 | capture | D | B | comparative-safe | なし | 省略推奨 | 推奨枝だけで駒を取る | 推奨枝だけで駒を取る（歩） | capture:recommended@1/Comp |
| 106 | AochiKenmin vs sonao81 / 56 | 2 | capture | D | D | comparative-safe | なし | 省略推奨 | 単なるPV途中のcapture | Reason省略 | capture:recommended@2/Comp |
| 107 | AochiKenmin vs sonao81 / 60 | 2 | capture,drop | D | D | comparative-safe | なし | 省略推奨 | 単なるPV途中のcapture | Reason省略 | drop:actual@1/Desc、drop:recommended@1/Desc、capture:recommended@4/Desc、drop:recommended@5/Desc |
| 108 | あかね vs ぺるそなお / 30 | 3 | - | D | D | comparative-safe | なし | 省略推奨 | - | Reason省略 | evaluation:comparison/Comp |
| 109 | あかね vs ぺるそなお / 86 | 3 | - | D | D | comparative-safe | なし | 省略推奨 | - | Reason省略 | evaluation:comparison/Comp |
| 110 | あかね vs ぺるそなお / 118 | 2 | drop | D | D | comparative-safe | なし | 省略推奨 | - | Reason省略 | drop:actual@1/Desc、drop:recommended@1/Desc |

## 9. Candidate Phase 2仕様案（production未変更）

1. typed mate差を最優先し、`actual mate / recommended cp` と `actual cp / recommended mate` の両方向を明示する。
2. strict material差は同一6ply・駒種別component-wise非劣位の場合だけ使う。
3. check/capture差は原則として初手〜直後2手だけを主理由候補にする。3手目以降はdescriptive-only。
4. 両枝共通capture、captureのタイミング差、promotion/drop単独は主理由にしない。
5. 「次に確認」は実戦直後の相手応手またはmate枝の連続王手から安全に作れる場合だけ表示する。
6. 「なぜ」で枝比較を完結できる場合、「推奨手では」で同じ内容を言い換えない。
7. 比較根拠がなければReason全体を表示しない。評価値カードは既存UI側の別情報として残せるが、Reasonを一般論で埋めない。

## 10. 推奨判定と次Phase

Candidate Phase 2方針は、E=0を維持しつつ、比較根拠ありを16件から46件へ増やし、descriptive-only主理由を25件から0件へ落とせる。一方、64件は安全な改善材料を保存データから作れず非表示になる。したがって「Reasonを全110件へ必ず表示」は不採用とし、代表10局面のHuman Review合格後に、生成器・fixture test・表示条件を実装するPhase 3へ進むことを推奨する。B-strict、解析threshold、保存解析JSONは変更対象にしない。

## 11. 監査制約の確認

- production変更: なし
- 既存局再解析: なし
- commit / push: なし
- 変更対象: 本監査レポートのみ
