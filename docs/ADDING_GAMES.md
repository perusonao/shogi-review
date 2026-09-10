# 新しい対局を追加する手順

Windowsでは次の操作だけでよい。

1. 将棋ウォーズ公式画面から自分の対局をKIF形式で保存する。
2. KIFを`games/inbox/`へ入れる。
3. リポジトリ直下の`analyze-new-games.bat`をダブルクリックする。
4. GitHubへ公開する場合だけ確認に`y`を入力し、完了表示を待つ。
5. GitHub Pages反映後、iPhoneのPWAを開き直す。

GitHub公開を選ばない場合、生成物はローカルに残る。内容を確認して手動でcommit/pushできる。

## 棋譜取得方針

HEROZは2026年5月8日の告知で、将棋ウォーズ棋譜・対局データのスクレイピング取得を控えるよう案内している。このため、将棋ウォーズや第三者検索サイトのHTMLを自動巡回しない。

- 正式方式: 将棋ウォーズ公式画面からユーザー自身が保存したKIFのinbox投入
- 未対応: CSA（KIF形式で保存し直す）
- 認証情報、Cookie、CAPTCHA回避は使用しない
- GitHub公開は明示的に`y`を選んだ場合のみ行う。公開権限とリポジトリの公開範囲を事前に確認する

参考:

- 将棋ウォーズ「棋譜・対局データのお取扱いについて」: <https://shogiwars.heroz.jp/topics/69fd8cd95c5ebbf0d981199b>
- 候補として調査した棋譜検索サイト: <https://shogiwars.hibinotatsuya.com/>

## 自動処理

`analyze-new-games.bat`は`tools/import_new_games.py`を起動し、次を順に行う。

1. repository root、Python、YaneuraOu、水匠5 `nn.bin`を確認
2. `games/inbox/*.kif`をUTF-8またはCP932で読み、合法手を検証
3. 棋譜内容のSHA-256 fingerprintで既存棋譜と照合
4. `YYYYMMDD_opponent`（衝突時はfingerprint suffix）でgame IDを決定
5. `tools/analyze_with_suisho5.py`を使い30,000 nodes/局面で解析
6. game JSON、analysis JSON、課題局面、`games/index.json`を検証して反映
7. 正常処理済みKIFを`games/<game-id>.kif`へ保存し、inboxから除去
8. 公開を選んだ場合のみ、今回の生成物だけをcommitして`origin/main`へpush

同じ棋譜を再投入しても、指し手列・対局者・日付から作るfingerprintが同じなら再解析・重複登録しない。

## 解析設定

- YaneuraOu V9.00 NNUE halfKP256 AVX2
- 水匠5: `C:\shogi-engine\suisho5\nn.bin`
- `USI_OwnBook=false`
- 30,000 nodes / position
- 評価値は先手視点
- 解析ロジックのSSOT: `tools/analyze_with_suisho5.py`

## 保存対象

```text
games/<game-id>.kif
games/<game-id>.json
analysis/<game-id>.json
games/index.json
```

YaneuraOuのexe、`nn.bin`、7z/zip、`.partial`などの一時ファイルは保存・commitしない。
