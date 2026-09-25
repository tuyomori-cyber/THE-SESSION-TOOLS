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
- ブラウザが非アクティブ・背面・最小化中でも、The Session タブが残る限り再生を継続する
- 最後の The Session タブを閉じたときに再生を停止する
- 最後に設定した BPM を保存する

## 非ゴール

- ABC 楽譜解析
- 自動伴奏生成
- v0.1.0 の範囲を超える練習支援機能
- 正本 ToDo への自動マージ

## 段階的 ToDo

- [x] THE SESSION TOOLS 仕様書 v0.1.0 を確認し、MVP 範囲と完了条件を把握する
- [x] v0.1.0 の実装方針を決定する（Firefox 専用・Manifest V2 の永続バックグラウンドページを音源ホストにする）
- [ ] `manifest.json`、永続バックグラウンドページ、The Session 用 content script、CSS の最小構成を作成する
- [ ] content script で、既存 UI を侵害しない小型メトロノーム UI を The Session の各ページへ注入する
- [ ] content script とバックグラウンドページ間のメッセージ契約を実装する（`getState`、BPM変更、`play`、`stop`、状態配信）
- [ ] バックグラウンドページに Web Audio API のメトロノームを実装する（短いクリック音、先読みスケジューリング、ユーザー操作での AudioContext 再開）
- [ ] バックグラウンドページを唯一の再生状態の保持者にし、遷移後に再注入された UI を `getState` で同期する
- [ ] `browser.storage.local` に BPM を保存・復元する。再生状態はブラウザ再起動後に復元しない
- [ ] `tabs.onRemoved` 後に The Session タブ数を再照会し、0件なら停止する。開始時にもタブの存在を確認する
- [ ] 開発版を Firefox に一時導入し、ページ遷移・別タブ・別ウィンドウ・非アクティブ・最小化・最後のタブ閉鎖を手動検証する
- [ ] AMO公開を前提に、Manifest V2 の受理可否を確認する。不可なら「持続音声の要件を満たす Firefox 対応方式」を実機で再評価する

## 未解決論点

- Manifest V2 が対象 Firefox と AMO 配布で許容されるか。MV3 は永続バックグラウンドページを許容しないため、要件上の代替にしない
- content script からの Play 操作で、バックグラウンドページ上の `AudioContext.resume()` が各対象Firefoxで許可されるか
- 非アクティブ・最小化中のタイマー精度。音の継続性は Web Audio の先読みスケジューリングで担保し、テンポ精度は実機で判定する

## 次の一手

1. Firefox の対象バージョンと AMO 配布要件を確認し、Manifest V2 永続バックグラウンドページを採用できることを確定する
2. 確定後、最小構成（manifest・background page・content script・CSS）を作成する
3. まず Play/Stop とBPM保存を通し、続いて遷移・非アクティブ時の継続再生を検証する

## 実装設計メモ

- **UI層（content script）**: `https://thesession.org/*` と `https://www.thesession.org/*` にのみ注入する。UIの表示と入力送信だけを担当し、音声・再生状態を保持しない。
- **再生層（永続 background page）**: `AudioContext` とタイマーを保持する唯一の音源ホスト。短い Oscillator/Gain のクリックを先読みで予約し、画面の可視性やcontent scriptの寿命から切り離す。
- **状態**: `{ bpm, isPlaying }` をバックグラウンドで管理する。`bpm` は `storage.local` に永続化し、`isPlaying` は実行中のみ保持する。UIは読み込みのたびに状態を取得して描画する。
- **終了条件**: Stop要求、または `tabs.query` でThe Sessionタブが0件になった場合のみ再生を止める。タブのアクティブ状態・ウィンドウのフォーカス状態・最小化状態は停止条件にしない。
