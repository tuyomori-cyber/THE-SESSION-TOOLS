# THE SESSION TOOLS 仕様書 v0.2

- 文書バージョン：0.2
- 作成日：2026-10-26
- 状態：現行実装ベース
- 対象：Firefox Manifest V3拡張 `THE SESSION TOOLS` v0.1.3

## 1. 目的と対象

The Session（`thesession.org`および`www.thesession.org`）で譜面を見ながら練習するための、非公式メトロノーム拡張である。ページ右下へ小さな操作パネルを追加し、The Session内のページ遷移後も再生と設定を維持する。

The Session公式、汎用ABCツール、DAW、伴奏生成ツールを置き換えるものではない。拡張は対象2ホスト以外へ注入せず、データを外部送信しない。設定はFirefoxの拡張ローカルストレージだけに保存する。

## 2. 構成と権限

| 要素 | 責務 |
| --- | --- |
| `extension/manifest.json` | Manifest V3、対象ホスト、`storage`・`tabs`権限、Firefox 140以上（Android 142以上）を定義する。 |
| `extension/content.js` | メトロノームUI、ドラッグ・最小化、入力処理、背景への状態通知、heartbeatを担当する。 |
| `extension/content.css` | パネルの表示、44×44pxの最小化ボタン、最小化表示を定義する。 |
| `extension/background.js` | 再生状態、Web Audio API、保存設定、タブ・ウィンドウの活動状態を管理する。 |

背景スクリプトはcontent scriptから1秒ごとの無害なheartbeatを受け、Firefox MV3のevent pageが短時間で停止して音声が止まることを回避する。heartbeatの有効性はPoCで確認済みだが、Firefoxの将来の実装変更に対する恒久保証ではない。

## 3. 機能

- BPMは30〜300（既定110）。±ボタン、長押し連続調整、スライダーで変更する。
- 分割はBeat（1）、8分音符（2）、3連符（3）、16分音符（4）。各拍の先頭はアクセントを付ける。
- 音色はCrisp（既定）、Sharp、Wood。音量は0〜150%（既定70%）。保存済みの旧`beep`・`click`はCrispへフォールバックする。
- アプリ名領域でドラッグ移動し、位置を保存する。独立した三角ボタンで最小化・展開し、状態を保存する。最小化は再生を停止しない。
- Playで再生希望を設定し、Stopで再生希望と音声を停止する。ブラウザー再起動後に再生希望は復元しない。

## 4. 再生ライフサイクル

再生中でもThe Session内のページ遷移、別The Sessionタブへの切替では再生を継続する。The Sessionが非アクティブ、背面、または最小化の状態で5分間継続すると、再生希望を保持したまま音声だけを停止する。The Sessionが再びアクティブになると、既定で自動再開する。

最後のThe Sessionタブを閉じた場合、または最後のタブが対象外URLへ遷移した場合は、再生希望を解除して停止する。タブ終了の競合を避けるため、終了通知では対象タブIDを明示的に除外して残存タブを判定する。

## 5. 保存状態と安全境界

保存する値は`bpm`、`autoResume`、`volume`、`sound`、`subdivision`、`metronomePosition`、`metronomeCollapsed`である。メッセージは同一拡張のcontent scriptとbackgroundの間だけで利用し、外部メッセージ受信やNative Host連携は持たない。

## 6. 配布と検証

配布ZIPは`extension/`直下から、`manifest.json`、`background.js`、`content.js`、`content.css`だけを直下に含めて作成する。

```bash
cd extension
zip ../the-session-tools-0.1.3.zip manifest.json background.js content.js content.css
```

2026-10-26にJavaScript構文検査、manifest JSON検査、ZIPの4ファイル構成を確認した。Surfaceでのタッチ操作、実演奏時の3音色評価、複数タブ・ウィンドウ、5分非アクティブ後の停止・自動再開、AMO検証は未完了である。実施事項は[TODO](../TODO.md)で管理する。

## 7. 履歴文書

初期仕様、v0.1.2音響改善案、MV3 Audio PoC結果は[old/specification/](../old/specification/)に保管する。これらは判断経緯の記録であり、現行仕様ではない。
