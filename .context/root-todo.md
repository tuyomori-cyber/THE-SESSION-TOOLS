# Auto ToDo Root

> このファイルは `llmctx` が `Stop` hook ごとに更新する作業用 ToDo です。
>
> 本番 ToDo への最終マージは手動で行ってください。

## テーマ

- THE SESSION TOOLS
- The Session 専用 Firefox 拡張の開発

## 目的

- The Session 上での練習を補助するツールを、サイトを離れず利用できるようにする
- MVP として The Session 上に常時利用できるメトロノームを実装する

## 前提認識

- `llmctx` が turn をもとに継続更新する作業用 ToDo である
- 本ファイルの内容は自動更新されうるため、正本マージは手動で行う
- v0.1.0 は Firefox 拡張として実装する
- 音源をページ DOM やポップアップに依存させない
- ABC 解析や伴奏機能は将来構想であり、v0.1.0 には含めない

## MVP ゴール

- The Session 上に小型メトロノームを常時表示する
- BPM を変更できる
- Play / Stop ができる
- ページ遷移・タブ切替中も再生を継続する
- ブラウザが非アクティブ・背面・最小化中は最大5分再生し、その後は再生希望を維持して音だけを停止する
- 最後の The Session タブを閉じたときに再生を停止する
- 最後に設定した BPM を保存する

## 非ゴール

- ABC 楽譜解析
- 自動伴奏生成
- v0.1.0 の範囲を超える練習支援機能
- 正本 ToDo への自動マージ

## 段階的 ToDo

- [x] Firefox MV3の最小構成（manifest・background event page・content script・CSS）を作成する
- [x] The Sessionの各ページへ、既存UIを侵害しない小型メトロノームを注入する
- [x] content scriptとbackground event page間のメッセージ契約を実装する（状態取得・BPM・Play/Stop・状態配信）
- [x] background event pageにWeb Audio APIのメトロノームを実装する（先読みスケジューリングとAudioContext再開）
- [x] backgroundを唯一の再生状態保持者とし、遷移後のUIを状態同期する
- [x] BPM・音量・音色・autoResumeを`storage.local`へ保存・復元する。再生希望はブラウザ再起動後に復元しない
- [x] content scriptの1秒heartbeatでMV3 event pageの短時間破棄を防ぐ
- [x] 最後のThe Sessionタブ終了を`tabs.onRemoved`と`pagehide`通知で二重検出し、再生希望を解除して停止する
- [x] generation付き非アクティブ停止タイマーと、自動復帰を実装する
- [x] 開発版で連続再生・ページ遷移・最後のタブ終了・10秒に短縮した非アクティブ停止／自動復帰を手動検証する
- [x] BPMの長押し加速・BPMスライダー、音色選択・最大150%の音量スライダー、拍頭アクセント付きの8分・16分・3連を実装する
- [ ] 実際のThe Session練習でメトロノームを継続利用し、BPM調整・音色・分割・音量の使い勝手を評価する
- [ ] 本番値の5分で、非アクティブ停止・自動復帰・長時間heartbeat維持を最終確認する
- [ ] READMEを整備し、Firefox一時導入・既知の制約・検証手順を記載する
- [ ] 公開用パッケージング方針を決める

## 未解決論点

- heartbeatはFirefox MV3 event pageの短時間破棄を回避できることを3分超の実機試験で確認済み。本番の長時間利用でも維持できるかを追加確認する
- 複数のThe Sessionタブ・複数ウィンドウで、非アクティブ判定と最後のタブ終了判定が意図どおりかを確認する
- Firefox MV3は採用済み。Chrome対応を追加する場合は、service worker + offscreen documentを音源ホストにする別実装を検討する

## 次の一手

1. 実際のThe Session練習で継続利用し、UX上の改善点を記録する
2. 本番値の5分で非アクティブ停止と自動復帰を最終確認する
3. 複数タブ・複数ウィンドウのライフサイクルを確認する
4. READMEと公開用パッケージングを整備する

## 実装設計メモ

- **UI層（content script）**: `https://thesession.org/*`と`https://www.thesession.org/*`にのみ注入する。UIの表示と入力送信だけを担当し、音声・再生状態を保持しない。ページ遷移後はbackgroundから状態を再取得する。
- **再生層（MV3 background event page）**: `AudioContext` とタイマーを保持する唯一の音源ホスト。短い Oscillator/Gain のクリックを先読みで予約し、画面の可視性やcontent scriptの寿命から切り離す。
- **状態**: `{ bpm, volume, sound, subdivision, userWantsPlayback, audioActuallyPlaying, autoResume }`をbackgroundで管理する。`bpm`・`volume`・`sound`・`subdivision`・`autoResume`は`storage.local`に保存する。再生希望はブラウザ再起動後に復元しない。UIは読み込みのたびに状態を取得して描画する。
- **非アクティブ時**: The Sessionが非アクティブになってから5分後、`userWantsPlayback`を維持したまま音だけを止める。アクティブ復帰時は`autoResume`が有効なら自動再開する。タイマーはgenerationを照合し、復帰後に古いcallbackが停止しないようにする。
- **終了条件**: ユーザーのStop要求、または`tabs.query`でThe Sessionタブが0件になった場合は再生希望を解除して停止する。
