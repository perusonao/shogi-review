# Calibration dataset imports

Phase D2の追加教師データ置き場。大量自動scrapingは使用しない。

利用可能な入力経路は、既存KIF、ユーザーが提供したKIF、既存metadata、通常のPWA KIF投入だけである。KIFを通常経路で解析した後、`tools/manage_skill_dataset.py` は既存のderived featureをread-onlyで取り込む。既存analysis JSONは変更せず、再解析もしない。

追加済みのflat CSV/JSON/JSONLまたはv2 datasetを検証・統合する例:

```text
python tools/manage_skill_dataset.py --additional data/calibration/imports/batch.jsonl --dataset-out data/calibration/dataset-v2.json --report-out data/calibration/dashboard.json --checkpoint-audit-out data/calibration/checkpoint-audit.json
```

追加行には `provider`, provider-scoped opaque `player_id`, `official_rank`（raw/normalizedは保存時に併記）, `time_control`, `side`, `result`, `game_id` とoverall/opening/middlegame/endgameのscore・coverage・eligible movesが必要。display nameを入力に含めた場合はstable IDとの一致確認だけに使い、dataset artifactには保存しない。`collection_route` は `existing-kif`, `user-provided-kif`, `existing-metadata`, `pwa-kif-submit` のいずれかに限定される。

rankやproviderが欠ける既存行は収集台帳には保持されるが、pilot cohortにも学習にも入らない。Stage 1/2/3到達時のauditは再評価点であり、production承認ではない。
