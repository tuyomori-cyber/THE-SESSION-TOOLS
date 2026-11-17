# THE SESSION TOOLS

The Session（[thesession.org](https://thesession.org/)）上で、譜面を見ながら練習するための Firefox 拡張機能です。現在は、ページ右下に常時表示されるメトロノームを提供します。

非公式の拡張機能であり、The Session とは関係ありません。

このREADMEはv0.1.3の実装を説明します。実装の正本は[現行仕様 v0.2](specification/THE%20SESSION%20TOOLS_仕様書v0.2.md)、保留事項は[TODO](TODO.md)です。ドラッグ・最小化操作の改善はv0.1.3に含まれます。

## 機能

- The Session のページだけにメトロノームを表示する
- アプリ名のドラッグで位置を移動し、独立した三角ボタンで最小化・展開する（位置と最小化状態を保存）
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
2. 右下の **Metronome** で BPM、Division、Sound、Volume を調整します。アプリ名の範囲をドラッグすると、最小化中も位置を移動できます。最小化・展開は右側の三角ボタン（44×44px）のタップで切り替えます。アプリ名のタップでは切り替わりません。位置と最小化状態は保存されます。
3. **Play** を押して開始し、**Stop** で停止します。

The Session の別ページへ移動しても、設定と再生状態は引き継がれます。

## 音声操作

The Sessionを開いている間は、音声状態LEDが緑の「呼びかけを待機中」になります。コードの既定は`FOX`ですが、今後は音声service側で実験的に「みらい」を選択して検証します。呼びかけの後、3秒以内に次のコマンドを発話できます。音色は演奏中に変更しない方針のため、音声操作の対象外です。

| 発話 | 動作 |
| --- | --- |
| 再生 / 停止 | メトロノームの開始 / 停止 |
| BPM百五十 / テンポ二百 / BPM 120 | BPMを個別設定（30〜300） |
| テンポ少し上げて / 下げて | BPMを+5 / -5 |
| 音量百％ / 零％ / 百五十％ | 音量を個別設定（0〜150%） |
| 音量少し上げて / 下げて | 音量を+10% / -10% |
| 分割ビート / 八分 / 三連符（三連単）/ 十六分（十六部） | Divisionを設定 |
| 呼びかけの後にチューナー / チューナー起動して / チューナーを起動して / 十七 | パネルをTuner表示へ切り替えて起動 |

LEDは灰＝未接続、青灰＝接続済み、緑＝待機、橙＝検出、点滅青＝認識中、赤＝障害です。

チューナーはメトロノームの **Tuner を開く** または上記音声操作で、同じパネルの表示をTunerへ切り替えて測定を開始します。単音の音名・周波数・cent差を表示し、点は低いと左、高いと右へ動き、ずれが大きい赤から中央の緑へ滑らかに変化します。基準A4は432〜446Hzの範囲で変更でき、設定は保存されます。開始から1.5秒後以降の選択された呼びかけ単独、または **Metronomeへ戻る** で終了します。

開始元のThe Sessionタブが非表示になるか、ウィンドウが非アクティブ・最小化になると、チューナーは一時停止してマイクを解放します。同じタブが再び前面に戻ると一度だけ自動再開します。マイクが他で使われている場合は、空いた後で **再開** を押してください。現在は55〜1200Hzの単音を対象とし、非アクティブ時の一時停止・復帰は実機確認待ちです。

三角ボタンは枠を含めて44×44pxの操作領域です。32×32pxのSVG領域内に三角を描き、上下どちらの向きでも三角の重心が枠の中心と一致するよう配置しています。Enter・Spaceでも、フォーカスした三角ボタンを操作できます。パネルの最小化だけでは再生は停止しません。

## 開発時の導入

1. Firefox で `about:debugging#/runtime/this-firefox` を開きます。
2. **一時的なアドオンを読み込む** を選びます。
3. このリポジトリの `extension/manifest.json` を選択します。
4. The Session を開き、右下にUIが表示されることを確認します。

ソースを変更した後は、`about:debugging` の **再読み込み** を実行してください。

### 音声操作を有効にする

音声操作には[foxbook-speech](https://github.com/tuyomori-cyber/foxbook-speech)が必要です。THE SESSION TOOLSだけを一時読み込みしても、LEDは「未接続」のままで音声操作は有効になりません。

1. `foxbook-speech`を取得し、THE SESSION TOOLSと同じ親ディレクトリへ置きます。Whisper.cpp、ReazonSpeechモデル、`arecord`、`ffmpeg`も必要です。すべてを含むセットアップ手順は[foxbook-speech README](https://github.com/tuyomori-cyber/foxbook-speech#%E5%88%9D%E5%9B%9E%E5%B0%8E%E5%85%A5)を参照してください。
2. `foxbook-speech`で英語KWSモデルを`models/kws/`へ配置し、ネイティブ検出器とNative Hostを登録します。

   ```bash
   cd ../foxbook-speech
   make -C native native-kws
   python3 scripts/install_host.py
   python3 scripts/install_service.py --enable
   ```

3. THE SESSION TOOLSをFirefoxへ一時読み込みまたは再読み込みし、The Sessionを開きます。LEDが緑の「呼びかけを待機中」になれば利用できます。

`foxbook-speech`を更新した場合は、Native Host定義とserviceも反映します。

```bash
cd ../foxbook-speech
python3 scripts/install_host.py
systemctl --user restart foxbook-speech
```

モデル配置・依存関係・トラブルシューティングの正本は[foxbook-speech README](../foxbook-speech/README.md)です。

## 署名・配布用パッケージ

通常版 Firefox へ導入するには、Mozilla による署名済み XPI が必要です。

```bash
cd extension
zip ../the-session-tools-0.1.3.zip manifest.json background.js content.js content.css
```

作成した ZIP は、ディレクトリそのものではなく、直下に `manifest.json` がある構造でなければなりません。AMO Developer Hub へアップロードし、非公開配布なら **On your own (Unlisted)** を選択して署名済み XPI を取得します。

## 構成

- `extension/manifest.json` — Firefox Manifest V3 の定義
- `extension/content.js` — The Session へUIを追加し、入力をbackgroundへ送信
- `extension/content.css` — メトロノームUIのスタイル
- `extension/background.js` — 再生状態、Web Audio API、タブ／ウィンドウのライフサイクルを管理
- `extension/content.js` / `content.css` 内のTuner表示 — メトロノーム領域を置き換える音程メーターと基準ピッチ設定

音源と再生状態は background script が保持するため、The Session 内での画面遷移やUIの再注入に依存しません。

## 既知の制約

- The Session 専用です。他サイトでは動作しません。
- ABC譜解析、コード／伴奏、MIDI、音源ファイルによるクリック音は未対応です。
- 5分の非アクティブ停止後は、The Session を再びアクティブにしたときだけ自動再開します。

## リリースノート

[CHANGELOG.md](CHANGELOG.md) を参照してください。

初期設計、音響改善、MV3 Audio PoCの記録は[old/specification/](old/specification/)に保管しています。
