# Current Tasks v1

新規解析の `analysis/<game-id>.json` は、根拠がある場合だけ `currentTasks` を0〜3件保存する。
既存analysis JSONにこのプロパティがなくても、PWAは0件として表示する。

```json
{
  "currentTasks": [{
    "id": "ct1-<deterministic hash>",
    "title": "王手候補を確認する",
    "nextCheck": {
      "schema": "current-task-check-v1",
      "theme": "check",
      "description": "次の解析で…○/×/－判定する。",
      "observation": {
        "scope": "nextAnalyzedGame",
        "opportunitySource": "moveAnalyses.bestMove",
        "playedSource": "moveAnalyses.actualMove",
        "failureSource": "verifiedIssues",
        "feature": "check"
      },
      "passWhen": "opportunity-and-played-feature",
      "failWhen": "opportunity-and-verified-miss",
      "resultValues": ["○", "×", "－"],
      "noOpportunityResult": "－"
    },
    "evidence": {
      "kind": "verifiedIssue",
      "fact": "推奨手は王手です。",
      "played": "...",
      "best": "...",
      "playedJa": "...",
      "bestJa": "...",
      "lossCp": 800,
      "points": ["推奨手は王手です。"]
    },
    "sourceGame": "game-id",
    "sourcePly": 45,
    "occurrences": 2,
    "priority": 4,
    "ranking": {
      "importanceLossCp": 800,
      "reproducibilityOccurrences": 2,
      "evidenceStrength": "HIGH"
    }
  }]
}
```

候補は `verifiedIssues[].points` のうち推奨初手について機械検証済みの事実、または合法な推奨初手の駒打ち表記だけから作る。対象テーマは `check / capture / promotion / drop`。同じテーマは1件へ統合し、最大損失の局面を代表根拠にする。並びは損失、同テーマ出現回数、根拠強度、固定テーマ優先度、手数、IDの順で決定論的に決め、先頭3件だけを保存する。

`id` は `game id + theme` のSHA-256から作るため、同じゲームの再解析・再試行で同じ課題を重複生成しない。抽象的な棋風・心理、PVの2手目以降だけに現れる特徴、比較材料のない評価値だけでは課題を作らない。

後続対局では `observation` に従い、推奨手にテーマの特徴がある局面を機会として検出する。実戦手にも同じ特徴があれば○、その特徴を逃して `verifiedIssues` になれば×、機会がなければ－とする。機会はあるがどちらにも確定できない場合も、推測せず－とする。
