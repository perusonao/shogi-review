# Engine setup

解析エンジン本体と評価関数は、このリポジトリへ直接コミットしません。

## 想定構成

- YaneuraOu: ローカルでビルド
- 評価関数: 水匠5 `nn.bin`
- 解析設定: `USI_OwnBook=false`
- 推奨ビルド: `FV_SCALE=24`（水匠5公開設定に合わせる）

## ローカル配置例

```text
.local-engine/
  YaneuraOu-by-gcc
  eval/
    nn.bin
```

`.local-engine/` は `.gitignore` 対象とし、巨大バイナリをGit履歴へ入れない。

一度解析した結果は `analysis/` にJSONとして保存する。これにより、エンジンがない環境でも過去対局の評価値グラフと課題局面を再現できる。
