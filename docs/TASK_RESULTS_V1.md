# Task Results v1

新規対局の解析完了時に、直前の completed game が持つ active `currentTasks`（最大3件）を
`moveAnalyses`、`verifiedIssues`、合法手を検証できる対局前 SFEN と比較し、
`analysis/<game-id>.json` の `taskResults` へ保存する。既存JSONにこのプロパティがなくても
PWAは判定欄を表示せず、安全に読み込む。

```json
{
  "taskResults": [{
    "id": "tr1-<deterministic hash>",
    "taskId": "ct1-...",
    "status": "pass | fail | no_opportunity",
    "label": "○ | × | －",
    "gameId": "game-b",
    "ply": 45,
    "reason": {
      "code": "opportunity_satisfied | verified_repeated_issue | no_opportunity | insufficient_evidence",
      "text": "短い表示理由"
    },
    "evidence": {
      "schema": "task-result-evidence-v1",
      "verification": "legal-move-feature",
      "theme": "check | capture | promotion | drop",
      "opportunity": {"source": "moveAnalyses.bestMove", "move": "...", "featureVerified": true},
      "played": {"source": "moveAnalyses.actualMove", "move": "...", "featureVerified": true}
    }
  }]
}
```

判定順は決定論的である。同じテーマの verified miss が1件でもあれば `×`、なければ
同テーマを実戦手で満たした機会があれば `○` とする。推奨手に同テーマがなければ
`－ / no_opportunity`、推奨手にはあるが実戦手と `verifiedIssues` から成功・失敗を
断定できなければ `－ / insufficient_evidence` とする。評価値は判定根拠に使わない。

`id` は task ID と結果 game ID の SHA-256 から生成し、再処理でも同一になる。
`taskResults` は task ID ごとに1件だけ保存する。

判定後の active `currentTasks` は `×` の継続課題、新しい対局の verified evidence から
生成した課題、`－` の継続課題、`○` の継続候補の順に比較する。同じ theme は1件へ統合し、
最大3件にする。したがって `○` を自動的に克服とはせず、新しい優先候補があれば入れ替える。
