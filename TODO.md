# THE SESSION TOOLS 現状 ToDo

更新日：2026-10-26

## 現状

- メトロノーム専用のFirefox拡張。仮想キーボードはこの拡張に同居させない。
- アプリ名のドラッグ移動と三角ボタンの最小化・展開を分離済み。三角はSVG化し、32pxの図形と44×44pxのタッチ領域に調整済み。構文・座標・関連文書の整合を確認済み。
- Manifest V3、The Sessionの2ホスト限定、BPM 30〜300、分割4種、3音色、音量0〜150%、5分非アクティブ停止と復帰時自動再開を実装済み。
- `background.js`と`content.js`の構文検査、manifest JSON検査、配布ZIPの4ファイル構成を2026-10-26に確認済み。
- 以前のv0.1.2の音色は`Crisp`・`Sharp`・`Wood`の3候補に整理済み。実演奏での最終試聴は未完了。

## 未完了

- [ ] SurfaceでFirefox拡張とThe Sessionのページを再読み込みし、ドラッグ移動と三角ボタンのタッチ操作・表示を確認する。
- [ ] 新規生成したv0.1.3のZIPをAMOで検証し、結果を確認する。配布方式と対象環境も確定する。
- [ ] 3音色の実演奏での聞き取りやすさと歪みを試聴し、正式な音色パラメータを確定する。
- [ ] 複数のThe Sessionタブ・ウィンドウで非アクティブ判定と最後のタブ終了時の停止を確認する。

## 参照

- 詳しい過去の経緯：`.context/root-todo.md`、`.context/turns.jsonl`、Git履歴
- 現行実装仕様：[仕様書 v0.2](specification/THE%20SESSION%20TOOLS_仕様書v0.2.md)
- 旧仕様・検討・PoC記録：[old/specification/](old/specification/)
