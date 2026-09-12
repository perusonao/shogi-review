# SHOGI Reason Explanation Candidate — 代表10局面 Human Review Gate

## 1. 結論

- 監査SSOTは、開始時に `git fetch` 後の `origin/main` / `HEAD` が一致した `afff938c8a63e603a1a2b2e6844c76e85bfb6fe9`。
- 対象はPhase 2監査で抽出した代表10局面。最新SSOTとの差分を確認し、対象局のgame JSON、analysis JSON、`reason-evidence.js` は前回から不変だった。
- Q1は○4 / △1 / ×5、Q2は○3 / △3 / ×4、Q3は○3 / △2 / ×5。
- そのままproduction可は2件だけ。文章調整1件、Branch Difference解析3件、追加水匠探索4件。
- Candidateの数値改善だけではproduction gateを通過しない。最終推奨は **C: Branch Difference解析を先に実装**。保存済み両枝PVで改善できるものを先に処理し、それでもactual枝が不足する局面だけを追加探索へ送る。
- D64は一括非表示にしない。保存済みactual/recommended PVが各2手以上ある5件はD-B、actual枝等が不足する59件はD-C。D-Aはこのgateでは0件で、Branch Difference後にも安定した説明差が得られない場合に初めて「表示しない」を確定する。

## 2. 監査条件

| 項目 | 内容 |
|---|---|
| repository | `perusonao/shogi-review` |
| SSOT | `afff938c8a63e603a1a2b2e6844c76e85bfb6fe9` |
| 参照 | `docs/reports/SHOGI_REASON-EXPLANATION_Phase2_HUMAN-AUDIT.md` |
| 対象 | 前回抽出済み代表10局面 |
| 禁止 | production変更、再解析、棋理推測、commit、push |
| 判定単位 | Candidate文章がQ1/Q2/Q3へ直接答えるか。評価低下、推奨手名、PV中の駒取りの存在だけでは○にしない |

前回監査SSOT `ab551dd…` から今回SSOT `afff938…` までの該当範囲の変更は、新規3局と `games/index.json` への追記だけだった。代表10局面の保存データとCandidate文章は再生成せず、そのままレビューした。

## 3. Gate結果一覧

| # | 対局・手目 | Q1 | Q2 | Q3 | 実装判定 | Dの扱い |
|---:|---|:---:|:---:|:---:|---|---|
| 1 | ryunenbb vs sonao81 80手目 | ○ | △ | ○ | Branch Difference解析が必要 | - |
| 2 | sonao81 vs ak69Boy 131手目 | ○ | ○ | △ | 文章調整で可 | - |
| 3 | 夢への旅路 vs ぺるそなお 42手目 | △ | △ | △ | Branch Difference解析が必要 | - |
| 4 | NAGATA2532 vs sonao81 28手目 | ○ | ○ | ○ | そのままproduction可 | - |
| 5 | ぺるそなお vs しゅん 79手目 | × | △ | × | 追加水匠探索が必要 | C: 水匠5の追加探索が必要 |
| 6 | 夢への旅路 vs ぺるそなお 50手目 | ○ | ○ | ○ | そのままproduction可 | - |
| 7 | 夢への旅路 vs ぺるそなお 84手目 | × | × | × | Branch Difference解析が必要 | B: 保存済みPVをもっと解析すれば説明可能 |
| 8 | sonao81 vs taatoru_cat 67手目 | × | × | × | 追加水匠探索が必要 | C: 水匠5の追加探索が必要 |
| 9 | おまつ vs ぺるそなお 80手目 | × | × | × | 追加水匠探索が必要 | C: 水匠5の追加探索が必要 |
| 10 | じゅんや vs ぺるそなお 44手目 | × | × | × | 追加水匠探索が必要 | C: 水匠5の追加探索が必要 |

集計:

- そのままproduction可: 2
- 文章調整で可: 1
- Branch Difference解析が必要: 3
- 追加水匠探索が必要: 4

## 4. 代表10局面レビュー資料

### 1. ryunenbb vs sonao81 80手目 — Current A → Candidate A

| 項目 | 内容 |
|---|---|
| ユーザー先後 | 後手 |
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

#### Human Review判定

| 質問 | 判定 |
|---|:---:|
| Q1 「なぜ実戦手が良くなかったか」に答えているか | ○ |
| Q2 「なぜ推奨手の方が良いか」に答えているか | △ |
| Q3 次に似た局面で役立つか | ○ |
| 実装分類 | Branch Difference解析が必要 |
| D分類 | - |

根拠: 実戦枝が mate -5 で詰みに至ることには答えている。推奨枝が同じmate評価でないことは示すが、なぜ△7五桂打なのかという手段の説明はない。連続王手確認は再利用可能。

### 2. sonao81 vs ak69Boy 131手目 — Current B → Candidate A

| 項目 | 内容 |
|---|---|
| ユーザー先後 | 先手 |
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

#### Human Review判定

| 質問 | 判定 |
|---|:---:|
| Q1 「なぜ実戦手が良くなかったか」に答えているか | ○ |
| Q2 「なぜ推奨手の方が良いか」に答えているか | ○ |
| Q3 次に似た局面で役立つか | △ |
| 実装分類 | 文章調整で可 |
| D分類 | - |

根拠: 実戦手でmate表示を失い、推奨枝だけmate 3で王手が1・3手目にある比較は明確。次の局面へ転用する確認手順が本文にない。

### 3. 夢への旅路 vs ぺるそなお 42手目 — Current A → Candidate A

| 項目 | 内容 |
|---|---|
| ユーザー先後 | 後手 |
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

#### Human Review判定

| 質問 | 判定 |
|---|:---:|
| Q1 「なぜ実戦手が良くなかったか」に答えているか | △ |
| Q2 「なぜ推奨手の方が良いか」に答えているか | △ |
| Q3 次に似た局面で役立つか | △ |
| 実装分類 | Branch Difference解析が必要 |
| D分類 | - |

根拠: 6手後の歩4枚差は比較結果だが、△5六銀の何が差につながったか、△3六銀がなぜ良いかは説明していない。具体的な分岐点が必要。

### 4. NAGATA2532 vs sonao81 28手目 — Current C → Candidate A

| 項目 | 内容 |
|---|---|
| ユーザー先後 | 後手 |
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

#### Human Review判定

| 質問 | 判定 |
|---|:---:|
| Q1 「なぜ実戦手が良くなかったか」に答えているか | ○ |
| Q2 「なぜ推奨手の方が良いか」に答えているか | ○ |
| Q3 次に似た局面で役立つか | ○ |
| 実装分類 | そのままproduction可 |
| D分類 | - |

根拠: 実戦枝の直後に飛を取られ、推奨枝の同位置ではその損失がない。Q1/Q2の比較と次回の確認行動が一続きで読める。

### 5. ぺるそなお vs しゅん 79手目 — Current D → Candidate B

| 項目 | 内容 |
|---|---|
| ユーザー先後 | 先手 |
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

#### Human Review判定

| 質問 | 判定 |
|---|:---:|
| Q1 「なぜ実戦手が良くなかったか」に答えているか | × |
| Q2 「なぜ推奨手の方が良いか」に答えているか | △ |
| Q3 次に似た局面で役立つか | × |
| 実装分類 | 追加水匠探索が必要 |
| D分類 | C: 水匠5の追加探索が必要 |

根拠: 実戦手が王手でないことは悪い理由にならない。推奨手が王手という特徴だけでは優越理由に届かず、actual PVも保存されていない。

### 6. 夢への旅路 vs ぺるそなお 50手目 — Current C → Candidate A

| 項目 | 内容 |
|---|---|
| ユーザー先後 | 後手 |
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

#### Human Review判定

| 質問 | 判定 |
|---|:---:|
| Q1 「なぜ実戦手が良くなかったか」に答えているか | ○ |
| Q2 「なぜ推奨手の方が良いか」に答えているか | ○ |
| Q3 次に似た局面で役立つか | ○ |
| 実装分類 | そのままproduction可 |
| D分類 | - |

根拠: 実戦枝では角が直後に取られ、推奨枝では同位置にその損失がない。説明と確認手順が保存PVの範囲で閉じている。

### 7. 夢への旅路 vs ぺるそなお 84手目 — Current B → Candidate D

| 項目 | 内容 |
|---|---|
| ユーザー先後 | 後手 |
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

#### Human Review判定

| 質問 | 判定 |
|---|:---:|
| Q1 「なぜ実戦手が良くなかったか」に答えているか | × |
| Q2 「なぜ推奨手の方が良いか」に答えているか | × |
| Q3 次に似た局面で役立つか | × |
| 実装分類 | Branch Difference解析が必要 |
| D分類 | B: 保存済みPVをもっと解析すれば説明可能 |

根拠: Candidateは非表示。両枝PVは十分保存されており、現在のcapture templateではなく局面差分を再抽出する余地がある。

### 8. sonao81 vs taatoru_cat 67手目 — Current B → Candidate D

| 項目 | 内容 |
|---|---|
| ユーザー先後 | 先手 |
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

#### Human Review判定

| 質問 | 判定 |
|---|:---:|
| Q1 「なぜ実戦手が良くなかったか」に答えているか | × |
| Q2 「なぜ推奨手の方が良いか」に答えているか | × |
| Q3 次に似た局面で役立つか | × |
| 実装分類 | 追加水匠探索が必要 |
| D分類 | C: 水匠5の追加探索が必要 |

根拠: Candidateは非表示で、actual PVが保存されていない。推奨枝だけのdrop/captureから実戦手の悪さは説明できない。

### 9. おまつ vs ぺるそなお 80手目 — Current D → Candidate D

| 項目 | 内容 |
|---|---|
| ユーザー先後 | 後手 |
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

#### Human Review判定

| 質問 | 判定 |
|---|:---:|
| Q1 「なぜ実戦手が良くなかったか」に答えているか | × |
| Q2 「なぜ推奨手の方が良いか」に答えているか | × |
| Q3 次に似た局面で役立つか | × |
| 実装分類 | 追加水匠探索が必要 |
| D分類 | C: 水匠5の追加探索が必要 |

根拠: Candidateは非表示で、actual PVがなく推奨PVも2手だけ。桂打ちという特徴だけでは理由にならない。

### 10. じゅんや vs ぺるそなお 44手目 — Current D → Candidate D

| 項目 | 内容 |
|---|---|
| ユーザー先後 | 後手 |
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

#### Human Review判定

| 質問 | 判定 |
|---|:---:|
| Q1 「なぜ実戦手が良くなかったか」に答えているか | × |
| Q2 「なぜ推奨手の方が良いか」に答えているか | × |
| Q3 次に似た局面で役立つか | × |
| 実装分類 | 追加水匠探索が必要 |
| D分類 | C: 水匠5の追加探索が必要 |

根拠: Candidateは非表示で、actual PVなし、推奨PVも初手だけ。評価低下だけではQ1の○にできない。

## 5. D64の扱い

Candidate D=64を「表示しない」で完了扱いにはしない。保存状況による一次triageは次のとおり。

| D分類 | 件数 | 判定 |
|---|---:|---|
| A: 説明を出さない方がよい | 0（未確定） | Branch Differenceを試しても安定差が出ない場合に確定 |
| B: 保存済みPVをもっと解析すれば説明可能 | 5 | 両枝PVが各2手以上保存済み。先にBranch Difference解析 |
| C: 水匠5の追加探索が必要 | 59 | actual PVまたは比較に必要な枝長が不足 |

D-Bの5件は、夢への旅路84・94・130手目、NAGATA2532 46・52手目。D-Cへ直ちに全件追加探索をかけるのではなく、Branch Differenceの出力schemaと有用性をこの5件で固めてから、59件の追加探索条件を限定する。

## 6. ryunenbb 80手目 Gate

- Q1 ○: `△5二金`の実戦枝が`mate -5`で、保存PV上も相手の王手が続くことを具体的に示す。
- Q2 △: `△7五桂打`の枝が`cp -7578`で「同じmate評価ではない」ことは示すが、なぜ△7五桂打なのか、どのbranch differenceが詰み表示を外すのかには答えていない。
- Q3 ○: 相手の次の王手と応手後の継続を確認する手順は、この保存PVから安全に一般化できる。
- 安全に言える上限は「実戦枝では詰み評価」「推奨枝では同じmate評価ではない」。桂打ちの狙い、唯一性、守備効果は現Candidateから補完しない。
- 判定: Branch Difference解析が必要。

## 7. Phase 3 UI仕様（固定）

### 盤面マーカー

- `実` / `推` の文字は廃止。
- 赤マーカー内に実際に指した駒文字を表示する。
- 青マーカー内に推奨手の駒文字を表示する。
- 駒打ちも同じく駒文字を表示する。
- 例: ▲5六銀は赤マーカー内「銀」、▲6六角は青マーカー内「角」。

### 下部の実戦/推奨表示

- 大型の駒カードは廃止。
- 棋譜表記中心の2列または小型2カード: `実戦　▲5六銀` / `推奨　▲6六角`。
- 盤面下では駒画像より説明文の表示領域を優先し、縦幅を削減する。

### 手数表示

- `指す直前` は廃止。
- 前後ボタンと同じ行に短い `79手目` を表示する。
- `79手目を振り返る` より、iPhoneでは `79手目` を採用する。

## 8. 最終判断

**C. Branch Difference解析を先に実装**を推奨する。

理由は、Candidateが安全でもQ2を十分に満たさない代表例があり、特に必須fixtureのryunenbb 80手目で「なぜ△7五桂打なのか」が未回答だからである。先に保存済みPVの枝差を構造化し、mate/check/capture/materialの「差が生じる最初のply」を抽出する。その結果でも説明不能でactual PVが不足する局面だけ、対象を限定して追加水匠探索へ進む。Candidate文章のproduction反映とUI変更は、このgateでは行わない。

## 9. 制約確認

- production変更: なし
- 再解析: なし
- commit / push: なし
- 作成物: 本レポートのみ
