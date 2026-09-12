# SHOGI Reason Additional Search — TOP10 Human Review

## Reviewルール

前回と同じ代表10局面。盤面は各局面の厳密なSFEN、PV・score・eventsは水匠5実測値。文章は盤面/PVで比較できる事実だけで、棋理解釈や一般化は加えていない。`○/△/×`は候補品質の機械的事前判定であり、Human Review欄は別に空欄とする。新Reasonはproduction非表示。

## 一覧

| # | 局面・盤面 | 実戦 / 推奨 | 30k Q1/Q2 | 60k Q1/Q2 | 安定difference率 | 安定Candidate Reason |
|---:|---|---|---|---|---:|---|
| 1 | ryunenbb vs sonao81 80手目<br>`ln+R5l/2sgS4/kppp1B1p1/p1N5p/3PBs1P1/2P2p2P/PP1SPG3/2KG5/LN6+r w G4Pnl 80` | △5二金 / △7五桂打 | △/△ | △/△ | 100.0% | 30k/60kの詰み差は120kで消失。未解決 |
| 2 | sonao81 vs ak69Boy 131手目<br>`1n1+R5/1ks3R2/1pp2b3/1+b1p4p/l5pp1/4l3P/5PPP1/4P1GK1/1N5NL b 3G2SL2Psn5p 131` | ▲7二飛成 / ▲7二龍 | △/△ | △/△ | 46.7% | 推奨枝だけ`mate 2`。実戦枝は同じ詰み評価ではない |
| 3 | 夢への旅路 vs ぺるそなお 42手目<br>`lns2g2l/2kgr4/pppp1p3/6pbp/4Ss1p1/P1P3P1P/1PBPpPNP1/2G3SK1/LN2RG2L w Pn 42` | △5六銀 / △3六銀 | △/△ | ×/△ | 27.8% | なし |
| 4 | NAGATA2532 vs sonao81 28手目<br>`lns2g1nl/2kgr4/ppppspp1b/8p/7p1/P3R3P/1PPP1PPP1/LB1G1GKS1/1NS4NL w Pp 28` | △4四銀 / △6八角成 | ○/○ | ×/△ | 21.7% | 30kの飛車損差が60kで消失。なし |
| 5 | ぺるそなお vs しゅん 79手目<br>`l2r3nk/7sl/3Ppg1pp/p1p3p2/7SP/P1P2p3/1G4PP1/1B3PSK1/L2+r1G1NL b GSN2Pbn2p 79` | ▲5二銀打 / ▲2二角成 | ×/△ | ×/△ | 21.4% | なし |
| 6 | 夢への旅路 vs ぺるそなお 50手目<br>`lns2g2l/2kgr4/pppp1p3/4P2bp/4S2p1/PBP1s1P1P/1P1PpPNP1/2G3SK1/LN2RG2L w np 50` | △4二角 / △3五歩打 | ○/○ | ○/○ | 26.9% | 実戦枝だけ2手目に角を失い、推奨枝は同範囲で失わない |
| 7 | 夢への旅路 vs ぺるそなお 84手目<br>`lns1r3l/2k6/pppp1p3/4+r3p/4P4/P1P3PPP/1P1P1P+B2/2s3SK1/LN6L w BGP3gs2n2p 84` | △6四龍 / △4四龍 | △/× | △/△ | 9.1% | なし |
| 8 | sonao81 vs taatoru_cat 67手目<br>`lnkg2Rnl/2s1g4/2ppps3/pp6p/2P3p2/P4pPP1/3P2n1P/1+r2G2SK/L3P1G1L b BNPbs2p 67` | ▲3七銀 / ▲8三歩打 | △/△ | △/× | 17.1% | なし |
| 9 | おまつ vs ぺるそなお 80手目<br>`lns4n1/2kg1+P1R1/ppppg4/5pp2/P3p1P1l/2PP5/1P1SP2+bP/2K1G4/LN1G3+rL w BS3Psn 80` | △3三桂 / △4六桂打 | ×/△ | ○/○ | 4.0% | 30k/60kで根拠が入れ替わる。なし |
| 10 | じゅんや vs ぺるそなお 44手目<br>`lns2g1nl/2kg3b1/pppp1ps2/7rp/3P2p2/2P2P1PP/PPBSPGPS1/1R4GK1/LN5NL w 2p 44` | △4四銀 / △3四銀 | ×/△ | ×/△ | 100.0% | 推奨枝の角損だけで推奨手の意味を説明できない |

## 30k / 60k PV

### 1. ryunenbb 80

- 30k actual `mate -5`: △5二金 ▲6六角 △7五桂打 ▲同角 △9二玉 ▲8二金打
- 30k recommended `cp -12164`: △7五桂打 ▲8二龍
- 60k actual `mate -5`: △5二金 ▲6六角 △7五桂打 ▲同角 △9二玉 ▲8二金打
- 60k recommended `cp -26133`: △7五桂打 ▲8二龍
- 120k actual `mate -5`: 同じ6手
- 120k recommended `mate -15`: △7五桂打 ▲8二龍 △8四玉 ▲7五歩 △8九龍 ▲同玉 △7七桂打 ▲同角 △8八香打 ▲同玉 △9三桂 ▲7六桂打 △7五玉 ▲8六金打 △7四玉 ▲7五飛打
- Branch Difference: 30k/60kはactual-only mate HIGH。120kでは両枝mateとなり詰み差なし。
- Candidate Reason: 未解決。30k/60kだけを根拠に「△7五桂打で詰み回避」としない。

### 2. ak69Boy 131

- 30k actual `cp 6624`: ▲7二飛成 △9三玉 ▲8二銀打 △9四玉 ▲6四龍 △9八歩打 ▲8一龍 △8七角成 ▲9一龍 △8五玉 ▲5五龍 △6五桂打
- 30k recommended `mate 2`: ▲7二龍 △9三玉 ▲9二龍
- 60k actual `cp 6642`: ▲7二飛成 △9三玉 ▲6四龍 △7四銀打 ▲8二銀打 △9四玉 ▲8一龍 △8七角成 ▲9二龍 △8五玉 ▲8八香打 △同馬 ▲7七金打 △同馬 ▲同桂 △7六玉
- 60k recommended `mate 2`: ▲7二龍 △9三玉 ▲9二龍
- Branch Difference: recommended-only mate HIGHが一致。
- Candidate Reason: 「▲7二龍の読み筋は詰み評価です。▲7二飛成の読み筋は同じ詰み評価ではありません。」

### 3. 夢への旅路 42

- 30k actual `cp 1290`: △5六銀 ▲2五桂 △1五歩
- 30k recommended `cp 2011`: △3六銀 ▲6八金 △1五歩 ▲4六銀 △4四桂打 ▲5三歩打 △同飛 ▲1五歩 △4六角 ▲同歩 △4七銀打 ▲4五桂
- 60k actual `cp 1554`: △5六銀 ▲2五桂 △1五歩
- 60k recommended `cp 2383`: △3六銀 ▲6八金 △1五歩 ▲5三歩打 △1二飛 ▲1五歩 △2六歩 ▲同歩 △1五角 ▲3九玉 △2六角 ▲1二香成 △3七角成 ▲同銀 △同銀不成
- Branch Difference: 30kと60kでcapture sequenceが一致しない。
- Candidate Reason: 未解決。

### 4. NAGATA2532 28

- 30k actual `cp 316`: △4四銀 ▲5二飛成 △同金右 …
- 30k recommended `cp 568`: △6八角成 ▲同銀 △7八金打
- 60k actual `cp 208`: △4四銀 ▲5二飛成 △同金右
- 60k recommended `cp 601`: △6八角成 ▲同銀 △7八金打 ▲2三角打 △5一金 ▲7九角 △同金 ▲同銀 △3四角打 ▲同角成 △同歩 ▲5九飛 △3三桂 ▲6九金打 △6四銀 ▲5二飛成 △同金右 ▲2一飛打
- Branch Difference: 30kではactual-only飛車損HIGH、60kでは推奨枝にも後段の飛車損が現れ、意味差として不安定。
- Candidate Reason: 未解決。

### 5. しゅん 79

- 30k actual `cp 2154`: ▲5二銀打 △3三金 ▲6一銀不成
- 30k recommended `cp 890`: ▲2二角成 △同玉
- 60k actual `cp 1688`: ▲5二銀打 △3三金 ▲6一銀成 △4七歩成 ▲同歩 △6七角打 ▲5九歩打 △4八歩打 ▲3九金 △5九龍 ▲8二飛打 △4九歩成
- 60k recommended `cp 2730`: ▲2二角成 △同玉 ▲5二銀打 △4七歩成 ▲4三銀不成 △3八と ▲同金 …
- Branch Difference: 推奨枝の初手王手と角損は出るが、推奨手が良い理由として使えない。
- Candidate Reason: 未解決。

### 6. 夢への旅路 50

- 30k actual `cp 430`: △4二角 ▲同角成 △同金
- 30k recommended `cp 2022`: △3五歩打 ▲4六歩 △3六歩 ▲4五桂 △同銀 ▲同歩 △4六桂打 ▲4七銀打 △5八桂成 ▲同銀 △同歩成 ▲同金 △5六歩打 ▲4七金 △5七歩成 ▲同金
- 60k actual `cp 572`: △4二角 ▲同角成 △同金
- 60k recommended `cp 2331`: △3五歩打 ▲2五桂 △3六歩 ▲3四歩打 △1五歩 ▲3三歩成 △1六歩 ▲4三と △1七歩成 ▲同香 △同香成 ▲同玉 △1二飛 ▲1六歩打
- Branch Difference: actual-only major-piece-loss（角、2手目）HIGHが一致。
- Candidate Reason: 「△4二角の読み筋では2手目に角を取られます。△3五歩打の読み筋では同じ範囲ではその角を取られていません。」

### 7. 夢への旅路 84

- 30k actual `cp 3153`: △6四龍 ▲3三角打 △4五桂打 ▲5一角成 △3七桂成 ▲同銀 △2七歩打 ▲1七玉 △8二玉 ▲3二飛打 △7二桂打
- 30k recommended `cp 4037`: △4四龍 ▲3五金打 △2七歩打 ▲同馬 △5五龍 ▲3七馬 △8九銀不成 ▲3三角打 △4四桂打 ▲5一角成 △同龍 ▲3二飛打 △4二桂打
- 60k actual `cp 4124`: △6四龍 ▲4六金打 △6七龍 ▲6四歩打 △同歩 ▲4五角打 △8二玉 ▲6七角 △同銀不成 ▲2二飛打 △5二歩打 ▲7七桂
- 60k recommended `cp 4484`: △4四龍 ▲3五金打 △5五龍 ▲3三角打 △5八龍 ▲5一角成 △同龍 ▲1八玉 △3九角打 ▲3二飛打 △4二桂打
- Branch Difference: major-piece eventの発生枝・plyが一致しない。
- Candidate Reason: 未解決。

### 8. taatoru_cat 67

- 30k actual `cp -3070`: ▲3七銀 △4七歩成 ▲8三歩打 △3七と ▲8二角打 △6二玉 ▲7四桂打 △同歩 ▲3七角成 …
- 30k recommended `cp -2065`: ▲8三歩打 △同銀 ▲6五角打 △7二銀打 ▲2一飛成 △3六歩 ▲1一龍 …
- 60k actual `cp -3350`: ▲3七銀 △4七歩成 ▲8三歩打 △同銀 ▲2八銀 △2七歩打 ▲同玉 △5八と ▲8二歩打 △7二銀打 ▲1八玉 △2七歩打 ▲8一歩成 △同玉
- 60k recommended `cp -2076`: ▲8三歩打 △同銀 ▲5六角打 △7二銀打 ▲2一飛成 △9九龍 ▲5五桂打 △8二玉 ▲4三桂成 △同金 ▲5五桂打 △9六龍
- Branch Difference: actual初手のcapture以外は不安定で、悪手の因果を示さない。
- Candidate Reason: 未解決。

### 9. おまつ 80

- 30k actual `cp -2848`: △3三桂 ▲5一銀打 △7四歩 ▲3四歩 △6一銀打 ▲3三歩成 △4六桂打 ▲4三と右 △5八桂成 ▲同銀
- 30k recommended `cp -1645`: △4六桂打 ▲6八金右 △5八銀打 ▲5一銀打 △8二玉 ▲6二銀成 △同銀 ▲2一飛成 △6九銀不成 ▲同金 △7一金打 ▲7五桂打
- 60k actual `cp -2786`: △3三桂 ▲5一銀打 △4六桂打 ▲6二銀成 △同銀 ▲5一と △6九龍 ▲同玉 △5八桂成 ▲同銀 △7一金打 ▲2七飛成
- 60k recommended `cp -1883`: △4六桂打 ▲6八金右 △5八銀打 ▲5一銀打 △8二玉 ▲6二銀成 △同銀 ▲5一と △7一銀打 ▲5八金寄 △同桂成 ▲同金 △7九金打 ▲7七玉 △8九金 ▲6一金打
- Branch Difference: 30kは説明なし、60kはactual-only飛車損。安定しない。
- Candidate Reason: 未解決。

### 10. じゅんや 44

- 30k actual `cp -454`: △4四銀 ▲8六歩
- 30k recommended `cp 513`: △3四銀 ▲2二角成 △同飛
- 60k actual `cp -423`: △4四銀 ▲8六歩 △3三銀
- 60k recommended `cp 583`: △3四銀 ▲2二角成 △同飛
- Branch Difference: recommended-only角損HIGHが一致するが、推奨手の意味を説明しない。
- Candidate Reason: 未解決。

## 必須fixture追補

### しゅえい77

- 30k: actual `cp -857` / recommended `cp 1471`
- 60k: actual `cp -761` / recommended `cp 1770`
- 120k: actual `cp -882` / recommended `cp 1737`
- actualは30k/120kで4手目の角損、60kは3手PVで未到達。recommendedの▲8三歩打は60k/120kで初手王手、その後も歩を進める/連続王手のPV。ただし全応手で強制とは断定しない。
- Q1: △。Q2: △。

### しゅえい79（最重要）

- 30k actual `cp -1815`: ▲5六銀 △4四桂打 ▲3一飛打 △3六桂 … △6六馬
- 30k recommended `cp -831`: ▲6六角 △同馬 ▲同歩
- 60k actual `cp -1937`: ▲5六銀 △4四桂打 ▲8三歩打 △同玉 …
- 60k recommended `cp -1031`: ▲6六角 △同馬 ▲同歩 △5五角打 ▲3七角打 △同角成 …
- 120k actual `cp -2126`: ▲5六銀 △4四桂打 ▲8三歩打 △同玉 ▲3一飛打 … △同龍 ▲7七銀 △3七歩打 ▲同桂
- 120k recommended `cp -892`: ▲6六角 △同馬
- 最初のbranch差: ply 1。actualは5六の歩capture、recommendedは角移動。mate差なし。
- material/major/check/capture差: 30kは両枝で同じ角を失う（actual 10手目、recommended 2手目）。60kも同角損はshared。120kはrecommendedの角損とactualの12手目飛車損に分岐。check/capture sequenceも探索量で変化。
- Q1: 未解決（×）。Q2: 未解決（×）。評価差だけで文章を作らない。

### しゅえい159

- 30k actual `mate -7` / recommended `cp -7141`
- 60k actual `mate -7` / recommended `cp -35281`
- 120k actual `mate -7` / recommended `mate -15`
- actualの短い詰みは安定。recommendedの▲7二金打は初手王手を維持するが、120kで詰み評価になり「詰み回避」は成立しない。
- Q1: △。Q2: 未解決（×）。

## Human scorecard

| 質問 | ○ | △ | × | コメント |
|---|---:|---:|---:|---|
| Q1 なぜ実戦手が悪い？ |  |  |  |  |
| Q2 なぜ推奨手が良い？ |  |  |  |  |
| Q3 次に役立つ？ |  |  |  |  |

Q3候補は全件生成なし。Human Review完了までは新Reasonと「次に確認すること」をproduction表示しない。
