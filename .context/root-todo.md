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

- [x] THE SESSION TOOLS 仕様書 v0.1.0 を確認し、MVP 範囲と完了条件を把握する
- [x] v0.1.0 の実装方針を決定する（Firefox 専用・Manifest V3 の background event page を音源ホストにする）
- [ ] `manifest.json`、MV3 background event page、The Session 用 content script、CSS の最小構成を作成する
- [ ] content script で、既存 UI を侵害しない小型メトロノーム UI を The Session の各ページへ注入する
- [ ] content scriptとbackground event page間のメッセージ契約を実装する（`getState`、BPM変更、`play`、`stop`、状態配信）
- [ ] background event pageにWeb Audio APIのメトロノームを実装する（短いクリック音、先読みスケジューリング、content scriptのPlay操作でのAudioContext再開）
- [ ] background event pageを唯一の再生状態の保持者にし、遷移後に再注入されたUIを`getState`で同期する
- [ ] `browser.storage.local`にBPMとautoResumeを保存・復元する。再生希望状態はブラウザ再起動後に復元しない
- [ ] `tabs.onRemoved`後にThe Sessionタブ数を再照会し、0件なら再生希望を解除して停止する。開始時にもタブの存在を確認する
- [ ] 開発版をFirefoxに一時導入し、ページ遷移・別タブ・別ウィンドウ・非アクティブ・最小化・5分タイムアウト・自動復帰・ユーザーStop・最後のタブ閉鎖を手動検証する
- [ ] 非アクティブ化から5分後に音だけを止める。`userWantsPlayback`は維持し、アクティブ復帰時は`autoResume`が有効なら自動再開する
- [ ] 非アクティブ停止タイマーをgeneration付きで管理する。復帰後に古いタイマーcallbackが停止しないことを保証する

## 未解決論点

- Firefox MV3 background event pageが長時間の可聴再生中に維持されるか。別タブ・最小化での5分継続はPoCで確認済みで、実装後に長時間も確認する
- 非アクティブ判定をcontent scriptの`visibilitychange`、`tabs.onActivated`、ウィンドウ状態からどう統合するか。複数のThe Sessionタブ・複数ウィンドウでも意図どおりにする
- Firefox MV3は採用済み。Chrome対応を追加する場合は、service worker + offscreen documentを音源ホストにする別実装を検討する

## 次の一手

1. Firefox MV3の最小構成（manifest・background event page・content script・CSS）を作成する
2. `userWantsPlayback`、`audioActuallyPlaying`、`autoResume`をbackgroundで管理し、Play/Stop・BPM保存を通す
3. generation付き5分タイムアウトと自動復帰を実装し、遷移・非アクティブ時の継続再生を検証する

## 実装設計メモ

- **UI層（content script）**: `https://thesession.org/*`と`https://www.thesession.org/*`にのみ注入する。UIの表示と入力送信だけを担当し、音声・再生状態を保持しない。ページ遷移後はbackgroundから状態を再取得する。
- **再生層（MV3 background event page）**: `AudioContext` とタイマーを保持する唯一の音源ホスト。短い Oscillator/Gain のクリックを先読みで予約し、画面の可視性やcontent scriptの寿命から切り離す。
- **状態**: `{ bpm, userWantsPlayback, audioActuallyPlaying, autoResume }`をbackgroundで管理する。`bpm`と`autoResume`は`storage.local`に保存する。再生希望はブラウザ再起動後に復元しない。UIは読み込みのたびに状態を取得して描画する。
- **非アクティブ時**: The Sessionが非アクティブになってから5分後、`userWantsPlayback`を維持したまま音だけを止める。アクティブ復帰時は`autoResume`が有効なら自動再開する。タイマーはgenerationを照合し、復帰後に古いcallbackが停止しないようにする。
- **終了条件**: ユーザーのStop要求、または`tabs.query`でThe Sessionタブが0件になった場合は再生希望を解除して停止する。
