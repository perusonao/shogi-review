# 2026/09/10 sonao81 3局 水匠5ローカル解析 結果レポート

## 結論

Windows PCへ公式配布のYaneuraOu V9.00と水匠5を構築し、対象3局を
実エンジンで解析した。生成データの検証とローカルPWAのブラウザ確認はすべて成功した。

## Git基準

- base SHA: `43fffb5374728fecf6f8d97563ca182d555577df`
- 作業開始時の `origin/main`: `dc38c6bad21708e11470be94e199120bde54e6fa`
- branch: `claude/shogi-review-3games-analysis-9axe5t`
- 解析データcommit SHA: `0d176ac356258a2e7f73e30a72bbb210a04b44bd`
- 解析結果レポートcommit SHA: `ca73154a8b4d2024c6c5416990e9d7cd870b2c9c`
- main merge commit SHA: `f48bc3791102a7debd1dd4043622ea9cb1141b45`
- push先: `origin/main`（PR #1経由）

## YaneuraOu

- バージョン: `YaneuraOu NNUE V9.00Git 64AVX2 TOURNAMENT`
- 公式release: <https://github.com/yaneurao/YaneuraOu/releases/tag/V9.00>
- 取得元URL: <https://github.com/yaneurao/YaneuraOu/releases/download/V9.00/yaneuraou-V900-git-win64-all.7z>
- 配布アーカイブSHA-256: `6517997DD05BA049A2244A828216967A0AD351D975EC52A0F358E2883197DEC6`
- 実パス: `C:\shogi-engine\yaneuraou\NNUE_halfkp_256x2_32_32\YaneuraOu_NNUE_halfkp_256x2_32_32-V900Git_AVX2.exe`
- 実行ファイルSHA-256: `6933DADADB8294A311C79A547768D555528870A1C20F365667BA8A32C3A6C068`

## 水匠5

- 配布名: 水匠5評価関数ファイル（標準NNUE型 `NNUE_halfKP256`）
- 公式release: <https://github.com/yaneurao/YaneuraOu/releases/tag/suisho5>
- 取得元URL: <https://github.com/yaneurao/YaneuraOu/releases/download/suisho5/Suisho5.7z>
- 配布アーカイブSHA-256: `6734E3A3D28E67B9206C3442F6D10F16148138327DFF811CADEDFCF581F79809`
- `nn.bin`実パス: `C:\shogi-engine\suisho5\nn.bin`
- `nn.bin` SHA-256: `768068F0D534A0603A5D38BCD143DE6BBCA820D5F1C95A14D40863E5B7892D76`

## CPU・使用命令セット

- CPU: Intel Core i5-10210U 1.60GHz
- 4 cores / 8 logical processors / 64bit
- 実機判定: AVX2、AVX、SSE4.2対応
- 使用実行ファイル: 64bit AVX2版

## 解析設定

- engine: YaneuraOu V9.00 NNUE halfKP256 AVX2 + 水匠5
- `go nodes 30000` / 局面
- `Threads=1`
- `USI_Hash=1024` MB
- `USI_OwnBook=false`
- `EvalDir=C:\shogi-engine\suisho5`
- `FV_SCALE=24`（水匠5公式推奨値）
- 評価値保存視点: 先手視点
- 課題抽出: sonao81の手のみ、評価値損失300点以上、最大6件/局

## 解析結果

| 対局 | 手数 | 解析局面数 | 課題局面数 | 最大評価値損失 |
|---|---:|---:|---:|---:|
| `20260910_taatoru_cat` | 119 | 120 | 6 | 30,036 |
| `20260910_yogra` | 67 | 68 | 5 | 25,757 |
| `20260910_aochikenmin` | 76 | 77 | 3 | 654 |

最大損失が大きい2局は、通常評価から詰み評価へ遷移した局面を含む。

## スクリプト修正

スモーク解析で確認した点だけを修正した。

- PWAの `issue.ply` は実戦手を指した後の手数を表すため、解析位置の `ply + 1` を保存する。
- 実戦手がエンジンのbestmoveと同一の場合、独立した固定ノード探索の評価値揺れを
  損失として誤検出せず、損失0とする。
- 実在しない `--update-index` オプションの説明を削除した。

## 変更ファイル

- `tools/analyze_with_suisho5.py`
- `analysis/20260910_taatoru_cat.json`
- `analysis/20260910_yogra.json`
- `analysis/20260910_aochikenmin.json`
- `games/20260910_taatoru_cat.json`
- `games/20260910_yogra.json`
- `games/20260910_aochikenmin.json`
- `games/index.json`
- `docs/reports/SHOGI_20260910_3GAMES_SUISHO5_Local_Result.md`

## テスト結果

- USI: `usi` → `usiok`、`isready` → `readyok`、`quit` 正常終了。
- 評価関数: `loading eval file : C:\shogi-engine\suisho5/nn.bin` を確認。
- スモーク解析: `yogra`戦、1,000 nodes/局面、68局面のJSON生成成功。
- 本解析: 3局すべて正常終了。手数+1個の評価値を保存。
- 各課題について実戦USIとKIF局面、bestmove合法性、PV先頭、手番parity、
  sonao81視点の評価値損失再計算が一致。
- `games/index.json` の全 `gameData` / `analysisData` 参照先が存在。
- `python -m py_compile` 成功。
- `git diff --check` 成功。
- `data.json` と `analysis/akane_20260910.json` は無変更。
- ローカルPWAのブラウザ確認で4局すべて「解析済み」。対象3局の
  「次の課題局面へ」、赤い実戦手、緑の推奨手、評価値、損失、コメントを確認。
- 既存あかね戦の読み込み・評価グラフ・課題送りが維持されていることを確認。
- リポジトリ内に `.exe`、`nn.bin`、`.7z`、10MB超の新規巨大ファイルなし。
- GitHub Pages buildはmain merge commit `f48bc3791102a7debd1dd4043622ea9cb1141b45`で成功。
- 公開URL <https://perusonao.github.io/shogi-review/> から3局のcatalog、game JSON、
  analysis JSONを再取得し、手数・局面数・課題数・30,000 nodesを確認。

## PWA反映状態

対象3局は `games/index.json` で `analyzed: true` となり、各game JSONとanalysis JSONを
読み込む。ローカルPWAと公開PWAの両方で反映済み。
