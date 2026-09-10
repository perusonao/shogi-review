# 将棋ウォーズ対局 自動取込フェーズ1 結果

- 実施日: 2026-09-10
- base SHA: `98f1378a67b60a03db7064f959b2b26986c18766`
- push先: `origin/main` (`https://github.com/perusonao/shogi-review.git`)
- 実装commit SHA: `7036c4cbb1fa37b59f0d06a7eae2221f52c4418b`

## 採用した棋譜取得方式

将棋ウォーズ公式画面からユーザー自身がKIFを保存し、`games/inbox/`へ投入する方式を正式採用した。

### 自動取得可否

自動取得は採用しなかった。HEROZの2026年5月8日告知は、将棋ウォーズの棋譜・対局データについてスクレイピング等による取得を控えるよう案内している。第三者の棋譜検索サイトも調査したが、HTML依存、運営者への負荷、公式方針との整合性を考慮し、自動巡回・自動ダウンロードは実装していない。

- 公式告知: <https://shogiwars.heroz.jp/topics/69fd8cd95c5ebbf0d981199b>
- HEROZガイドライン: <https://heroz.co.jp/guideline/game/>
- 調査候補: <https://shogiwars.hibinotatsuya.com/>

### fallback方式

`games/inbox/*.kif`。UTF-8/UTF-8 BOM/CP932を受け付ける。CSAはフェーズ1では未対応とし、検出時はファイルを残したまま日本語で安全停止する。

## 新規棋譜判定・重複防止

- KIFを合法手として読み込み、日付、先手、後手、USI指し手列を正規化する。
- 正規化データのSHA-256 fingerprintを既存`games/*.kif`および同一inbox内で照合する。
- 同一fingerprintは再解析・index再登録しない。処理済みの重複inboxファイルだけを除去する。
- game IDは`YYYYMMDD_opponent`。ID衝突時はfingerprint先頭8文字をsuffixにする。
- 解析途中で失敗したKIFはinboxに残し、game/indexへ反映しない。
- 正常完了後は元KIFを`games/<game-id>.kif`へ保存し、inboxから除去する。

## Windowsランチャー

`analyze-new-games.bat`を追加した。repository root、Python、YaneuraOu、`nn.bin`を確認し、`tools/import_new_games.py`を実行する。GitHub公開は対話確認で`y`を入力した場合だけ行う。

公開時は次を安全確認する。

- `main`ブランチであること
- `git fetch`後、HEADと`origin/main`が一致すること
- `games/index.json`に未保存変更がないこと
- 今回生成したKIF、game JSON、analysis JSON、indexだけをstage/commitすること
- exe/bin/7z/zipが対象にないこと
- `git diff --cached --check`成功後にpushすること

既存GitHub ActionsのKIF push時再変換は、解析済みgame JSONの課題局面を消す恐れがあるため、手動検証専用へ変更した。

## engine設定

- YaneuraOu: V9.00 NNUE halfKP256 AVX2
- 実行ファイル: `C:\shogi-engine\yaneuraou\NNUE_halfkp_256x2_32_32\YaneuraOu_NNUE_halfkp_256x2_32_32-V900Git_AVX2.exe`
- 水匠5: `C:\shogi-engine\suisho5\nn.bin`
- nodes: 30,000 / position（変更不可）
- `USI_OwnBook=false`
- 解析SSOT: `tools/analyze_with_suisho5.py`

## テスト結果

- 隔離した一時inboxへ既存`20260910_yogra.kif`をコピーして実エンジンE2E: 成功
- 67手、68局面を30,000 nodesで解析: 成功
- game JSON / analysis JSON / 課題局面 / index生成: 成功
- 2回目（inbox空）: 新規0件、index重複なし
- 同一KIF再投入: 再解析なし、重複除去、index 1件のまま
- CP932 KIF再投入: 正常認識、重複判定成功
- 標準KIFの`同` / `不成`表記: USI変換成功
- game ID衝突: fingerprint suffixで一意化成功
- 解析済み局skip: 成功
- engine不存在: exit 1、安全停止
- `nn.bin`不存在: exit 1、安全停止
- 不正KIF: exit 1、inboxに保持、index不変
- CSA: 未対応を明示して安全停止、inboxに保持
- Windowsランチャー（公開なし）: exit 0
- Python構文確認: 成功
- `git diff --check`: 成功
- 既存4局のKIF/game/analysis/index: 無変更
- PWA棋譜一覧: 既存4局すべて解析済み表示可能

## 変更ファイル

- `.gitignore`
- `.github/workflows/build-game-data.yml`
- `README.md`
- `analyze-new-games.bat`
- `games/inbox/.gitkeep`
- `tools/kif_to_game.py`
- `tools/import_new_games.py`
- `docs/ADDING_GAMES.md`
- `docs/reports/SHOGI_AUTO-IMPORT-1_Result.md`
- `index.html`（`games/index.json`のみno-cache取得へ変更）

## PWA反映可否

可能。実装commitのGitHub Pages build/deployは成功し、公開PWAでno-cache版コードと既存4局の表示を確認した。公開を選んだ実行では生成物を`origin/main`へpushし、「GitHub Pagesの反映待ち」と日本語表示する。PWAは毎回`games/index.json`をno-cacheで取得するため、新規カタログを再オープン時に取得する。

## 今後ユーザーが行う操作

1. 将棋ウォーズ公式画面から自分の対局をKIFで保存する。
2. `games/inbox/`へ入れる。
3. `analyze-new-games.bat`をダブルクリックする。
4. GitHub公開する場合だけ`y`を入力する。
5. 完了後、数分待ってiPhone PWAを開き直す。
