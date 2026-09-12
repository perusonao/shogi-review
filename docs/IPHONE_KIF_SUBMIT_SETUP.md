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

リポジトリ直下の `worker-config.bat.example` を `worker-config.bat` にコピーする。ファイル内へWorker URL、worker用の平文secret、対象ユーザー名を設定する。このファイルはGit対象外である。

まず `start-analysis-worker.bat` を実行してpoll開始を確認する。常駐を自動化する場合は `setup-worker-task.bat` を管理者権限なしで1回実行する。次回以降、Windowsログオン時にworkerが起動する。

## 7. iPhone PWAを設定

GitHub PagesのPWAを開き、「棋譜を追加」を選ぶ。Worker URLとPWA送信用の平文secretを入力して「この端末に保存」を押す。値はiPhoneのlocalStorageだけに保存され、HTTPSでWorkerへ送られる。

## 8. 利用する

将棋ウォーズでKIFをコピーし、「クリップボードから貼り付け」を押す。対局者・日時・手数・結果を確認し、KIFでUNKNOWNのprovider・持ち時間・対局時段級だけを選んで「解析する」を押す。metadataが完全なKIFでは追加選択はない。前回の段級は候補として表示されるだけで、自動入力されず毎回1 tap確認が必要である。解析待ち、解析中、解析完了の状態はrequest IDとともに端末へ保存され、PWAを閉じても次回起動時に再取得される。

同一fingerprintが解析済みなら既存game IDへ案内し、queue中なら既存request IDを再利用する。failedだけ「再試行」できる。

## セキュリティ上の注意

- PWA送信用とworker用に同じsecretを使わない。
- `worker-config.bat` と `wrangler.toml` はcommitしない。
- Worker URLだけでは認証できない。secretを第三者へ共有しない。
- KIFは公開PWAのHTMLへ挿入せず、previewは文字列として表示する。
- Windows側はqueueからcommandや引数を受け取らず、固定された解析コマンドだけを `shell=False` で起動する。
