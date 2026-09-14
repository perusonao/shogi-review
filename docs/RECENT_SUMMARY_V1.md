# Recent Summary v1

PWA は `games/index.json` の解析済み対局を日付降順、同日なら game ID 降順で安定ソートし、重複 ID を除いた直近10局・30局を集計する。指定数未満なら利用可能な全件を使い、`sampleGames` に実数を保存する。

`recent-summary-v1` は `window`、`sampleGames`、`gameIds`、`themes`、`recurringChallenges`、`improvements`、`strengths`、`phaseSummary` を持つ。theme は `check / capture / promotion / drop` で、`opportunities / pass / fail / noOpportunity / passRate / trend / evidenceRefs` を返す。`passRate` は `pass / (pass + fail)` で、比較可能結果がなければ `null`。`－` は分母に含めない。

入力は `task-result-evidence-v1` 相当の機械検証済み結果に限定する。○は合法手特徴で opportunity と played が共に true、×は opportunity が true、played が false、かつ `verifiedIssues` 参照がある場合だけ採用する。legacy、不正な game ID、未知 theme/status は安全に無視する。

trend は同一themeの時系列○/×が4件以上あり、前半・後半が各2件以上の場合だけ判定する。後半○率－前半○率が +0.25 以上なら `improving`、-0.25 以下なら `worsening`、それ未満は `stable`。不足時は `insufficient_data`。

- recurring challenge: 異なる2局以上で機械検証済み×が2件以上
- improvement: trend が `improving`
- strength: 比較可能結果3件以上、○3件以上、○率75%以上、直近2比較結果が共に○

各 insight と theme は game ID、ply、task result ID、status の evidence ref を保持する。PWA から game ID を読み込み、ply がある場合は盤面へ移動できる。

phase は機械検証済み opportunity に根拠 ply がある場合だけ、既存 production の手数進捗 35%/75% 境界（opening/middlegame/endgame）で集計する。根拠のない `－` や legacy 対局を推定で phase に割り当てない。
