# THE SESSION TOOLS 仕様書 v0.2

- 文書バージョン：0.2
- 作成日：2026-10-26
- 状態：現行実装ベース
- 対象：Firefox Manifest V3拡張 `THE SESSION TOOLS` v0.1.4

## 1. 目的と対象

The Session（`thesession.org`および`www.thesession.org`）で譜面を見ながら練習するための、非公式メトロノーム拡張である。ページ右下へ小さな操作パネルを追加し、The Session内のページ遷移後も再生と設定を維持する。

The Session公式、汎用ABCツール、DAW、伴奏生成ツールを置き換えるものではない。拡張は対象2ホスト以外へ注入せず、データを外部送信しない。設定はFirefoxの拡張ローカルストレージだけに保存する。

## 2. 構成と権限

| 要素 | 責務 |
| --- | --- |
| `extension/manifest.json` | Manifest V3、対象ホスト、`storage`・`tabs`・`nativeMessaging`・`webRequest`権限、Firefox 140以上（Android 142以上）を定義する。 |
| `extension/content.js` | Metronome／Tuner表示、ドラッグ・最小化、入力処理、背景への状態通知、heartbeatを担当する。 |
| `extension/content.css` | Metronome／Tunerパネルの表示、44×44pxの最小化ボタン、最小化表示を定義する。 |
| `extension/offline-tuner.*` | 接続エラー画面でDOM注入の代わりに使うツールバーポップアップのチューナーUIを定義する。 |
| `extension/background.js` | 再生状態、Web Audio API、保存設定、タブ・ウィンドウの活動状態、および許可済みの`foxbook_speech` Native Messaging Hostとの音声操作連携を管理する。 |

背景スクリプトはcontent scriptから1秒ごとの無害なheartbeatを受け、Firefox MV3のevent pageが短時間で停止して音声が止まることを回避する。heartbeatの有効性はPoCで確認済みだが、Firefoxの将来の実装変更に対する恒久保証ではない。

オフラインでは対象ホストへの遷移試行をタブごとに記録し、拡張ポップアップでメトロノームとチューナーを明示的に操作する。正常なThe Sessionページにcontent scriptが起動すると、同じタブのオフラインメトロノームを停止し、チューナーの停止応答またはHost切断を待ってから通常パネルを表示し、オフライン用アクションを無効化する。通常画面での再生・測定は再度明示的に開始する。接続復旧のみでは遷移を確定しない。

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

保存する値は`bpm`、`autoResume`、`volume`、`sound`、`subdivision`、`metronomePosition`、`metronomeCollapsed`である。通常のメッセージは同一拡張のcontent scriptとbackgroundの間だけで利用する。音声操作だけは、固定名`foxbook_speech`のNative Messaging Hostへ接続する。任意の外部メッセージ、任意コマンド、任意の音声データは受け取らず、許可済みの音声serviceイベントを定義済みのメトロノーム操作へ対応付ける。

## 6. 配布と検証

配布ZIPは`extension/`直下から、`manifest.json`、`background.js`、`content.js`、`content.css`、`offline-tuner.html`、`offline-tuner.css`、`offline-tuner.js`、`voice-commands.json`を直下に含めて作成する。

```bash
cd extension
zip ../the-session-tools-0.1.4.zip manifest.json background.js content.js content.css offline-tuner.html offline-tuner.css offline-tuner.js voice-commands.json
```

2026-10-26にJavaScript構文検査、manifest JSON検査、ZIP構成を確認した。チューナー追加後のZIP生成・AMO検証、Surfaceでのタッチ操作、実演奏時の3音色評価、複数タブ・ウィンドウ、5分非アクティブ後の停止・自動再開は未完了である。実施事項は[TODO](../TODO.md)で管理する。

2026-11-18に利用者がオフラインでのチューナー起動、メトロノーム起動・ポップアップ閉鎖後の再生継続、オンライン復帰後の停止と通常画面への切替を実機確認した。端末・Firefoxバージョン、マイク回収のプロセス等による直接確認は未記録である。

## 7. 履歴文書

初期仕様、v0.1.2音響改善案、MV3 Audio PoC結果は[old/specification/](../old/specification/)に保管する。これらは判断経緯の記録であり、現行仕様ではない。

## 音声操作v1（experimental）

アクティブなThe Sessionタブがある間、`foxbook-speech`が所有するネイティブKWSで選択された呼びかけを待機する。コードの既定は`FOX`だが、今後はservice側で選択する「みらい」で検証する。非アクティブ時は待機を停止し、復帰時に再開する。検出時はserviceがKWSを停止してマイクをReazonSpeechの3秒録音へ引き継ぎ、認識テキストをTHE SESSION TOOLSへ返す。結果または失敗後は待機へ戻る。

受理する操作は、再生・停止、BPM／テンポの個別設定（30〜300）、テンポの±5、音量の個別設定（0〜150%）、音量の±10%、DivisionのBeat・8分・3連符・16分である。音色は音声操作の対象外とする。それ以外の認識文、serviceエラー、The Sessionタブ不在ではメトロノーム状態を変更しない。

パネルには音声操作の状態LEDを常時表示する。接続前は灰色の「未接続」、Host接続・準備中は青灰、KWS待機中は緑、呼びかけ検出は橙、コマンド認識中は点滅する青、障害は赤とする。

音声操作は既存のbackground scriptの再生・停止・設定変更処理を呼ぶ。Voice Editorの任意録音、既存のメトロノームUI操作、The Session以外への操作、任意テキストの実行は対象外とする。Native Messaging接続、KWS停止から録音への引継ぎ、結果後の待機再開は実装・実機確認済みである。dynabookのFirefoxで「みらい」検出、非アクティブ時の一時停止・復帰、タブ終了時のマイク解放を確認した。Host切断時の回収、Voice Editorとの同時利用、Surfaceでの挙動は運用確認として残す。横断契約の正本は[IF-TST-SP-001](../../foxbook/docs/interfaces/the-session-tools--foxbook-speech.md)である。

## チューナー（実装・実機検証待ち）

既存パネルをMetronome／Tunerで切り替え、チューナーでは55〜1200Hzの単音を対象に音名・周波数・centと横方向の点を表示する。点は低音で左、高音で右へ動き、ずれが大きい赤から中央の緑へ滑らかに変化する。±2cent以内は緑とし、無音時は点を表示しない。A4基準は432〜446Hzで変更・保存できる。KWSと音程解析は単一の入力を共有する。合成音による解析試験とメーター動作は確認済みで、実楽器の精度・追従性の定量評価は未確認である。

### 目的と音声操作

チューナーは単音のクロマチックチューナーとして始め、音名、周波数、基準からのセント差、入力待ちを表示する。和音・複数音同時の判定は扱わない。

通常待機中は選択された呼びかけの後に「チューナー」「チューナー起動して」「チューナーを起動して」「十七」のいずれかを受理すると開始する。「十七」は認識結果として登録し、部分一致は行わない。チューナー中は選択された呼びかけ単独で終了し、終了側ではReazonSpeechを起動しない。通常待機中の呼びかけ単独は従来どおりコマンド待ちであり、単独終了という意味を持つのはチューナー中だけである。

開始直後のKWS再検出で即終了しないよう、`tuner_started`から1.5秒間は呼びかけ単独での終了を受けない。終了検出後は直ちにキャプチャを閉じ、同じ発話で重複して操作しない。終了用の誤検出率を実機で確認し、必要なら終了時だけ連続2検出などの条件を追加する。`Tuner を開く`で自動的に測定を開始し、UIの`Metronomeへ戻る`でも終了できる。

### 基準ピッチと保存状態

基準ピッチの初期値はA4=440Hzとする。利用者は設定で変更でき、値はFirefoxのローカルストレージへ保存して次回のチューナー開始にも適用する。チューナーの実行状態は保存・復元しない。

### マイク使用権と入力経路

`foxbook-speech` serviceは、チューナーと録音に共通のleaseを一件だけ保持する。チューナー中は一つの連続PCMキャプチャからKWSとピッチ解析の両方へフレームを配る。通常のKWS待機は現状このleaseに含まれず、Voice Editorとの完全なマイク排他は未検証である。

| lease用途 | 開始条件 | 終了条件 | 他要求への扱い |
| --- | --- | --- | --- |
| KWS待機（lease外） | THE SESSION TOOLSが待機を開始 | 検出、明示停止、切断 | チューナーへの切替時は停止する |
| `tuner` | 利用者が開始、または「呼びかけ、チューナー」 | UI終了、チューナー中の呼びかけ単独、タブ終了、切断 | 一つのキャプチャをKWSとチューナー解析で共有。別sessionの録音は`BUSY` |
| `recording` | 利用者が録音開始、またはKWS検出後 | 停止、取消、結果・失敗、切断 | KWS・チューナーは起動しない |

チューナー開始時は同一sessionのKWS停止を要求してから`tuner` leaseを取得する。Voice Editorなど別sessionの`recording`中、または別sessionの`tuner`中は`BUSY`を返す。待ち行列と強制横取りは持たない。KWSを含む原子的なlease管理は未実装である。

拡張から生PCM、デバイス名、任意の実行パスは渡さない。serviceはチューナー操作として`start_tuner`と`stop_tuner`を受け、`tuner_started`、`tunerId`と`frequencyHz`を含む`tuner_pitch`、`tuner_stopped`を返す。無音や信頼できない入力では`frequencyHz`をnullとし、拡張は入力待ちを表示する。音名とcentは拡張側で計算する。

### 非アクティブ化・再開・回収

チューナー開始元の`tabId`と`windowId`をbackgroundが所有者として記録する。所有タブが非表示、別タブへ切替、所有ウィンドウの非アクティブ化・最小化になったら、serviceはキャプチャを停止してleaseを解放する。この状態は明示停止ではなく`paused`とする。

同じ所有タブが同じウィンドウで再び前面・可視になったら、backgroundはマイクの再取得を一度だけ試す。取得できればチューナーとKWSを再開する。Voice Editorなどが先にマイクを使っていれば`BUSY`のまま「一時停止（再開）」を表示し、利用者の再開操作を待つ。別のThe Sessionタブを前面にしただけでは、元のチューナーを自動再開しない。

明示停止、所有タブの終了・The Session以外への遷移、拡張の再読み込み、Firefox終了では再開意図を破棄する。`pagehide`通知は補助にし、backgroundの`tabs.onRemoved`、`tabs.onUpdated`（対象外URLへの遷移）、`windows.onRemoved`、可視性・フォーカス変更を回収の正本にする。所有タブが終了・対象外化した場合、Native Messaging Portが残っていてもbackgroundは`stop_tuner`を送る。

Native Messaging Portが切断された場合、serviceはsession切断処理でleaseを解放し、キャプチャとKWSのプロセスを停止する。通常の`stop_tuner`ではプロセス停止を待ってからleaseを解放する。切断時の回収完了順序と競合は今後の実機・自動試験で確認する。

### 実装と検証

`SpeechState`のleaseは録音とチューナーの`kind`を持つ。チューナー中はネイティブ検出器がPCMを一つだけ取得し、KWSとYINによるピッチ解析へ渡す。Firefox拡張は表示と固定APIを担当する。通常KWSのlease統合は今後の課題である。

実装後は、次を確認する。

- 「呼びかけ、チューナー」による開始、チューナー中の呼びかけ単独終了、UIによる開始／Metronomeへ戻る操作、停止後のKWS待機復帰
- Voice Editor録音中のチューナー開始、およびチューナー中のVoice Editor録音が安全に`BUSY`になること
- 所有タブの切替・ウィンドウ非アクティブ化・最小化でキャプチャが解放され、復帰時に一度だけ自動再開すること
- タブ終了・対象外URLへの遷移・ウィンドウ終了・拡張再読み込み・Firefox終了・service再起動時に、キャプチャプロセスとleaseが必ず回収されること
- USBマイク、dynabook、Surfaceで、A3〜A5程度の単音における音名・セント表示の追従性とCPU/RSS
