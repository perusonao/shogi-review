# iPhone棋譜送信の初回セットアップ

この手順ではCloudflare Worker + D1を作成する。Windowsへのport forwardingやincoming HTTPは不要で、workerはHTTPSのoutbound pollだけを行う。

## 1. Cloudflareへログイン

Cloudflare Dashboardを開いてログインし、Workers & Pagesを利用できる状態にする。無料プランでよい。

## 2. CLIを準備

WindowsでNode.js 22以降が使えることを `node --version` で確認する。次にリポジトリの `backend/cloudflare` を開き、以下を実行する。

```powershell
npm install
npx wrangler login
npx wrangler d1 create shogi-review-queue
```

ブラウザのCloudflare認可画面で許可する。表示されたD1の `database_id` を控える。

## 3. Worker設定を作る

`backend/cloudflare/wrangler.toml.example` を `backend/cloudflare/wrangler.toml` にコピーし、`database_id` を前画面の値へ置換する。GitHub PagesのURLが異なる場合は `ALLOWED_ORIGINS` も変更する。このファイルはGit対象外である。

次にD1 schemaを適用する。

```powershell
npx wrangler d1 execute shogi-review-queue --remote --file schema.sql
```

## 4. 2種類のsecretを登録

推測困難な16文字以上の値を、PWA送信用とWindows worker用に別々に決める。平文は自分のpassword manager等に保管し、Gitへ書かない。

リポジトリ直下で次を2回実行し、それぞれのSHA-256を得る。

```powershell
python tools/hash_secret.py
```

`backend/cloudflare` で次を実行し、各プロンプトには平文ではなく対応するSHA-256を貼る。

```powershell
npx wrangler secret put SUBMIT_SECRET_HASH
npx wrangler secret put WORKER_SECRET_HASH
```

Workerは受信したBearer secretをSHA-256化して照合する。repositoryや公開PWAにはsecretもhashも入らない。

## 5. Workerを公開

```powershell
npx wrangler deploy
```

表示された `https://...workers.dev` URLを控える。これはqueue APIの公開URLであり、認証なしのKIF登録・状態取得・claimは拒否される。

## 6. Windows workerを設定

リポジトリ直下の `worker-config.bat.example` を `worker-config.bat` にコピーする。ファイル内へWorker URLとworker用の平文secretを設定する。このファイルはGit対象外である。

対象ユーザー名は、非secretの `config/worker-aliases.json` にUTF-8で保存する。Python workerが `encoding="utf-8"` を明示して直接読むため、日本語aliasを `worker-config.bat` に書かないこと。既定では `ぺるそなお` と `sonao81` を登録している。aliasを変更する場合は `userNames` 配列を編集し、曖昧一致や部分一致ではなく、NFKC正規化と外側空白除去後の完全一致で本人判定されることを確認する。

旧環境との互換用に `analysis_worker.py --users` と `SHOGI_USER_NAMES` は残しているが、通常のlauncherはUTF-8 JSONを明示して起動する。既存のlocal `worker-config.bat` に `SHOGI_USER_NAMES` が残っていてもlauncherでは使用されない。別ファイルを使う場合だけ、ASCII pathの `SHOGI_USER_NAMES_FILE` を設定する。

まず `start-analysis-worker.bat --max-jobs 3` でcanaryを実行し、D1・artifact・GitHub Pagesを確認する。`--max-jobs N` は成功・失敗を問わずclaimしたN件で終了する。従来の `--once` は1件だけclaimする契約を維持し、両オプションの同時指定はできない。引数なしの既定動作は従来どおりpollを継続する。

起動時に最新 `origin/main` から専用のdetached worktree（既定: `%LOCALAPPDATA%\shogi-review-worker`）を作成・更新するため、開発用checkoutが別branchやdirty状態でも解析へ混入しない。保存先を変える場合だけ、`worker-config.bat` に `SHOGI_WORKER_ROOT` を設定する。

workerはWindowsのmachine-wide named mutexを第一authorityとして、異なるcheckoutを含む同一PC上の二重起動をclaim前に拒否する。異常終了後はOSがmutexを解放する。`setup-worker-task.bat` が登録するTaskも第二防御として `MultipleInstances=IgnoreNew`、失敗時1分間隔・最大3回再起動、通常のinteractive user / limited権限、実行時間上限なしで構成する。隔離ユーザーからのTask登録はスクリプトが拒否する。3-job canaryと確認が完了するまでTaskを登録しないこと。

queue schemaを既存環境から更新する場合は、Workerコードをdeployする前に次のmigrationを1回だけ適用する。

```powershell
cd backend\cloudflare
npx wrangler d1 migrations apply shogi-review-queue --remote
npx wrangler deploy
```

このmigrationは既存行へ `attempt_count=0` を補い、nullableな `failure_stage` / `last_error_at` を追加する。KIF・status・game_idは変更しない。claim後は5分leaseを60秒ごとにheartbeatし、tokenまたはstatusが一致しない場合やheartbeat通信が不確実な場合は、古いworkerがcomplete/fail/publishを続けないよう停止する。

Git push拒否、dirty checkout、origin/mainとのahead/divergedを検出した場合はforce push・reset・自動rebaseを行わず停止する。ログのHEAD/origin SHAと、保持されたlocal commit/artifactを人間が確認してから復旧する。

## 7. iPhone PWAを設定

GitHub PagesのPWAを開き、「棋譜を追加」を選ぶ。Worker URLとPWA送信用の平文secretを入力して「この端末に保存」を押す。値はiPhoneのlocalStorageだけに保存され、HTTPSでWorkerへ送られる。

## 8. 利用する

将棋ウォーズでKIFをコピーし、「クリップボードから貼り付け」を押す。対局者・日時・手数・結果を確認し、KIFでUNKNOWNのprovider・持ち時間・対局時段級だけを選んで「解析する」を押す。metadataが完全なKIFでは追加選択はない。前回の段級は候補として表示されるだけで、自動入力されず毎回1 tap確認が必要である。送信成功は、原棋譜がD1へ永続保存され、同じ内容を読み戻せたことを意味する。PWAは `原棋譜：保存済み` と、解析の `待機中 / 処理中 / 失敗 / 完了` を分けて表示する。request IDは端末へ保存され、PWAを閉じても次回起動時に状態を再取得する。

同一fingerprintが解析済みなら既存game IDへ案内し、queue中なら既存request IDを再利用する。解析失敗時も原棋譜はD1に残り、failedだけ同じrequest IDと保存済みKIFから「再試行」できる。

## セキュリティ上の注意

- PWA送信用とworker用に同じsecretを使わない。
- `worker-config.bat` と `wrangler.toml` はcommitしない。
- `worker-config.bat` には日本語aliasを置かない。非secret aliasはUTF-8の `config/worker-aliases.json` で管理する。
- Worker URLだけでは認証できない。secretを第三者へ共有しない。
- KIFは公開PWAのHTMLへ挿入せず、previewは文字列として表示する。
- Windows側はqueueからcommandや引数を受け取らず、固定された解析コマンドだけを `shell=False` で起動する。
