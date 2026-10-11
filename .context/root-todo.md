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
- v0.1.1 の修正版を AMO で署名し、配布可能な状態にする

## 前提認識

- `llmctx` が turn をもとに継続更新する作業用 ToDo である
- 本ファイルの内容は自動更新されうるため、正本マージは手動で行う
- v0.1.0 は Firefox 拡張として実装する
- v0.1.1 の README・CHANGELOG・manifest 版数・配布 ZIP の作成が完了している
- v0.1.1 には、最後の The Session タブ終了時に音が停止しない不具合の修正が含まれる
- 最後の The Session タブを閉じたときに音が停止することは手動確認済み
- v0.1.1 の配布 ZIP は `the-session-tools-0.1.1.zip`。manifest の版数と修正内容を確認済み
- JavaScript 構文・manifest JSON・パッケージ内容の検証が完了している
- 音源をページ DOM やポップアップに依存させない
- ABC 解析や伴奏機能は将来構想であり、v0.1.0 には含めない
- Firefox 拡張の署名・配布先は Mozilla Add-ons（AMO）とする
- AMO の配布方式は Unlisted（非公開配布）と Listed（一般公開）から選択する。Unlisted は署名済み XPI を直接配布する用途に適している
- 署名済み拡張は通常版 Firefox / Beta に導入する。AMO への提出時は ZIP の直下に `manifest.json` がある構成とする
- 初回の署名申請は AMO の Web 画面から行う方法を基本とし、必要に応じて `web-ext sign --channel=unlisted` による CLI 署名も利用できる
- アップデート時は同じアドオン ID を維持し、`version` を上げて同じ AMO 登録へ新しいパッケージを提出する
- AMO 提出に必要な `browser_specific_settings.gecko.data_collection_permissions` を追加し、データ収集・送信を行わない拡張として `required: ["none"]` を宣言する
- `data_collection_permissions` は Firefox Desktop 140、Firefox for Android 142 から対応するため、`strict_min_version` との整合性を取る必要がある
- 最低対応版を Desktop 140／Android 142 に引き上げる方針を候補とする。実際の配布対象を確認したうえで、Android 対応設定を含めるか判断する
- Firefox で無効な `"windows"` 権限と、未実装の `browser.windows.onBoundsChanged` リスナーは削除する。非アクティブ判定には `windows.getAll` と `windows.onFocusChanged` を使用する
- 最後の The Session タブやウィンドウを閉じた際の停止判定では、イベント直後のタブ一覧のずれや競合に注意する。閉じるタブ ID を明示的に除外して残存タブを判定し、ウィンドウ終了時も停止対象として扱う
- 最後の対象タブがなくなった場合の停止判定は background 側で行い、競合しやすい `pagehide` 経由の停止通知には依存しない

## MVP ゴール

- The Session 上に小型メトロノームを常時表示する
- BPM を変更できる
- Play / Stop ができる
- ページ遷移・タブ切替中も再生を継続する
- ブラウザが非アクティブ・背面・最小化中は最大5分再生し、その後は再生希望を維持して音だけを停止する
- 最後の The Session タブを閉じたときに再生を停止する
- 最後に設定した BPM を保存する
- v0.1.1 の修正版を AMO で署名し、署名済み XPI で最終動作確認を行う

## 非ゴール

- ABC 楽譜解析
- 自動伴奏生成
- v0.1.0 の範囲を超える練習支援機能
- 正本 ToDo への自動マージ

## 段階的 ToDo

- Firefox MV3の最小構成（manifest・background event page・content script・CSS）を作成する
- The Sessionの各ページへ、既存UIを侵害しない小型メトロノームを注入する
- content scriptとbackground event page間のメッセージ契約を実装する（状態取得・BPM・Play/Stop・状態配信）
- background event pageにWeb Audio APIのメトロノームを実装する（先読みスケジューリングとAudioContext再開）
- backgroundを唯一の再生状態保持者とし、遷移後のUIを状態同期する
- BPM・音量・音色・autoResumeを`storage.local`へ保存・復元する。再生希望はブラウザ再起動後に復元しない
- content scriptの1秒heartbeatでMV3 event pageの短時間破棄を防ぐ
- 最後のThe Sessionタブ終了を`tabs.onRemoved`と`pagehide`通知で二重検出し、再生希望を解除して停止する
- 最後の The Session タブ／ウィンドウ終了時の停止検出を修正する。閉じるタブ ID を明示的に除外して残存タブを判定し、ウィンドウごとの終了や The Session 以外への遷移で対象タブがなくなった場合も停止する。競合しやすい `pagehide` 経由の停止通知は使用しない（修正済み、v0.1.1 に収録）
- generation付き非アクティブ停止タイマーと、自動復帰を実装する
- 開発版で連続再生・ページ遷移・最後のタブ終了・10秒に短縮した非アクティブ停止／自動復帰を手動検証する
- BPMの長押し加速・BPMスライダー、音色選択・最大150%の音量スライダー、拍頭アクセント付きの8分・16分・3連を実装する
- AMO提出時の必須データ収集宣言を追加し、無効な`windows`権限とFirefox未実装の`windows.onBoundsChanged`リスナーを削除する
- `data_collection_permissions` の対応バージョンに合わせて `strict_min_version` を更新する。Desktop 140／Android 142 を候補とし、配布対象を確認して設定を決定する
- 修正済みの`extension`を再パッケージし、AMOへ再アップロードして検証する（v0.1.1 の配布 ZIP 作成まで完了。AMO へのアップロード・署名は未完了）
- 実際のThe Session練習でメトロノームを継続利用し、BPM調整・音色・分割・音量の使い勝手を評価する
- 本番値の5分で、非アクティブ停止・自動復帰・長時間heartbeat維持を最終確認する
- 複数のThe Sessionタブ・複数ウィンドウで、非アクティブ判定と最後のタブ終了判定が意図どおりかを確認する
- READMEを整備し、Firefox一時導入・既知の制約・検証手順を記載する（v0.1.1 として作成済み）
- AMO の配布方式（Unlisted / Listed）を決定する
- `extension` の内容を ZIP 化して AMO へ提出し、署名済み XPI を取得して Firefox への導入を確認する（`the-session-tools-0.1.1.zip` 作成済み。提出・署名・導入確認は未完了）
- 公開用パッケージング方針を決める
- CHANGELOG.md を作成し、v0.1.1 に最後の The Session タブ終了時に音が停止しない不具合の修正を記録する（作成済み）

## 未解決論点

- heartbeatはFirefox MV3 event pageの短時間破棄を回避できることを3分超の実機試験で確認済み。本番の長時間利用でも維持できるかを追加確認する
- 最後の The Session タブ／ウィンドウ終了時の停止検出競合を修正済み。Firefox で実際に最後の対象タブやウィンドウを閉じ、音が確実に停止することを確認する必要がある（最後の The Session タブ終了時の停止は確認済み。ウィンドウ終了などの追加確認は未完了）
- 複数のThe Sessionタブ・複数ウィンドウで、非アクティブ判定と最後のタブ終了判定が意図どおりかを確認する
- Firefox MV3は採用済み。Chrome対応を追加する場合は、service worker + offscreen documentを音源ホストにする別実装を検討する
- AMO の配布方式を Unlisted（非公開配布）と Listed（一般公開）のどちらにするか未決定
- 署名済み XPI の作成・導入は未完了。初回は AMO の Web 画面から提出する方針を基本とし、CLI による署名は必要に応じて検討する
- AMO 提出用の manifest 修正、README・CHANGELOG の作成、v0.1.1 の配布 ZIP 作成は完了したが、AMO へのアップロードと審査・署名結果の確認は未完了
- `data_collection_permissions` に対応させるため、最低対応版を Desktop 140／Android 142 に引き上げるか未決定
- 配布対象をデスクトップ限定にするか、Firefox for Android も対象にするか未決定。Android を対象外とする場合は `gecko_android` の設定要否も含めて整理する

## 次の一手

1. AMO の配布方式（Unlisted / Listed）と配布対象（デスクトップ限定／Android 対応）を決定し、必要に応じて `manifest.json` の `strict_min_version` を調整する
2. `the-session-tools-0.1.1.zip` を AMO へアップロードして署名済み XPI を取得する
3. 署名済み XPI を Firefox に導入し、最後の The Session タブ終了時の停止を含む主要機能の最終動作確認を行う

## 実装設計メモ

- UI層（content script）: `[[[https://thesession.org/*](https://thesession.org/*)](https://thesession.org/*)](https://thesession.org/*)`と`[[[https://www.thesession.org/*](https://www.thesession.org/*)](https://www.thesession.org/*)](https://www.thesession.org/*)`にのみ注入する。UIの表示と入力送信だけを担当し、音声・再生状態を保持しない。ページ遷移後はbackgroundから状態を再取得する。
- 再生層（MV3 background event page）: `AudioContext` とタイマーを保持する唯一の音源ホスト。短い Oscillator/Gain のクリックを先読みで予約し、画面の可視性やcontent scriptの寿命から切り離す。
- 状態: `{ bpm, volume, sound, subdivision, userWantsPlayback, audioActuallyPlaying, autoResume }`をbackgroundで管理する。`bpm`・`volume`・`sound`・`subdivision`・`autoResume`は`storage.local`に保存する。再生希望はブラウザ再起動後に復元しない。UIは読み込みのたびに状態を取得して描画する。
- 非アクティブ時: The Sessionが非アクティブになってから5分後、`userWantsPlayback`を維持したまま音だけを止める。アクティブ復帰時は`autoResume`が有効なら自動再開する。タイマーはgenerationを照合し、復帰後に古いcallbackが停止しないようにする。
- 終了条件: ユーザーのStop要求、または`tabs.query`でThe Sessionタブが0件になった場合は再生希望を解除して停止する。タブ終了イベント直後の一覧に閉じるタブが残る場合を考慮し、閉じるタブ ID を明示的に除外して判定する。ウィンドウ終了時も停止判定を行い、`pagehide` 経由の停止通知には依存しない。
- AMO提出設定: `browser_specific_settings.gecko.data_collection_permissions.required`に`["none"]`を設定する。Firefoxで未対応の権限・イベントを使用せず、非アクティブ判定は対応済みの`windows.getAll`と`windows.onFocusChanged`を利用する。`data_collection_permissions` の対応開始バージョンに合わせ、配布対象に応じた `strict_min_version` を設定する。