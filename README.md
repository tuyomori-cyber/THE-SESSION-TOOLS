# THE SESSION TOOLS

The Session（[thesession.org](https://thesession.org/)）上で、譜面を見ながら練習するための Firefox 拡張機能です。現在は、ページ右下に常時表示されるメトロノームを提供します。

非公式の拡張機能であり、The Session とは関係ありません。

## 機能

- The Session のページだけにメトロノームを表示する
- BPM を 30〜300 の範囲で設定する
  - `−` / `＋` で 1 BPM 単位の調整
  - ボタンを長押しすると加速して連続調整
  - スライダーで直接調整
- 分割を Beat、8分音符、16分音符、3連符から選ぶ
- Crisp、Sharp、Wood の3種類からクリック音を選ぶ（初期値は Crisp）
- 音量を 0〜150% の範囲で設定する
- 各拍の先頭を少し強く鳴らす
- The Session 内でページ遷移しても再生を継続する
- BPM、分割、音色、音量を Firefox のローカルストレージに保存する
- The Session が非アクティブ・背面・最小化の状態で5分経過すると、再生希望を保持したまま音だけを停止する。The Session に戻ると自動で再開する
- 最後の The Session タブを閉じたとき、または最後のタブが The Session 以外へ遷移したときに停止する

再生状態はブラウザ再起動後には復元しません。

v0.1.1以前で保存された Beep または Click の音色設定は、v0.1.2 では Crisp に自動的に切り替わります。

## 動作要件

- Firefox 140 以降（Android は 142 以降）
- `https://thesession.org/` または `https://www.thesession.org/` へのアクセス

この拡張機能はデータを外部へ収集・送信しません。設定は拡張機能のローカルストレージにのみ保存されます。

## 使い方

1. The Session の任意のページを開きます。
2. 右下の **Metronome** で BPM、Division、Sound、Volume を調整します。見出しをタップすると最小化・展開でき、見出しをドラッグすると最小化中も位置を移動できます。位置と最小化状態は保存されます。
3. **Play** を押して開始し、**Stop** で停止します。

The Session の別ページへ移動しても、設定と再生状態は引き継がれます。

## 開発時の導入

1. Firefox で `about:debugging#/runtime/this-firefox` を開きます。
2. **一時的なアドオンを読み込む** を選びます。
3. このリポジトリの `extension/manifest.json` を選択します。
4. The Session を開き、右下にUIが表示されることを確認します。

ソースを変更した後は、`about:debugging` の **再読み込み** を実行してください。

## 署名・配布用パッケージ

通常版 Firefox へ導入するには、Mozilla による署名済み XPI が必要です。

```bash
cd extension
zip -r ../the-session-tools-0.1.2.zip .
```

作成した ZIP は、ディレクトリそのものではなく、直下に `manifest.json` がある構造でなければなりません。リリース用の `the-session-tools-0.1.2.zip` はこの構造で生成・静的検証済みです。AMO Developer Hub へアップロードし、非公開配布なら **On your own (Unlisted)** を選択して署名済み XPI を取得します。

## 構成

- `extension/manifest.json` — Firefox Manifest V3 の定義
- `extension/content.js` — The Session へUIを追加し、入力をbackgroundへ送信
- `extension/content.css` — メトロノームUIのスタイル
- `extension/background.js` — 再生状態、Web Audio API、タブ／ウィンドウのライフサイクルを管理

音源と再生状態は background script が保持するため、The Session 内での画面遷移やUIの再注入に依存しません。

## 既知の制約

- The Session 専用です。他サイトでは動作しません。
- ABC譜解析、コード／伴奏、MIDI、音源ファイルによるクリック音は未対応です。
- 5分の非アクティブ停止後は、The Session を再びアクティブにしたときだけ自動再開します。

## リリースノート

[CHANGELOG.md](CHANGELOG.md) を参照してください。
